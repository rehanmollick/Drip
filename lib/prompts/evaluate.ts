import { z } from "zod";
import type { EvaluateOpenInput } from "@/lib/llm-types";
import { JSON_ONLY, NO_ASSUMING, PRIME_DIRECTIVE, personaBlock, schemaText, sliceCorpus, type Prompt } from "./shared";

export const PROMPT_VERSION = "evaluate.v1";

/** Small — the answer and a slice of the source is all this needs. */
export const EVALUATE_CORPUS_CHARS = 3_000;

/**
 * Grader-speak, rejected by the schema so it costs a retry rather than reaching the
 * screen. The reader asked to be able to answer in their own words; being told
 * "correct!" turns that into a grade, which is exactly what this app is not.
 */
const GRADER_SPEAK = [
  /^\s*(correct|incorrect|wrong|nope)\b/i,
  /\b(correct|incorrect|right|wrong)\s+answer\b/i,
  /\b(good job|well done|nice work|great job|you scored|full marks|partial credit)\b/i,
  /\b(you are|you're|that is|that's)\s+(correct|incorrect)\b/i,
];

export const OpenEvaluationSchema = z.object({
  verdict: z.enum(["got_it", "close", "not_yet"]),
  feedback: z.string().min(1).max(320).refine(
    (s) => !GRADER_SPEAK.some((re) => re.test(s)),
    { message: `grader-speak is not allowed: never "correct", "incorrect", "wrong answer", "good job". speak to what they actually wrote instead.` },
  ),
  missed: z.array(z.string().max(60)).max(4).default([]),
});
export type OpenEvaluationOut = z.infer<typeof OpenEvaluationSchema>;

/**
 * What to show when the model can't be reached at all (budget, no key, two bad outputs).
 * Someone typed a real answer and is watching a box — they get the answer and no verdict
 * theatre, never a spinner and never a grade. Callers: use this instead of inventing copy.
 */
export function fallbackEvaluation(modelAnswer: string): { verdict: "close"; feedback: string; missed: string[] } {
  const answer = modelAnswer.trim();
  const lead = "couldn't read yours properly just now — here's the version i'd give: ";
  const room = 320 - lead.length;
  return {
    verdict: "close",
    feedback: lead + (answer.length <= room ? answer : `${answer.slice(0, room - 1).trimEnd()}…`),
    missed: [],
  };
}

const RULES = `someone typed an answer in their own words to a question on a card. you write the reply they see next.

this is NOT grading. it is the smartest friend in the room going "yeah — and here's the bit you're missing".

how to write the reply (the "feedback" field, ≤ 320 chars, lowercase, persona voice):
1. start from what THEY wrote. name the part they got — in their words where you can ("the 'everything asks at once' bit is exactly it"). generic praise is worse than nothing; if you can't name a specific thing they got, say what they were circling.
2. then add the ONE missing piece, taught, not scored. one sentence. concrete.
3. that's it. no third move, no summary, no "keep it up".
- never these: "correct", "incorrect", "wrong answer", "right answer", "good job", "well done", partial-credit language, percentages, points.
- never school vocabulary. never a lecture. never repeat their whole answer back to them.
- if they wrote nothing real ("idk", "?", keyboard mash): don't scold. give them the answer in one warm line — "no shame, this one's slippery: …" — and set verdict "not_yet".
- if they're right in a way the rubric didn't anticipate, they're right. the rubric is a checklist, not the truth.

"verdict":
- "got_it" — everything the rubric asks for is there, in any wording.
- "close" — the main move is there, one piece missing or slightly off.
- "not_yet" — the main move isn't there, or the answer is off-topic/empty.

"missed": 0–4 short concept labels (≤ 60 chars each, like "write-back before return") for what they didn't have. internal only — never shown to anyone. empty array when they got it.`;

export const EVALUATE_SYSTEM_PREFIX = [
  `you reply to typed answers in DRIP — tiktok's format, a great teacher's brain.`,
  RULES,
  PRIME_DIRECTIVE,
  NO_ASSUMING,
  JSON_ONLY,
  `schema:\n${schemaText(OpenEvaluationSchema)}`,
].join("\n\n");

export function buildEvaluatePrompt(input: EvaluateOpenInput): Prompt {
  const system = `${EVALUATE_SYSTEM_PREFIX}\n\n${personaBlock(input.persona)}`;
  const answer = input.answer.trim();
  const user = [
    `the question on the card: ${input.prompt}`,
    `what a good answer contains (rubric — internal, never quote it):\n${input.rubric}`,
    `the answer we'd have shown them (for your reference, don't parrot it):\n${input.modelAnswer}`,
    `source slice for grounding:\n<<<SOURCE\n${sliceCorpus(input.corpusSlice, EVALUATE_CORPUS_CHARS) || "(none)"}\nSOURCE>>>`,
    `WHAT THEY ACTUALLY WROTE (reply to THIS, not to the model answer):\n<<<ANSWER\n${answer || "(they left it blank)"}\nANSWER>>>`,
    `emit the JSON.`,
  ].join("\n\n");
  return { system, user };
}
