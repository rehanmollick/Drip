import { createHash } from "crypto";
import { isInteractive, isScored, type Card } from "@/lib/schemas/cards";
import { LEARNER_STATE_VERSION, type LearnerState } from "@/lib/schemas/learner";
import type { Interaction } from "@/lib/schemas/session";

/**
 * Learner-state reducer (spec §8). PURE: every function returns a NEW state and
 * never mutates its input (JSONB mutation gotcha, spec §12.9).
 *
 * Signals → directives:
 *   - hit rate over last 10 scored cards (≥8 samples): >0.9 → `level` steps up;
 *     <0.65 → steps down + scaffoldNext = missed concepts; in the flow zone it
 *     relaxes one step back toward the level they dialled. It never wanders more
 *     than LEVEL_DRIFT off `globalLevel` — the dial is a statement, not a hint.
 *   - two consecutive misses on one node → recapDue = that concept (the node
 *     is the concept granularity the schema knows; the label is the missed
 *     card's gist so the writer knows WHAT to recap).
 *   - median dwell < 1.8s over ≥5 consecutive non-interactive → pace "compress".
 *   - dwell > 25s or scroll-back on a teaching card (concept/code/diagram/reveal)
 *     → recapDue = that card's concept. Recaps, checkpoints, hooks and system
 *     cards never trigger a recap (no recap-of-a-recap chains).
 *   - explicit dial: globalLevel ±1 (1..5), simplerTaps/deeperTaps++.
 */

export const DWELL_CAP_MS = 60_000;
export const HIT_RATE_HIGH = 0.9;
export const HIT_RATE_LOW = 0.65;
/** Scored samples needed before difficulty moves (spec: "over last 10"; a nearly full window, not 5). */
export const MIN_SAMPLES = 8;
/** Non-interactive dwell samples needed before pace can flip to "compress". */
export const MIN_DWELL_SAMPLES = 5;
export const COMPRESS_MEDIAN_MS = 1800;
export const LONG_DWELL_MS = 25_000;
/** How far the measured level may drift from the level the reader dialled, in either direction. */
export const LEVEL_DRIFT = 2;
const KEEP_INTERACTIVE = 10;
const KEEP_DWELL = 8;
const KEEP_MISSES = 5;

export type InteractionEvent = {
  card: Card;
  interaction: Interaction;
  /** user scrolled back up to this card */
  scrollBack?: boolean;
  /** true when this event carries the FIRST answer for a scored card (guards double counting) */
  firstAnswer?: boolean;
  /** this card already reported dwell before (hide/resume split, revisit): `interaction.dwellMs` is the CUMULATIVE
   *  dwell — evaluate the long-dwell trigger on it but do not push a second pace sample for the same card */
  repeatVisit?: boolean;
};

/**
 * Content cards whose dwell means something for pace — i.e. cards the reader
 * READS. `stat` was added to the deck in schema v2 and never added here, so the
 * single fastest-growing card type contributed nothing to the pace signal.
 *
 * `open` is deliberately NOT here even though it is also new: its dwell is
 * dominated by typing an answer, not by reading, so counting it would read a
 * thoughtful reply as a slow reader and trigger compression on someone who is
 * doing exactly what we asked.
 */
const DWELL_TYPES = new Set(["hook", "concept", "code", "diagram", "reveal", "checkpoint", "recap", "stat"]);
/** Teaching cards where a long dwell / scroll-back means "stuck" → recap. Recap/checkpoint/hook never re-trigger. */
export const RECAP_TRIGGER_TYPES = new Set(["concept", "code", "diagram", "reveal"]);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Short label for the concept a card is about: the card's substantive text
 * (bet prompt, headline, title, setup) — never the eyebrow first, which the
 * writer fills with stylistic labels ("hot take", "the footgun") that would
 * collapse every miss into one meaningless "concept".
 */
