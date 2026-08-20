import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { devSorted } from "./slides";

/**
 * The depth rail model (the reader's #1 ask: "where am I, how much is below me, how much of it
 * actually exists yet"). Replaces the horizontal timeline: the feed is vertical, so position maps
 * to geometry 1:1 — everything here is a fraction of one vertical track.
 *
 *   0 ──────────── the top of the thread
 *   ▓▓ read        solid: where the reader has actually been
 *   ● thumb        the reader (never at 0 once the plan lands — the paste + plan + first cards
 *                  are distance already travelled)
 *   ▒▒ exists      cards WRITTEN and waiting below — exact, the deck is in hand or counted
 *   ── planned     dimmer continuation: the outline says it's coming, nothing is written yet
 *   1 ──────────── the bottom (fades out while the outline is still open; hard cap on a wrap)
 *
 * Spans are PROPORTIONAL to each topic's card count — the real written count where cards exist,
 * the outline estimate where they don't. The honesty rule from the old bar survives intact: while
 * a topic is OPEN its denominator is at least written+1, so its written band can never touch the
 * end of its span. Only membership of the server's `closed` list fills a span.
 *
 * Pure + unit-tested (tests/feed.rail.test.ts). No numbers leave this file for the rail itself —
 * `unitsAhead` exists ONLY for the map sheet's on-demand "~N min left" line, never for ambient UI.
 */

export type OutlineLike = ReadonlyArray<{ id: string; title: string; estCards?: number }>;

export type SegmentState = "done" | "current" | "ahead";

/**
 * What the server counted, structurally. Deliberately NOT `FrontierPublic` — lib/feed is client
 * geometry and must not depend on the API contract; anything that can count nodes fits this shape,
 * including the /dev fixtures. Absent means nobody counted, and the rail says only what the local
 * rows can prove.
 */
export type FrontierLike = {
  /** outline node id → main-thread cards that EXIST for it. only written nodes appear; a missing node is zero. */
  written?: Record<string, number>;
  /** node id → extra cards a "one more layer here" tap bought there. */
  deeper?: Record<string, number>;
  /** node ids the writer has finished. the ONLY thing that can fill a span. */
  closed?: readonly string[];
  /** a batch is in flight right now, in this outline node. */
  live?: { nodeIdx: number } | null;
  /** generation is parked on the reader (an unanswered fork) or ended for good (the wrap). */
  gate?: "crossroads" | "wrap" | null;
};

export type RailSpan = {
  nodeId: string;
  title: string;
  state: SegmentState;
  /** 0..1 — this topic's slice of the whole rail, proportional to its card count. */
  from: number;
  to: number;
  /** 0..1 absolute — cards exist from `from` down to here. an OPEN span never reaches `to`. */
  writtenTo: number;
};

export type RailModel = {
  spans: RailSpan[];
  /** interior topic boundaries, 0..1 — the tick marks. */
  ticks: number[];
  /** the reader, 0..1. endowed: never 0 once anything exists. */
  thumb: number;
  /** the writing frontier, 0..1 — where contiguous written rail ends. the pulse lives here. */
  written: number;
  /** a batch is in flight right now → the boundary between written and unwritten carries the pulse. */
  live: boolean;
  /** the rail STOPS here: an unanswered fork (downstream dimmed) or the wrap (hard end cap). */
  gate: { kind: "crossroads" | "wrap"; at: number } | null;
  /** the thread ended on request — the rail is all written, capped, nothing dim below. */
  wrapped: boolean;
  /** planned-but-unwritten rail exists below — the dim zone fades out at the bottom ("it keeps going"). */
  open: boolean;
  /** the reader is off the main thread: a second track doubles beside the main one for this span. */
  detour: { at: number; span: number } | null;
  /** the remaining sliver of the current topic, once the reader is in its last quarter. */
  goal: { from: number; to: number } | null;
  currentIndex: number;
  /** outline node the reader is in (null when there is no outline yet). */
  nodeId: string | null;
  title: string;
  /** the reader is standing on a detour row. */
  onDetour: boolean;
  /** cards (written + estimated) below the reader — map-sheet effort math ONLY, never ambient. */
  unitsAhead: number;
};

/** The thumb the moment the plan lands: visibly past zero. The paste already travelled distance. */
export const ENDOWED_MIN = 0.045;

