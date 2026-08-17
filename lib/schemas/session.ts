import { z } from "zod";
import { CardSchema } from "./cards";
import { LearnerStateSchema, SessionSettingsSchema } from "./learner";
import { OutlineNodeSchema, PersonaSchema } from "./plan";
import { ThemeSchema } from "./theme";

export const SOURCE_KINDS = ["sentence", "paste", "url", "repo", "youtube", "transcript"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const SESSION_STATUSES = ["planning", "active", "archived", "error"] as const;
export const SessionStatus = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Generation frontier — where the writer is in the outline. */
export const ProgressSchema = z.object({
  nodeIdx: z.number().int().default(0),          // index into outline
  cardsInNode: z.number().int().default(0),      // cards written for the current node
  totalGenerated: z.number().int().default(0),
  exhausted: z.boolean().default(false),          // outline done → infinite-scroll continuation mode
  extensions: z.number().int().default(0),        // "adjacent waters" extensions accepted
  lastIdx: z.string().nullable().default(null),   // fractional index of the last generated main-thread card
});
export type Progress = z.infer<typeof ProgressSchema>;

export const SessionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  sourceKind: SourceKind,
  sourceMeta: z.record(z.string(), z.unknown()).default({}),
  sourceText: z.string().default(""),
  theme: ThemeSchema.nullable(),
  persona: PersonaSchema.nullable(),
  outline: z.array(OutlineNodeSchema).default([]),
  settings: SessionSettingsSchema,
  learnerState: LearnerStateSchema,
  progress: ProgressSchema.prefault({}),
  clarifierAnswers: z.record(z.string(), z.string()).default({}),
  status: SessionStatus,
  error: z.string().nullable().default(null),
  position: z.number().int().default(0),          // last viewed card ordinal
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

export const InteractionSchema = z.object({
  choice: z.union([z.number(), z.string(), z.array(z.string())]).optional(),
  correct: z.boolean().optional(),
  dwellMs: z.number().optional(),
  value: z.number().optional(),                    // slider
  at: z.string(),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export const CardRowSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  idx: z.string(),                                 // fractional-indexing key; ordered lexicographically
  type: z.string(),
  payload: CardSchema,
  detourId: z.string().nullable(),
  batchId: z.string().nullable(),
  viewedAt: z.string().nullable(),
  interaction: InteractionSchema.nullable(),
  createdAt: z.string(),
});
export type CardRow = z.infer<typeof CardRowSchema>;

export const DetourSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  parentDetourId: z.string().nullable(),
  question: z.string(),
  insertedAfterIdx: z.string(),
  createdAt: z.string(),
});
export type Detour = z.infer<typeof DetourSchema>;

export const BATCH_STATUSES = ["pending", "done", "failed"] as const;
export const BatchSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  frontierKey: z.string(),                         // idempotency key for this generation request
  status: z.enum(BATCH_STATUSES),
  cardIds: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const LLM_PURPOSES = ["plan", "write", "triage", "chat", "detour", "replan"] as const;
export const LlmCallSchema = z.object({
  id: z.uuid(),
  sessionId: z.string().nullable(),
  purpose: z.enum(LLM_PURPOSES),
  model: z.string(),
  promptVersion: z.string(),
  inTokens: z.number().int(),
  outTokens: z.number().int(),
  latencyMs: z.number().int(),
  ok: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type LlmCall = z.infer<typeof LlmCallSchema>;
