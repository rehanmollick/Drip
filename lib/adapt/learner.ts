import { createHash } from "crypto";
import { isInteractive, isScored, type Card } from "@/lib/schemas/cards";
import { LEARNER_STATE_VERSION, type LearnerState } from "@/lib/schemas/learner";
import type { Interaction } from "@/lib/schemas/session";
import { abilityAfter, creditFor } from "./ability";
import { anchorOf, conceptOf } from "./anchors";
import { pullForward } from "./schedule";

/**
 * Learner-state reducer (spec §8). PURE: every function returns a NEW state and
 * never mutates its input (JSONB mutation gotcha, spec §12.9).
 *
 * Signals → directives:
 *   - every scored answer feeds the ability estimate (lib/adapt/ability.ts), which is what decides
 *     `level`. It reads the card's own `difficulty`, discounts what could have been a guess, and
 *     will not move the notch the writer is handed until the reading has genuinely left it. The
 *     ±1-per-card ratchet this replaced saturated to the ceiling on two lucky taps.
 *   - hit rate under HIT_RATE_LOW over the last 10 scored cards (≥8 samples) → scaffoldNext = the
 *     concepts they missed. It no longer touches `level`; that is the estimate's job now.
 *   - two consecutive misses on one node → recapDue = that concept (the node
 *     is the concept granularity the schema knows; the label is the missed
 *     card's gist so the writer knows WHAT to recap).
 *   - median dwell < 1.8s over ≥5 consecutive non-interactive → pace "compress".
 *   - dwell > 25s on a teaching card (concept/code/diagram/reveal) → recapDue. The phone-in-pocket
 *     objection does not apply: lib/dwell.ts already pauses the clock on visibilitychange/pagehide
 *     and hard-caps a single dwell at 60s, so what reaches here is 25s of ACTIVE foreground reading
 *     on one card — which is someone stuck, not someone who answered the door.
 *   - scroll-back on a teaching card (concept/code/diagram/reveal) → recapDue = that card's
 *     concept, AND the idea is pulled forward in the retrieval queue. Nobody scrolls UP in a feed
 *     by accident. A long dwell used to fire the same trigger and no longer does: on a phone,
 *     30 seconds on a card is as likely to be a doorbell as confusion, and it was spending a
 *     recap on readers who had simply put the phone down.
 *   - explicit dial: globalLevel ±1 (1..5), simplerTaps/deeperTaps++.
 */

export { conceptOf };

export const DWELL_CAP_MS = 60_000;
export const HIT_RATE_LOW = 0.65;
/** Scored samples needed before difficulty moves (spec: "over last 10"; a nearly full window, not 5). */
export const MIN_SAMPLES = 8;
/** Non-interactive dwell samples needed before pace can flip to "compress". */
export const MIN_DWELL_SAMPLES = 5;
export const COMPRESS_MEDIAN_MS = 1800;
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
   *  dwell — do not push a second pace sample for the same card */
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
/** Teaching cards where a scroll-back means "stuck" → recap. Recap/checkpoint/hook never re-trigger. */
/** Active foreground reading past this on one teaching card reads as stuck (dripSpec §271). */
export const LONG_DWELL_MS = 25_000;
export const RECAP_TRIGGER_TYPES = new Set(["concept", "code", "diagram", "reveal"]);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

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

/** Recompute pace/scaffold from the rolling windows. `level` comes from the ability estimate. */
function recomputeDirectives(next: LearnerState, opts: { scored: boolean }): void {
  const d = next.directives;
  const last10 = next.rolling.last10Interactive;
  if (opts.scored && last10.length >= MIN_SAMPLES) {
    // the hit rate only decides whether the writer re-angles what they missed — `level` is the
    // ability estimate's call, and a rate over a 10-card window is far too jumpy to make it
    const rate = last10.filter(Boolean).length / last10.length;
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
    if (!next.prefs.chillMode) {
      // chill mode is the setting for reading, not for being measured — nothing it does moves the dial
      const read = abilityAfter(next, card, creditFor(interaction));
      next.ability = read.ability;
      next.abilityItems = read.abilityItems;
      setLevel(next, read.level);
    }
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
    // outside the repeat-visit guard on purpose: a dwell split by a lock/resume still adds up to
    // someone who has been sitting on this one card, and that is the whole signal.
    if (dwell > LONG_DWELL_MS && RECAP_TRIGGER_TYPES.has(card.type)) next.directives.recapDue = concept;
  }
  if (ev.scrollBack && RECAP_TRIGGER_TYPES.has(card.type)) {
    next.directives.recapDue = concept;
    // they went back for this one: the schedule stops waiting and asks about it soon
    next.directives.due = pullForward(next.directives.due, anchorOf(card));
  }

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
 * Concepts an `open` answer half-missed. A "close" verdict still counts as a hit in the node
 * ledger — they said the idea back — and as half credit to the ability estimate, which is where
 * "one piece off" actually belongs. Here only the writer's "what wobbled" list grows, which is
 * what steers the next batch.
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