export function conceptOf(card: Card): string {
  const c = card as Record<string, unknown>;
  const raw =
    (typeof c.headline === "string" && c.headline.trim()) ||
    (typeof c.prompt === "string" && c.prompt.trim()) ||
    (typeof c.title === "string" && c.title.trim()) ||
    (typeof c.setup === "string" && c.setup.trim()) ||
    (typeof c.label === "string" && c.label.trim()) ||
    (typeof c.eyebrow === "string" && c.eyebrow.trim()) ||
    card.type;
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pushKeep<T>(arr: T[], v: T, keep: number): T[] {
  const out = [...arr, v];
  return out.length > keep ? out.slice(out.length - keep) : out;
}

/** Union of recent missed concepts across nodes, most recent last, deduped. */
export function missedConcepts(state: LearnerState, cap = 3): string[] {
  const all: string[] = [];
  for (const node of Object.values(state.perNode)) for (const c of node.lastMissConcepts) all.push(c);
  const dedup = Array.from(new Set(all.reverse())).reverse(); // keep last occurrence order
  return dedup.slice(-cap);
}

/**
 * The finer-grained reading the level rounds off. Each scored answer pulls `ability` toward a notch
 * above what they just nailed (or a notch below what they just missed), and the pull shrinks as
 * evidence piles up — so the first answer moves it a lot and the fortieth barely at all. The level
 * ladder below is deliberately coarse and slow; this is the number that remembers the detail.
 */
function nudgeAbility(next: LearnerState, card: Card, correct: boolean): void {
  const difficulty = typeof (card as { difficulty?: unknown }).difficulty === "number"
    ? clamp((card as { difficulty: number }).difficulty, 1, 5)
    : next.level;
  const target = clamp(difficulty + (correct ? 1 : -1), 1, 5);
  const weight = 1 / (next.abilityItems + 3);
  next.ability = clamp(Math.round((next.ability + (target - next.ability) * weight) * 100) / 100, 1, 5);
  next.abilityItems += 1;
}

/** Where `level` is allowed to sit: within LEVEL_DRIFT of the dial, and always inside 1..5. */
function levelBounds(state: LearnerState): [number, number] {
  return [clamp(state.globalLevel - LEVEL_DRIFT, 1, 5), clamp(state.globalLevel + LEVEL_DRIFT, 1, 5)];
}

/** Move `level` and stamp when it moved. The stamp is what later steps read to avoid yo-yoing. */
function setLevel(next: LearnerState, value: number): void {
  const [lo, hi] = levelBounds(next);
  const v = clamp(Math.round(value), lo, hi);
  if (v === next.level) return;
  next.level = v;
  next.levelSetAt = Date.now();
}

/** Recompute level/pace/scaffold from the rolling windows. */
function recomputeDirectives(next: LearnerState, opts: { scored: boolean }): void {
  const d = next.directives;
  const last10 = next.rolling.last10Interactive;
  if (opts.scored && last10.length >= MIN_SAMPLES) {
    const rate = last10.filter(Boolean).length / last10.length;
    if (rate > HIT_RATE_HIGH) setLevel(next, next.level + 1);
    else if (rate < HIT_RATE_LOW) setLevel(next, next.level - 1);
    else if (next.level !== next.globalLevel) setLevel(next, next.level + (next.level > next.globalLevel ? -1 : 1));
    d.scaffoldNext = rate < HIT_RATE_LOW ? missedConcepts(next) : [];
  }
  const dw = next.rolling.dwellMs;
  d.pace = dw.length >= MIN_DWELL_SAMPLES && median(dw) < COMPRESS_MEDIAN_MS ? "compress" : "normal";
}

export function applyInteraction(state: LearnerState, ev: InteractionEvent): LearnerState {
  const next = clone(state);
  next.version = LEARNER_STATE_VERSION;
  const { card, interaction } = ev;
  const concept = conceptOf(card);
  const scored = isScored(card) && typeof interaction.correct === "boolean" && ev.firstAnswer !== false;

  if (scored) {
    const correct = interaction.correct === true;
    nudgeAbility(next, card, correct);
    const node = next.perNode[card.topicNodeId] ?? {
      attempts: 0, hits: 0, lastMissConcepts: [], consecutiveMisses: 0,
    };
    const lastMiss = correct ? node.lastMissConcepts : pushKeep(node.lastMissConcepts.filter((c) => c !== concept), concept, KEEP_MISSES);
    const consecutiveMisses = correct ? 0 : (node.consecutiveMisses ?? 0) + 1;
    next.perNode = {
      ...next.perNode,
      [card.topicNodeId]: {
        ...node,
        attempts: node.attempts + 1,
        hits: node.hits + (correct ? 1 : 0),
        lastMissConcepts: lastMiss,
        consecutiveMisses,
      },
    };
    next.rolling = {
      ...next.rolling,
      last10Interactive: pushKeep(next.rolling.last10Interactive, correct, KEEP_INTERACTIVE),
      dwellMs: [], // an interactive card breaks the non-interactive dwell streak
    };
    if (consecutiveMisses >= 2) next.directives.recapDue = concept;
  } else if (isInteractive(card)) {
    // slider (unscored): breaks the dwell streak, nothing else
    next.rolling = { ...next.rolling, dwellMs: [] };
  } else if (DWELL_TYPES.has(card.type) && typeof interaction.dwellMs === "number") {
    const dwell = clamp(interaction.dwellMs, 0, DWELL_CAP_MS);
    if (!ev.repeatVisit) {
      // one pace sample per card: a hide/resume split or a revisit reports again with the cumulative dwell
      const dwellMs = pushKeep(next.rolling.dwellMs, dwell, KEEP_DWELL);
      next.rolling = {
        ...next.rolling,
        dwellMs,
        avgDwellMs: Math.round(dwellMs.reduce((a, b) => a + b, 0) / dwellMs.length),
      };
    }
    if (dwell > LONG_DWELL_MS && RECAP_TRIGGER_TYPES.has(card.type)) next.directives.recapDue = concept;
  }
  if (ev.scrollBack && RECAP_TRIGGER_TYPES.has(card.type)) next.directives.recapDue = concept;

  recomputeDirectives(next, { scored });
  return next;
}

export function applyDial(state: LearnerState, direction: "simpler" | "deeper"): LearnerState {
  const next = clone(state);
  // the dial moves what they asked for; the measured offset they've earned rides along with it
  const drift = next.level - next.globalLevel;
  next.globalLevel = clamp(next.globalLevel + (direction === "simpler" ? -1 : 1), 1, 5);
  next.level = clamp(next.globalLevel + drift, 1, 5);
  next.levelSetAt = Date.now();
  next.prefs = {
    ...next.prefs,
    simplerTaps: next.prefs.simplerTaps + (direction === "simpler" ? 1 : 0),
    deeperTaps: next.prefs.deeperTaps + (direction === "deeper" ? 1 : 0),
  };
  return next;
}

/**
 * After a recap card has been inserted (or the trigger was consumed) for
 * `directives.recapDue`. Pass the node when the recap answered a miss streak:
 * the streak resets so the 3rd/4th miss doesn't spawn yet another recap — the
 * concept has to be re-tested first (spec §8 "one recap card … re-test later").
 */
export function clearRecap(state: LearnerState, nodeId?: string): LearnerState {
  const next = clone(state);
  next.directives.recapDue = null;
  if (nodeId && next.perNode[nodeId]) {
    next.perNode = { ...next.perNode, [nodeId]: { ...next.perNode[nodeId], consecutiveMisses: 0 } };
  }
  return next;
}

/** After a scaffold card has been inserted. */
export function clearScaffold(state: LearnerState): LearnerState {
  const next = clone(state);
  next.directives.scaffoldNext = [];
  return next;
}

/**
 * Concepts an `open` answer half-missed. A "close" verdict is still a hit — they
 * said the idea back — so the hit/miss ledger is untouched; only the writer's
 * "what wobbled" list grows, which is what steers the next batch.
 */
export function noteMissedConcepts(state: LearnerState, nodeId: string, concepts: readonly string[]): LearnerState {
  const clean = Array.from(
    new Set(
      concepts
        .map((c) => c.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((c) => (c.length > 48 ? `${c.slice(0, 47).trimEnd()}…` : c)),
    ),
  );
  if (clean.length === 0) return state;
  const next = clone(state);
  const node = next.perNode[nodeId] ?? { attempts: 0, hits: 0, lastMissConcepts: [], consecutiveMisses: 0 };
  let list = node.lastMissConcepts;
  for (const c of clean) list = pushKeep(list.filter((x) => x !== c), c, KEEP_MISSES);
  next.perNode = { ...next.perNode, [nodeId]: { ...node, lastMissConcepts: list } };
  return next;
}

/** A detour question about `focus` → the writer is told to reinforce it (most recent 3; older ones expire). */
export function addReinforce(state: LearnerState, focus: string, cap = 3): LearnerState {
  const next = clone(state);
  const f = focus.trim();
  if (!f) return next;
  next.directives.reinforce = pushKeep(next.directives.reinforce.filter((x) => x !== f), f, cap);
  return next;
}

/** Reinforce directives expire: when the outline moves to the next node only the most recent `keep` survive. */
export function trimReinforce(state: LearnerState, keep = 1): LearnerState {
  if (state.directives.reinforce.length <= keep) return state;
  const next = clone(state);
  next.directives.reinforce = next.directives.reinforce.slice(-keep);
  return next;
}

/** Sync prefs from session settings (chill/depth) without touching signals. */
export function withPrefs(state: LearnerState, prefs: Partial<Pick<LearnerState["prefs"], "chillMode" | "depthPreset">>): LearnerState {
  const next = clone(state);
  next.prefs = { ...next.prefs, ...prefs };
  return next;
}

/**
 * Short stable hash of the parts of learner state that change what the writer
 * produces. This hash is part of the generation frontier key
 * (`frontierKeyFor`), so anything in here that moves on an ordinary tap splits
 * the frontier: an in-flight batch and the next request claim two different
 * keys for the SAME runway slot, and the model gets paid twice to write it.
 *
 * So the rule is narrow and mechanical: hash ONLY what the writer prompt
 * actually reads and what persists. `perNode`'s raw counters used to be in
 * here, and they move on every single scored answer — while
 * `lib/prompts/shared.ts` never reads `perNode` at all. Their real influence
 * reaches the writer as `directives.scaffoldNext`, which is hashed, so nothing
 * is lost by dropping them.
 *
 * Rolling windows are excluded for the same reason (a dwell report is not a
 * new frontier), which does mean `rolling.last10Interactive` reaches the prompt
 * without reaching the key — deliberate: it is noise that would otherwise
 * re-key the runway on every card.
 *
 * v2 added `ability`, `abilityItems` and `ledger`, and `directives.due` is a
 * projection of the ledger — all four move on ordinary cards, so all four stay
 * out. What they're for reaches the writer through `level`, which is hashed and
 * only steps when the reading genuinely changed.
 */
export function learnerStateHash(state: LearnerState): string {
  const key = JSON.stringify([
    state.version,
    state.globalLevel,
    state.level,
    state.prefs.chillMode,
    state.prefs.depthPreset,
    state.prefs.simplerTaps,
    state.prefs.deeperTaps,
    state.directives.pace,
    state.directives.scaffoldNext,
    state.directives.recapDue,
    state.directives.reinforce,
  ]);
  return createHash("sha1").update(key).digest("hex").slice(0, 10);
}