/** The reader has entered the last quarter of a topic → the remaining sliver brightens. */
const GOAL_QUARTER = 0.75;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Index of the outline node a card belongs to, or -1 when it serves none (system / clarify / extension). */
function outlineIndexOf(card: Card, index: ReadonlyMap<string, number>): number {
  return index.get(card.topicNodeId) ?? -1;
}

/**
 * Which outline node the reader is standing in. System cards (notices, clarify, fallbacks) and
 * cards written past the end of the outline carry node ids that aren't in it — those inherit the
 * nearest real topic behind them, then ahead of them, so the rail never jumps to a random span.
 */
export function resolveNodeIndex(sorted: readonly CardRow[], at: number, index: ReadonlyMap<string, number>): number {
  if (at < 0) return sorted.length ? Math.max(0, outlineIndexOf(sorted[0].payload as Card, index)) : 0;
  for (let i = at; i >= 0; i--) {
    const n = outlineIndexOf(sorted[i].payload as Card, index);
    if (n >= 0) return n;
  }
  for (let i = at + 1; i < sorted.length; i++) {
    const n = outlineIndexOf(sorted[i].payload as Card, index);
    if (n >= 0) return n;
  }
  return 0;
}

/**
 * Which span generation stopped on — read off the row that stopped it (the unanswered fork, the
 * wrap that ended the thread) rather than off a counter, so the mark lands on the topic the reader
 * is actually being asked about even when they have scrolled back up.
 */
function gateIndexOf(
  sorted: readonly CardRow[],
  gate: "crossroads" | "wrap",
  index: ReadonlyMap<string, number>,
  fallback: number,
): number {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const row = sorted[i];
    if (row.detourId) continue;
    const card = row.payload as Card;
    const stops = gate === "wrap" ? card.type === "wrap" : card.type === "crossroads" && row.interaction?.choice === undefined;
    if (!stops) continue;
    const n = outlineIndexOf(card, index);
    if (n >= 0) return n;
  }
  return fallback;
}

