import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sortCards } from "./slides";

/**
 * The timeline model (the reader's #1 ask: "where am I, how much of this topic is left").
 *
 * ONE SEGMENT PER OUTLINE NODE, in order — structure, never a counter. The segment you are in
 * fills as you move through it, the ones behind you are solid, the ones ahead are faint, and a
 * detour tints the current segment so it is obvious you stepped off the main thread.
 *
 * Pure + unit-tested (tests/feed.timeline.test.ts). No numbers ever leave this file.
 */

export type OutlineLike = ReadonlyArray<{ id: string; title: string; estCards?: number }>;

export type SegmentState = "done" | "current" | "ahead";

export type Segment = {
  nodeId: string;
  title: string;
  state: SegmentState;
  /** 0..1 — how far through this topic the reader is (1 for done, 0 for ahead). */
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

export function timelineModel(
  cards: readonly CardRow[],
  outline: OutlineLike | undefined,
  activeRowId: string | null,
): TimelineModel {
  const sorted = sortCards(cards);
  const at = activeRowId ? sorted.findIndex((c) => c.id === activeRowId) : -1;
  const activeRow = at >= 0 ? sorted[at] : null;
  const detour = !!activeRow?.detourId;

  // no plan yet: one segment that fills with the whole deck — the same hairline it replaces
  if (!outline || outline.length === 0) {
    const fill = sorted.length ? clamp01((at + 1) / sorted.length) : 0;
    return {
      segments: [{ nodeId: "", title: "", state: "current", fill, detour }],
      currentIndex: 0,
      nodeId: null,
      title: "",
      detour,
    };
  }

  const index = new Map(outline.map((n, i) => [n.id, i]));
  const currentIndex = resolveNodeIndex(sorted, at, index);
  const node = outline[currentIndex];

  // progress through the current topic, measured on the MAIN thread only: standing on a detour
  // freezes the fill where you branched off (you did not advance the story by asking).
  const inNode = (c: CardRow) => !c.detourId && (c.payload as Card).topicNodeId === node.id;
  let total = 0;
  let behind = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (!inNode(sorted[i])) continue;
    total++;
    if (at >= 0 && i <= at) behind++;
  }
  const fill = clamp01(behind / Math.max(total, node.estCards ?? 0, 1));

  const segments = outline.map((n, i): Segment => ({
    nodeId: n.id,
    title: n.title,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "ahead",
    fill: i < currentIndex ? 1 : i === currentIndex ? fill : 0,
    detour: i === currentIndex && detour,
  }));

  return { segments, currentIndex, nodeId: node.id, title: node.title, detour };
}
