import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sortCards } from "./slides";

/**
 * The timeline model (the reader's #1 ask: "where am I, how much of this topic is left").
 *
 * ONE SEGMENT PER OUTLINE NODE, in order — structure, never a counter. Each segment carries two
 * fractions of the same track: `read`, where the reader actually is, and `buffered`, how much of the
 * topic has been WRITTEN and is sitting ahead of them. The bar used to conflate the two, so a topic
 * the writer had guessed at looked exactly like one it had finished. Now the gap between the two
 * bands IS the runway, and the gap after `buffered` is the part that does not exist yet.
 *
 * The one rule that keeps it honest: while a topic is still open the denominator is at least
 * `written + 1`, so `buffered` can never reach the end of a topic the writer hasn't closed. Only
 * membership of the server's `closed` list can fill a segment.
 *
 * Pure + unit-tested (tests/feed.timeline.test.ts). No numbers ever leave this file.
 */

export type OutlineLike = ReadonlyArray<{ id: string; title: string; estCards?: number }>;

export type SegmentState = "done" | "current" | "ahead";

/**
 * What the server counted, structurally. Deliberately NOT `FrontierPublic` — lib/feed is client
 * geometry and must not depend on the API contract; anything that can count nodes fits this shape,
 * including the /dev fixtures. Absent means nobody counted, and the bar says nothing it can't back up.
 */
export type FrontierLike = {
  /** outline node id → main-thread cards that EXIST for it. */
  written?: Record<string, number>;
  /** node id → extra cards a "one more layer here" tap bought there. */
  deeper?: Record<string, number>;
  /** node ids the writer has finished. the ONLY thing that can fill a segment. */
  closed?: readonly string[];
  /** a batch is in flight right now, in this outline node. */
  live?: { nodeIdx: number } | null;
  /** generation is parked on the reader (an unanswered fork) or ended for good (the wrap). */
  gate?: "crossroads" | "wrap" | null;
};

export type Segment = {
  nodeId: string;
  title: string;
  state: SegmentState;
  /** 0..1 — how far through this topic the reader has actually been (1 for done, 0 for ahead). */
  read: number;
  /** 0..1 — how much of this topic is written and waiting. always ≥ read; only `closed` reaches 1. */
  buffered: number;
  /** a batch is being written into this topic RIGHT NOW. */
  live: boolean;
  /** generation stopped here, on the reader. */
  gate: "crossroads" | "wrap" | null;
  /** what the bar has always drawn. an exact alias of `read`. */
  fill: number;
  /** the reader is off the main thread inside this topic. */
  detour: boolean;
};

export type TimelineModel = {
  segments: Segment[];
  currentIndex: number;
  /** outline node the reader is in (null when there is no outline yet). */
  nodeId: string | null;
  title: string;
  detour: boolean;
  /** what the whole thread is parked on, if anything. */
  gate: "crossroads" | "wrap" | null;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Index of the outline node a card belongs to, or -1 when it serves none (system / clarify / extension). */
function outlineIndexOf(card: Card, index: ReadonlyMap<string, number>): number {
  return index.get(card.topicNodeId) ?? -1;
}

/**
 * Which outline node the reader is standing in. System cards (notices, clarify, fallbacks) and
 * cards written past the end of the outline carry node ids that aren't in it — those inherit the
 * nearest real topic behind them, then ahead of them, so the bar never jumps to a random segment.
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
 * Which segment generation stopped on — read off the row that stopped it (the unanswered fork, the
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

export function timelineModel(
  cards: readonly CardRow[],
  outline: OutlineLike | undefined,
  activeRowId: string | null,
  frontier?: FrontierLike,
): TimelineModel {
  const sorted = sortCards(cards);
  const at = activeRowId ? sorted.findIndex((c) => c.id === activeRowId) : -1;
  const activeRow = at >= 0 ? sorted[at] : null;
  const detour = !!activeRow?.detourId;
  const gate = frontier?.gate ?? null;

  // no plan yet: one segment that fills with the whole deck — the same hairline it replaces
  if (!outline || outline.length === 0) {
    const read = sorted.length ? clamp01((at + 1) / sorted.length) : 0;
    return {
      segments: [{ nodeId: "", title: "", state: "current", read, buffered: read, live: false, gate, fill: read, detour }],
      currentIndex: 0,
      nodeId: null,
      title: "",
      detour,
      gate,
    };
  }

  const index = new Map(outline.map((n, i) => [n.id, i]));
  const currentIndex = resolveNodeIndex(sorted, at, index);
  const node = outline[currentIndex];

  // per topic: the main-thread rows we hold, and how many of them the reader has already passed.
  // measured on the MAIN thread only — standing on a detour freezes the fill where you branched off
  // (you did not advance the story by asking).
  const local = outline.map(() => 0);
  const behind = outline.map(() => 0);
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (row.detourId) continue;
    const n = outlineIndexOf(row.payload as Card, index);
    if (n < 0) continue;
    local[n] += 1;
    if (at >= 0 && i <= at) behind[n] += 1;
  }

  const closed = new Set(frontier?.closed ?? []);
  const liveIdx = frontier?.live ? Math.min(outline.length - 1, Math.max(0, frontier.live.nodeIdx)) : -1;
  const gateIdx = gate ? gateIndexOf(sorted, gate, index, currentIndex) : -1;

  const segments = outline.map((n, i): Segment => {
    const est = n.estCards ?? 0;
    // the server's census and our own rows disagree constantly (it excludes scaffolding, we hold
    // rows it hasn't re-counted); take whichever saw more so the band never flinches
    const written = Math.max(frontier?.written?.[n.id] ?? 0, local[i]);
    const deeper = frontier?.deeper?.[n.id] ?? 0;
    // the +1 is the whole point: an OPEN topic can never be drawn as finished, however far past
    // its estimate the writer has run. only a closed topic gets to touch the end.
    const cap = closed.has(n.id) ? Math.max(written, 1) : Math.max(est + deeper, written + 1);
    // without a census there is nothing to draw a second band from, so the bar says exactly what it
    // always said and `buffered` collapses onto `read`
    const denom = frontier ? cap : Math.max(local[i], est, 1);
    const passed = i < currentIndex ? 1 : i > currentIndex ? 0 : clamp01(behind[i] / denom);
    const buffered = frontier ? clamp01(written / cap) : passed;
    const read = Math.min(passed, buffered);
    return {
      nodeId: n.id,
      title: n.title,
      state: i < currentIndex ? "done" : i === currentIndex ? "current" : "ahead",
      read,
      buffered,
      // a fork claims no batch, so a pulse over one would be a promise nothing is keeping
      live: !gate && i === liveIdx,
      gate: i === gateIdx ? gate : null,
      fill: read,
      detour: i === currentIndex && detour,
    };
  });

  return { segments, currentIndex, nodeId: node.id, title: node.title, detour, gate };
}
