import { z } from "zod";
import type { StorylineInput } from "@/lib/llm-types";
import { StorylineSchema } from "@/lib/schemas/session";
import { JSON_ONLY, PRIME_DIRECTIVE, bullets, jsonForPrompt, personaBlock, schemaText, sliceCorpus, type Prompt } from "./shared";

export const PROMPT_VERSION = "storyline.v2";

export const STORYLINE_CORPUS_CHARS = 2_500;

/** The model fills spine/covered/next; `updatedAtIdx` is the engine's bookkeeping, never the model's. */
export const StorylineOutSchema = StorylineSchema.omit({ updatedAtIdx: true });
export type StorylineOut = z.infer<typeof StorylineOutSchema>;

const RULES = `you keep one paragraph of memory for a scrolling feed: its THROUGH-LINE. every card the writer makes is handed this, so it is the only thing standing between a session and drifting into a different subject forty slides deep.

"spine" (≤ 280): what this session is really about, in one or two lowercase sentences, as a person would say it — the argument, not the subject. "a cache is a bet that you'll ask for the same thing twice, and every hard part of caching is what happens when the bet is wrong" beats "an overview of caching concepts".

"covered" (≤ 12 items, each ≤ 80): the beats that have ACTUALLY LANDED so far, oldest first, each a claim in plain words — "a miss costs a whole db read", not "we covered misses". carry the previous list forward and append; only rewrite an old beat if it was wrong. never invent a beat that no card taught.

"next" (≤ 120): where the thread is heading next, one line, in the same voice. it should read like the next thing you'd say, not a heading.

keep the reader's voice: lowercase, plain, no school vocabulary, no card counts, no percentages, no "in this section". this text can end up on screen, so when a persona is given below, write the spine and the beats in THAT voice — the through-line is the one line of the session the reader may be shown twice.`;

export const STORYLINE_SYSTEM = [
  `you maintain the through-line for DRIP — tiktok's format, a great teacher's brain.`,
  RULES,
  PRIME_DIRECTIVE,
  JSON_ONLY,
  `schema:\n${schemaText(StorylineOutSchema)}`,
].join("\n\n");

export function buildStorylinePrompt(input: StorylineInput): Prompt {
  const outline = input.outline.map((n, i) => `${i === input.nodeIdx ? "→ " : "  "}${n.title}${n.brief ? ` — ${n.brief}` : ""}`);
  const prev = input.prev
    ? jsonForPrompt({ spine: input.prev.spine, covered: input.prev.covered, next: input.prev.next }, 2_000)
    : "(none yet — this is the first refresh)";

  const user = [
    // the persona rides in the USER turn on purpose: STORYLINE_SYSTEM is one module-level string, so
    // it prompt-caches across every session at once, and per-session voice would end that.
    input.persona ? personaBlock(input.persona) : null,
    `session title: ${input.title}`,
    `previous through-line:\n${prev}`,
    `the planned outline (→ marks where the feed is now):\n${outline.length ? outline.join("\n") : "  (none)"}`,
    `cards that just went by (most recent last):\n${bullets(input.recent.map((r) => `${r.type}: ${r.gist}`))}`,
    `source slice:\n<<<SOURCE\n${sliceCorpus(input.corpusSlice, STORYLINE_CORPUS_CHARS) || "(none)"}\nSOURCE>>>`,
    `emit the refreshed through-line JSON: {"spine":…,"covered":[…],"next":…}.`,
  ].filter(Boolean).join("\n\n");

  return { system: STORYLINE_SYSTEM, user };
}
