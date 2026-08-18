import type { Card, DetourMarkerCard } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sortCards } from "./slides";
import { resolveNodeIndex, type FrontierLike, type OutlineLike, type SegmentState } from "./timeline";

/**
 * The session map (long-press the timeline): the thread, in order, with the detours you took
 * hanging off the topic they branched from, and a mark on where you are.
 *
 * A topic you have actually been in is tappable and scrolls back to its first card. A topic you
 * have not reached is inert — the map orients, it never jumps ahead of what has been written.
 *
 * Each row also says which of two things it is: something already WRITTEN, or something still only
 * PLANNED. It is the same distinction the timeline's ghost band draws, appearing a second time —
 * one idea, two places — so "there is more of this waiting" and "this is just a heading so far"
 * stop looking identical. Two states on purpose: a four-state legend is one nobody was taught, and
 * the words that would teach it are the ones we don't use.
 *
 * Pure + unit-tested (tests/feed.map.test.ts).
 */

/** written = cards for it exist; planned = the outline says it's coming and nothing is written yet. */
export type Material = "written" | "planned";

export type MapDetour = {
  detourId: string;
  /** the question you asked, as written on the open marker. */
  label: string;
  firstRowId: string;
  state: SegmentState;
  reachable: boolean;
};

export type MapTopic = {
  nodeId: string;
  title: string;
  state: SegmentState;
  material: Material;
  firstRowId: string | null;
  reachable: boolean;
  detours: MapDetour[];
};

export function sessionMap(
  cards: readonly CardRow[],
  outline: OutlineLike | undefined,
  activeRowId: string | null,
  frontier?: FrontierLike,
): MapTopic[] {
  if (!outline || outline.length === 0) return [];
  const sorted = sortCards(cards);
  const index = new Map(outline.map((n, i) => [n.id, i]));
  const at = activeRowId ? sorted.findIndex((c) => c.id === activeRowId) : -1;
  const currentIndex = resolveNodeIndex(sorted, at, index);
  const activeDetourId = at >= 0 ? sorted[at].detourId : null;

  const topics: MapTopic[] = outline.map((n, i) => ({
    nodeId: n.id,
    title: n.title,
    state: i < currentIndex ? "done" : i === currentIndex ? "current" : "ahead",
    // the server's census sees rows we haven't pulled yet, so a topic can be written well before
    // any of it is in our hands; local rows fill in when nobody counted
    material: (frontier?.written?.[n.id] ?? 0) > 0 ? "written" : "planned",
    firstRowId: null,
    reachable: i === currentIndex,
    detours: [],
  }));

  const detourOf = new Map<string, MapDetour>();

  for (const row of sorted) {
    const card = row.payload as Card;
    const i = index.get(card.topicNodeId);
    if (i === undefined) continue;
    const topic = topics[i];
    const seen = row.viewedAt !== null;

    if (!row.detourId) {
      if (!topic.firstRowId) topic.firstRowId = row.id;
      topic.material = "written";
      if (seen) topic.reachable = true;
      continue;
    }

    let d = detourOf.get(row.detourId);
    if (!d) {
      d = { detourId: row.detourId, label: "", firstRowId: row.id, state: "ahead", reachable: false };
      detourOf.set(row.detourId, d);
      topic.detours.push(d);
    }
    if (!d.label && card.type === "detour_marker" && (card as DetourMarkerCard).kind === "open") {
      d.label = (card as DetourMarkerCard).question || (card as DetourMarkerCard).label;
    }
    if (seen) d.reachable = true;
  }

  // where you are wins; a detour you have been down is tappable; one still ahead of you is inert
  for (const d of detourOf.values()) {
    if (d.detourId === activeDetourId) {
      d.state = "current";
      d.reachable = true;
    } else if (d.reachable) d.state = "done";
  }
  for (const t of topics) if (!t.firstRowId) t.reachable = false;
  return topics;
}
