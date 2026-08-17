import type { TriageInput } from "@/lib/llm-types";
import { TriageOutputSchema } from "@/lib/schemas/plan";
import { JSON_ONLY, PRIME_DIRECTIVE, cardForPrompt, personaBlock, schemaText, sliceCorpus, type Prompt } from "./shared";

export const PROMPT_VERSION = "triage.v2";

export const TRIAGE_CORPUS_CHARS = 6_000;

const OUTPUT_SCHEMA = schemaText(TriageOutputSchema);

const RULES = `you triage a question typed into the ask-bar while someone is scrolling a card. decide ONE of two things.

the test is mechanical, not a judgment call: CAN YOU ANSWER IT COMPLETELY AND WELL IN TWO SHORT SENTENCES?
- yes → {"kind":"inline","answer":…}. that means: what a single word means, one number or fact, a yes/no plus its one-line reason, "what does this line do".
- no → {"kind":"detour","cardCount":2–6,"focus":…}. this is the DEFAULT for anything else, and it is what the person actually wants.

it is a detour whenever the question contains any of: how does … work, how do …, walk me through, step by step, explain …, why does/is/do …, what happens if/when …, what's the difference between …, or asks for a mechanism, a sequence, a trade-off, or a mental model. do not compress one of those into an inline answer to save effort — an inline answer to a "how does it work" question is the wrong call every time.

cardCount: 2 for a crisp aside, 3–4 for a real explanation (most detours), 5–6 only for a genuinely big "how". focus (≤ 120) is a one-line brief for the writer: what the detour must land.
answer inline in the persona's voice, lowercase, ≤ 400 chars, grounded in the source slice. if the source doesn't cover it, say "the source doesn't cover this, but generally…" and answer briefly. plain text, no markup. never lecture. never use school vocabulary.`;

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
