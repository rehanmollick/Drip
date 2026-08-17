import type { TriageInput } from "@/lib/llm-types";
import { TriageOutputSchema } from "@/lib/schemas/plan";
import { JSON_ONLY, PRIME_DIRECTIVE, cardForPrompt, personaBlock, schemaText, sliceCorpus, type Prompt } from "./shared";

export const PROMPT_VERSION = "triage.v1";

export const TRIAGE_CORPUS_CHARS = 6_000;

const OUTPUT_SCHEMA = schemaText(TriageOutputSchema);

const RULES = `you triage a question typed into the ask-bar while someone is scrolling a card. decide ONE of two things:
- {"kind":"inline","answer":…}: a quick factual answer (≤ 400 chars) when the question can be settled in a sentence or two — a definition, a number, a yes/no with a reason, "what does this line do". answer in the persona's voice, lowercase, grounded in the source slice. if the source doesn't cover it, say "the source doesn't cover this, but generally…" and answer briefly. plain text, no markup.
- {"kind":"detour","cardCount":2–6,"focus":…}: when the answer needs a mini-thread — "why", "how does X work", "explain", "walk me through", comparisons, anything with steps or a mental model. cardCount: 2 for a crisp aside, 3–4 for a real explanation, 5–6 only for a genuinely big "how". focus (≤ 120) is a one-line brief for the writer: what the detour must land.
lean inline when the question is small; lean detour when the person clearly wants understanding, not a fact. never lecture. never use school vocabulary.`;

export const TRIAGE_SYSTEM_PREFIX = [
  `you are the ask-bar triage for DRIP — tiktok's format, a great teacher's brain.`,
  RULES,
  PRIME_DIRECTIVE,
  JSON_ONLY,
  `schema:\n${OUTPUT_SCHEMA}`,
].join("\n\n");

export function buildTriagePrompt(input: TriageInput): Prompt {
  const system = `${TRIAGE_SYSTEM_PREFIX}\n\n${personaBlock(input.persona)}`;
  const user = [
    `session: ${input.sessionSummary}`,
    `the card they're on: ${cardForPrompt(input.currentCard, 2_000)}`,
    `relevant source slice:\n<<<SOURCE\n${sliceCorpus(input.corpusSlice, TRIAGE_CORPUS_CHARS) || "(none)"}\nSOURCE>>>`,
    `their question: ${input.question}`,
    `emit the triage JSON.`,
  ].join("\n\n");
  return { system, user };
}