export function railModel(
  cards: readonly CardRow[],
  outline: OutlineLike | undefined,
  activeRowId: string | null,
  frontier?: FrontierLike,
): RailModel {
  // the feed keeps its rows sorted by construction; verified (and repaired) only outside production
  const sorted = devSorted(cards, "railModel");
  const at = activeRowId ? sorted.findIndex((c) => c.id === activeRowId) : -1;
  const activeRow = at >= 0 ? sorted[at] : null;
  const onDetour = !!activeRow?.detourId;
  const gateKind = frontier?.gate ?? null;

  // no plan yet: one span the whole deck fills — everything in hand exists, and the bottom stays
  // open because nobody has said where this ends
  if (!outline || outline.length === 0) {
    const read = sorted.length ? clamp01((at + 1) / sorted.length) : 0;
    const thumb = sorted.length ? Math.max(read, ENDOWED_MIN) : 0;
    return {
      spans: [{ nodeId: "", title: "", state: "current", from: 0, to: 1, writtenTo: sorted.length ? 1 : 0 }],
      ticks: [],
      thumb,
      written: sorted.length ? 1 : 0,
      live: false,
      gate: gateKind ? { kind: gateKind, at: 1 } : null,
      wrapped: gateKind === "wrap",
      open: !gateKind,
      detour: onDetour ? { at: thumb, span: 0.04 } : null,
      goal: null,
      currentIndex: 0,
      nodeId: null,
      title: "",
      onDetour,
      unitsAhead: Math.max(0, sorted.length - 1 - at),
    };
  }

  const index = new Map(outline.map((n, i) => [n.id, i]));
  const currentIndex = resolveNodeIndex(sorted, at, index);
  const node = outline[currentIndex];

  // per topic: the main-thread rows we hold, and how many of them the reader has already passed.
  // measured on the MAIN thread only — standing on a detour freezes the thumb where you branched
  // off (you did not advance the story by asking). detour rows are counted for the doubled track.
  const local = outline.map(() => 0);
  const behind = outline.map(() => 0);
  let detourUnits = 0;
  const activeDetourId = activeRow?.detourId ?? null;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (row.detourId) {
      if (activeDetourId && row.detourId === activeDetourId) detourUnits += 1;
      continue;
    }
    const n = outlineIndexOf(row.payload as Card, index);
    if (n < 0) continue;
    local[n] += 1;
    if (at >= 0 && i <= at) behind[n] += 1;
  }

  const closed = new Set(frontier?.closed ?? []);
  const wrapped = gateKind === "wrap";

  // per topic, in the same units: how many cards its span is worth, and how many of those exist.
  // the server's census and our own rows disagree constantly (it excludes scaffolding, we hold rows
  // it hasn't re-counted); take whichever saw more so the band never flinches.
  const units = outline.map((n, i) => {
    const est = n.estCards ?? 0;
    const written = Math.max(frontier?.written?.[n.id] ?? 0, local[i]);
    const deeper = frontier?.deeper?.[n.id] ?? 0;
    // the +1 is the whole point: an OPEN topic can never be drawn as fully written, however far
    // past its estimate the writer has run. only a closed topic gets to touch the end of its span.
    const total = closed.has(n.id) ? Math.max(written, 1) : Math.max(est + deeper, written + 1, 1);
    // a wrapped thread has no "coming" — the rail is exactly what was written, capped
    return wrapped ? { total: written, written } : { total, written };
  });

  const totalUnits = units.reduce((s, u) => s + u.total, 0) || 1;
  let cum = 0;
  const spans: RailSpan[] = outline.map((n, i) => {
    const from = cum / totalUnits;
    cum += units[i].total;
    const to = cum / totalUnits;
    const frac = units[i].total > 0 ? units[i].written / units[i].total : 0;
    return {
      nodeId: n.id,
      title: n.title,
      state: i < currentIndex ? "done" : i === currentIndex ? "current" : "ahead",
      from,
      to,
      writtenTo: clamp01(from + frac * (to - from)),
    };
  });

  const ticks = spans.slice(0, -1).map((s) => s.to).filter((t) => t > 0 && t < 1);

  // the writing frontier: written rail is contiguous from the top; it ends at the first span that
  // isn't fully written. spans written further down (a census that ran ahead) still DRAW solid in
  // place, but the pulse and the end-cap live at the contiguous edge.
  let written = 0;
  for (const s of spans) {
    written = s.writtenTo;
    if (s.writtenTo < s.to - 1e-9) break;
  }
  if (wrapped) written = 1;

  // the reader, in the same units — behind/total keeps the thumb inside the honest denominator,
  // so it can never overtake the written edge of its own span
  const span = spans[currentIndex];
  const readFrac = units[currentIndex].total > 0 ? clamp01(behind[currentIndex] / units[currentIndex].total) : 0;
  let thumb = span.from + readFrac * (span.to - span.from);
  thumb = Math.min(thumb, span.writtenTo);
  // endowed progress: the paste + the plan + the first cards ARE distance travelled — the thumb
  // never sits at zero once anything exists, even before the first swipe
  if (sorted.length > 0) thumb = Math.max(thumb, ENDOWED_MIN);

  const liveIdx = frontier?.live ? Math.min(outline.length - 1, Math.max(0, frontier.live.nodeIdx)) : -1;
  // a fork claims no batch, so a pulse at a gate would be a promise nothing is keeping
  const live = !gateKind && liveIdx >= 0;

  const gate = gateKind
    ? { kind: gateKind, at: wrapped ? 1 : spans[gateIndexOf(sorted, gateKind, index, currentIndex)].writtenTo }
    : null;

  const open = !wrapped && spans.some((s) => s.writtenTo < s.to - 1e-9);

  // goal gradient: inside the last quarter of the current topic, the remaining sliver brightens
  const spanLen = span.to - span.from;
  const intoSpan = spanLen > 0 ? (thumb - span.from) / spanLen : 0;
  const goal = intoSpan >= GOAL_QUARTER && thumb < span.to - 1e-9 ? { from: thumb, to: span.to } : null;

  // the doubled track: the detour hangs beside where the reader branched off, sized like its cards
  const detour = onDetour ? { at: thumb, span: Math.max(0.02, detourUnits / totalUnits) } : null;

  const unitsAhead = Math.max(0, Math.round((1 - thumb) * totalUnits));

  return {
    spans,
    ticks,
    thumb: clamp01(thumb),
    written: clamp01(written),
    live,
    gate,
    wrapped,
    open,
    detour,
    goal,
    currentIndex,
    nodeId: node.id,
    title: node.title,
    onDetour,
    unitsAhead,
  };
}
