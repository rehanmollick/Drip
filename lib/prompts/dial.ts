import { z } from "zod";
import type { Persona } from "@/lib/schemas/plan";
import { JSON_ONLY, PRIME_DIRECTIVE, personaBlock, schemaText, type Prompt } from "./shared";

export const PROMPT_VERSION = "dial.v1";

export const DialToastSchema = z.object({ toast: z.string().min(1).max(90) });
export type DialToast = z.infer<typeof DialToastSchema>;

/** Canned toasts used when the model is unavailable, over budget, or off-voice. */
export const CANNED_TOASTS = {
  simpler: "say less. rewinding the jargon.",
  deeper: "bet. going a layer deeper.",
} as const;

const RULES = `someone tapped a dial on a card: "simpler" (rewind the jargon, easier cards ahead) or "deeper" (more depth, more edge cases ahead). write ONE toast line in the persona's voice acknowledging it — ≤ 90 chars, lowercase, punchy, no emoji, no markup, no school vocabulary. examples of the register: "say less. rewinding the jargon." / "bet. going a layer deeper." — but write a NEW one in this persona's voice.`;

export const DIAL_SYSTEM_PREFIX = [
  `you write one-line toasts for DRIP — tiktok's format, a great teacher's brain.`,
  RULES,
  PRIME_DIRECTIVE,
  JSON_ONLY,
  `schema:\n${schemaText(DialToastSchema)}`,
].join("\n\n");

export function buildDialPrompt(input: { persona: Persona; direction: "simpler" | "deeper" }): Prompt {
  const system = `${DIAL_SYSTEM_PREFIX}\n\n${personaBlock(input.persona)}`;
  const user = `direction: ${input.direction}. emit {"toast": "…"}.`;
  return { system, user };
}
