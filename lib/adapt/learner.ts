import { createHash } from "crypto";
import { isInteractive, isScored, type Card } from "@/lib/schemas/cards";
import { LEARNER_STATE_VERSION, type LearnerState } from "@/lib/schemas/learner";
import type { Interaction } from "@/lib/schemas/session";

/**
 * Learner-state reducer (spec §8). PURE: every function returns a NEW state and
 * never mutates its input (JSONB mutation gotcha, spec §12.9).
 *
 * Signals → directives:
 *   - hit rate over last 10 scored cards (≥8 samples): >0.9 → difficultyDelta
 *     steps up (cap +2); <0.65 → steps down (cap −2) + scaffoldNext = missed
 *     concepts; in the flow zone the delta relaxes one step toward 0.
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

/** Content cards whose dwell means something for pace. */
const DWELL_TYPES = new Set(["hook", "concept", "code", "diagram", "reveal", "checkpoint", "recap"]);
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

/** Recompute the difficulty/pace/scaffold directives from the rolling windows. */
function recomputeDirectives(next: LearnerState, opts: { scored: boolean }): void {
  const d = next.directives;
  const last10 = next.rolling.last10Interactive;
  if (opts.scored && last10.length >= MIN_SAMPLES) {
    const rate = last10.filter(Boolean).length / last10.length;
    if (rate > HIT_RATE_HIGH) d.difficultyDelta = clamp(d.difficultyDelta + 1, -2, 2);
    else if (rate < HIT_RATE_LOW) d.difficultyDelta = clamp(d.difficultyDelta - 1, -2, 2);
    else if (d.difficultyDelta !== 0) d.difficultyDelta += d.difficultyDelta > 0 ? -1 : 1;
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
    const node = next.perNode[card.topicNodeId] ?? {
      level: next.globalLevel, attempts: 0, hits: 0, lastMissConcepts: [], consecutiveMisses: 0,
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
  next.globalLevel = clamp(next.globalLevel + (direction === "simpler" ? -1 : 1), 1, 5);
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
 * produces (level, prefs, directives, per-node calibration). Rolling windows
 * are excluded so ordinary dwell reports don't churn the generation frontier.
 */
export function learnerStateHash(state: LearnerState): string {
  const perNode = Object.keys(state.perNode)
    .sort()
    .map((k) => {
      const n = state.perNode[k];
      return [k, n.level, n.attempts, n.hits, n.consecutiveMisses, ...n.lastMissConcepts];
    });
  const key = JSON.stringify([
    state.version,
    state.globalLevel,
    state.prefs.chillMode,
    state.prefs.depthPreset,
    state.prefs.simplerTaps,
    state.prefs.deeperTaps,
    state.directives.difficultyDelta,
    state.directives.pace,
    state.directives.scaffoldNext,
    state.directives.recapDue,
    state.directives.reinforce,
    perNode,
  ]);
  return createHash("sha1").update(key).digest("hex").slice(0, 10);
}
