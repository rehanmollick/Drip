import { z } from "zod";
import type { WrapContext } from "@/lib/llm-types";
import { WrapCard } from "@/lib/schemas/cards";
import {
  BASE_CARD_FIELDS, JSON_ONLY, NO_ASSUMING, PRIME_DIRECTIVE, bullets, cardSchemaBlock, learnerSummary,
  personaBlock, themeGroundingBlock, type Prompt,
} from "./shared";

export const PROMPT_VERSION = "wrap.v1";

/** The model emits one card; the wrapper key keeps the JSON-object output contract. */
export const WrapOutSchema = z.object({ card: WrapCard });
export type WrapOut = z.infer<typeof WrapOutSchema>;

const RULES = `the reader asked to wrap up. you write the last card: the whole thread, in a few beats, the way you'd catch up a friend who walked in halfway.

- "headline" (≤ 80): what they actually walked away with, in their world. lowercase, no ceremony, never "summary", never "conclusion". "you can now argue about caches with the person who paged you" is the register.
- "beats" (3–5, each ≤ 120): the through-line in order. each beat is a CLAIM, not a topic name — "a cache is a bet that you'll ask twice" beats "we covered what a cache is". only beats that cards actually landed. no beat repeats another. no numbering, no "first/second/finally".
- "stat" (optional): one flex — {"value":"9","label":"footguns dodged"}. never progress, never a percentage of anything finished, never a count of cards.
- "openThread" (optional, ≤ 140): the one thing still unexplored, phrased as an invitation to come back — "we never touched what happens when two writers race. that one's a whole evening."
- one screen. this is an ending, not a recap of the recaps. if a beat only exists to be tidy, cut it.`;

export function buildWrapSystem(ctx: WrapContext): string {
  return [
    `you write the ending card for DRIP — tiktok's format, a great teacher's brain. you write JSON only; the app renders it.`,
    personaBlock(ctx.persona),
    themeGroundingBlock(ctx.theme),
    PRIME_DIRECTIVE,
    RULES,
    NO_ASSUMING,
    BASE_CARD_FIELDS,
    cardSchemaBlock(["wrap"]),
    JSON_ONLY,
    `output: {"card": { …one wrap card… }}.`,
  ].join("\n\n");
}

export function buildWrapPrompt(ctx: WrapContext): Prompt {
  const system = buildWrapSystem(ctx);
  const s = ctx.storyline;
  const user = [
    s ? `the through-line of this session:\nspine: ${s.spine}\nlanded:\n${bullets(s.covered)}\nwas heading toward: ${s.next}` : `no through-line recorded — build the beats from the cards below.`,
    `the outline this session was built on:\n${bullets(ctx.outline.map((n) => n.title))}`,
    `what they actually saw (oldest first):\n${bullets(ctx.covered.map((c) => `${c.type}: ${c.gist}`))}`,
    `learner:\n${learnerSummary(ctx.learnerState)}`,
    `set "topicNodeId": "system", "detourId": null, fresh uuid v4 "id", "type": "wrap".`,
    `now emit {"card": …}. 3–5 beats, each one a claim they can actually make now.`,
  ].join("\n\n");
  return { system, user };
}
