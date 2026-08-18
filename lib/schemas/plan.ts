import { z } from "zod";
import { CardSchema } from "./cards";
import { ThemeSchema } from "./theme";

export const PersonaSchema = z.object({
  name: z.string().max(24).optional(),
  traits: z.tuple([z.string().max(40), z.string().max(40), z.string().max(40)]),
  tics: z.tuple([z.string().max(60), z.string().max(60)]),   // signature verbal tics
  humor: z.string().max(60),                                 // humor register
  neverDoes: z.string().max(80),                             // one thing it never does
  voiceSample: z.string().max(160).optional(),
  /** the one world this voice reaches into for comparisons ("pit lane", "a bad kitchen shift").
   *  named once so 40 cards of metaphors come from the same place instead of a new one per batch. */
  analogyWorld: z.string().max(60).optional(),
  /** one whole concept card, in voice, about THIS subject — same caps as ConceptCard.
   *  three traits and two tics DESCRIBE a voice; the writer still has to guess what it sounds
   *  like, alone, every batch. a demonstration it can imitate beats the description. */
  sampleCard: z.object({ headline: z.string().max(64), body: z.string().max(320) }).optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const OutlineNodeSchema = z.object({
  id: z.string().max(40),
  title: z.string().max(60),
  estCards: z.number().int().min(3).max(8),
  dependsOn: z.array(z.string()).default([]),
  brief: z.string().max(240).optional(),      // what this node must land, for the writer
  corpusHint: z.string().max(200).optional(), // where in the source this lives (headings, keywords)
});
export type OutlineNode = z.infer<typeof OutlineNodeSchema>;

export const ClarifierSchema = z.object({
  key: z.string().max(40),
  prompt: z.string().max(140),
  options: z.array(z.string().max(40)).min(2).max(3),
});

/** Planner output (Sonnet, once per session). */
export const PlanOutputSchema = z.object({
  title: z.string().max(60),
  theme: ThemeSchema,
  persona: PersonaSchema,
  outline: z.array(OutlineNodeSchema).min(2).max(24),
  clarifiers: z.array(ClarifierSchema).max(3).default([]),  // only when the input is one vague sentence
  firstCards: z.array(CardSchema).min(3).max(3),             // hook + 2 concept, fast-path
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

/** Triage output for the ask-bar (Haiku). */
export const TriageOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), answer: z.string().max(400) }),
  z.object({ kind: z.literal("detour"), cardCount: z.number().int().min(2).max(6), focus: z.string().max(120) }),
]);
export type TriageOutput = z.infer<typeof TriageOutputSchema>;
