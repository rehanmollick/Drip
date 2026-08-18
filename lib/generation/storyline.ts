import type { OutlineNode } from "@/lib/schemas/plan";
import { StorylineSchema, type Storyline } from "@/lib/schemas/session";
import { clampText } from "./crossroads";

/**
 * The through-line. "last 6 cards" keeps a batch locally coherent but loses the
 * plot 40 slides deep, which is how a feed starts drifting into a different
 * subject — the reader asked for the opposite: "it should always remember the
 * main story line".
 *
 * Kept in `session.storyline` and passed into EVERY WriteContext. It advances
 * deterministically the moment a topic closes (no model call, so it can never
 * hold up a card) and is refreshed in the background by `llm.updateStoryline`
 * when that's available. Pure.
 */

const SPINE_CHARS = 280;
const COVERED_CHARS = 80;
const NEXT_CHARS = 120;
const MAX_COVERED = 12;
/** What "next" says once the outline is done. Reads fine inside a sentence. */
export const OPEN_ENDING = "wherever you want to take it next";

export function initialStoryline(title: string, outline: readonly OutlineNode[], lastIdx: string | null = null): Storyline {
  const titles = outline.map((n) => n.title);
  const spine = titles.length ? `${title}: ${titles.join(" → ")}` : title;
  return {
    spine: clampText(spine, SPINE_CHARS),
    covered: [],
    next: clampText(titles[0] ?? title, NEXT_CHARS),
    updatedAtIdx: lastIdx,
  };
}

/** A topic just closed: record it as landed and point at what's next. Never fails. */
export function advanceStoryline(
  prev: Storyline | null,
  opts: { title: string; outline: readonly OutlineNode[]; finishedIdx: number; lastIdx: string | null },
): Storyline {
  const base = prev ?? initialStoryline(opts.title, opts.outline, opts.lastIdx);
  const finished = opts.outline[opts.finishedIdx]?.title;
  const covered = [...base.covered];
  if (finished) {
    const line = clampText(finished, COVERED_CHARS);
    const at = covered.findIndex((c) => c.toLowerCase() === line.toLowerCase());
    if (at >= 0) covered.splice(at, 1);
    covered.push(line);
  }
  const next = opts.outline[opts.finishedIdx + 1]?.title;
  return {
    spine: base.spine,
    covered: covered.slice(-MAX_COVERED),
    next: clampText(next ?? OPEN_ENDING, NEXT_CHARS),
    updatedAtIdx: opts.lastIdx,
  };
}

/**
 * Fold a model-written storyline onto the one we already have. The model may
 * drop things it shouldn't; anything missing falls back to the previous value,
 * so a bad refresh can only ever be a no-op.
 */
export function mergeStoryline(prev: Storyline | null, incoming: unknown, lastIdx: string | null): Storyline | null {
  const parsed = StorylineSchema.safeParse(incoming);
  if (!parsed.success) return prev;
  const next = parsed.data;
  const spine = clampText(next.spine || prev?.spine || "", SPINE_CHARS);
  if (!spine) return prev;
  const covered = (next.covered.length ? next.covered : (prev?.covered ?? []))
    .map((c) => clampText(c, COVERED_CHARS))
    .filter(Boolean)
    .slice(-MAX_COVERED);
  return {
    spine,
    covered,
    next: clampText(next.next || prev?.next || OPEN_ENDING, NEXT_CHARS),
    updatedAtIdx: lastIdx ?? prev?.updatedAtIdx ?? null,
  };
}

/**
 * After a detour closes, the next main-thread batch has to walk the reader back
 * — otherwise the feed just resumes mid-sentence on a topic they left two
 * screens ago.
 */
export function reanchorDirective(storyline: Storyline | null, nodeTitle: string | null): string {
  const where = nodeTitle || storyline?.next || storyline?.covered.at(-1) || "the main thread";
  return `they just came back from a detour: open this batch by re-anchoring — "we were on ${clampText(where, 60)}" in your own words, one line, then carry on. never restate the detour.`;
}
