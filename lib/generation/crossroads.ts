import type { CrossroadsCard, WrapCard } from "@/lib/schemas/cards";
import type { OutlineNode } from "@/lib/schemas/plan";
import type { Storyline } from "@/lib/schemas/session";
import { uuid } from "@/lib/id";
import { SYSTEM_NODE } from "./system-cards";

/**
 * The two cards the engine builds itself, with no model call.
 *
 * The reader's words: "don't just keep autogenerating, it should ask before
 * generating more". A topic boundary is where that question belongs, and it
 * must never wait on a model — so the crossroads card is assembled from the
 * outline titles the planner already wrote. Same for the wrap card when
 * `llm.writeWrap` is unavailable: an ending you asked for always arrives.
 *
 * Copy rules (Prime Directive): lowercase, feed-native, no school vocabulary,
 * and NEVER a counter — the reader asked where they are, not for a grade.
 */

/** Longest a topic title may be inside a headline before it stops fitting one phone line. */
const HEADLINE_TITLE_CHARS = 34;
const FINISHED_CHARS = 60;
const UP_NEXT_LABEL_CHARS = 26;

export function clampText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Rotating so a long session doesn't ask the same question in the same words every time. */
const HEADLINES: ((topic: string) => string)[] = [
  (t) => `that's ${t}. where to?`,
  (t) => `ok, that's ${t} covered. what now?`,
  (t) => `you've got ${t}. where next?`,
  (t) => `end of ${t}. your call.`,
  (t) => `that's ${t} down. what now?`,
];

/**
 * Used when the topic title won't sit inside a sentence — planner titles are story-like clauses
 * ("sound is pressure, and pressure can be undone"), and "that's sound is pressure, and pressure c…"
 * reads like a glitch. The card names the finished topic in its own badge, so the headline doesn't
 * have to carry it.
 */
const STANDALONE_HEADLINES: string[] = [
  "that's the stretch. where to?",
  "that's it for this one. what now?",
  "end of that thread. your call.",
  "got that. where next?",
  "that lands. what now?",
];

/** A title only reads inside "that's ___" when it's a short noun phrase — no clause, no list. */
export function fitsInSentence(title: string): boolean {
  const t = title.trim();
  return t.length <= HEADLINE_TITLE_CHARS && !/[,;:.!?]/.test(t) && !/\b(is|are|was|were|can|will|does|do|has|have)\b/i.test(t);
}

export function crossroadsHeadline(finished: string, seed = 0): string {
  const i = ((seed % HEADLINES.length) + HEADLINES.length) % HEADLINES.length;
  if (!fitsInSentence(finished)) return STANDALONE_HEADLINES[i];
  return clampText(HEADLINES[i](finished.trim()), 80);
}

export type CrossroadsInput = {
  /** The node that just closed. */
  finished: string;
  /** The next node's title, or null when the outline is done. */
  upNext: string | null;
  /** The finished node's id — the choice uses it to work out where to go next. */
  nodeId: string;
  /** Rotation seed (node index) so consecutive crossroads don't repeat their wording. */
  seed?: number;
};

/**
 * One crossroads card. `continue` is offered only when there IS a next topic;
 * at the end of the outline the reader gets deeper / ask / wrap.
 */
export function buildCrossroadsCard(input: CrossroadsInput): CrossroadsCard {
  const finished = clampText(input.finished, FINISHED_CHARS);
  const upNext = input.upNext ? clampText(input.upNext, FINISHED_CHARS) : null;
  const choices: CrossroadsCard["choices"] = [];
  if (upNext) choices.push({ kind: "continue", label: `keep going: ${clampText(upNext, UP_NEXT_LABEL_CHARS)}` });
  choices.push({ kind: "deeper", label: "one more layer here" });
  choices.push({ kind: "ask", label: "ask something" });
  choices.push({ kind: "wrap", label: "wrap it up" });
  return {
    id: uuid(),
    type: "crossroads",
    topicNodeId: input.nodeId,
    detourId: null,
    eyebrow: "your call",
    finished,
    upNext,
    headline: crossroadsHeadline(finished, input.seed ?? 0),
    choices,
  };
}

// ── the ending ───────────────────────────────────────────────────────────────

const FALLBACK_BEATS = [
  "you took this from cold open to the part most people skip.",
  "the shape of it is the bit that sticks — the details you can look up.",
  "next time this comes up you'll recognise it in one line.",
];

export type WrapInput = {
  title: string;
  storyline: Storyline | null;
  outline: OutlineNode[];
  /** Index of the node the reader stopped at. */
  nodeIdx: number;
};

/**
 * Deterministic wrap, built from the through-line. Used when `llm.writeWrap`
 * is unavailable — the reader asked to wrap up, so something has to land.
 */
export function buildWrapCard(input: WrapInput): WrapCard {
  const seen = input.outline.slice(0, Math.max(1, Math.min(input.outline.length, input.nodeIdx + 1))).map((n) => n.title);
  const covered = input.storyline?.covered ?? [];
  const beats: string[] = [];
  for (const b of [...covered, ...seen]) {
    const line = clampText(b, 120);
    if (line && !beats.some((x) => x.toLowerCase() === line.toLowerCase())) beats.push(line);
  }
  const picked = beats.slice(-5);
  for (const filler of FALLBACK_BEATS) {
    if (picked.length >= 3) break;
    if (!picked.includes(filler)) picked.push(filler);
  }
  const rest = input.outline.slice(input.nodeIdx + 1)[0]?.title;
  const thread = rest || input.storyline?.next;
  return {
    id: uuid(),
    type: "wrap",
    topicNodeId: SYSTEM_NODE,
    detourId: null,
    eyebrow: "the whole thread",
    headline: clampText(`that's ${clampText(input.title, 44)}, wrapped.`, 80),
    beats: picked.slice(0, 5),
    ...(thread ? { openThread: clampText(`${thread} — still sitting there whenever you want it.`, 140) } : {}),
  };
}
