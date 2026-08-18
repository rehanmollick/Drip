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
  /** Bumped whenever the unviewed runway is invalidated (replan, dial, chill toggle). Part of every frontier key
   *  so a batch claimed/done under an old epoch is never handed back after its cards were deleted. */
  epoch: z.number().int().default(0),
  /** True while a re-plan (after clarifier answers) is running; the client waits for it to clear before re-syncing. */
  pendingReplan: z.boolean().default(false),
  /**
   * Set when a `crossroads` card is the frontier: generation STOPS until the reader picks a
   * direction. The feed asks rather than running on forever.
   */
  awaitingChoice: z.boolean().default(false),
  /** Extra cards granted for the current node by a "go deeper" choice at a crossroads. */
  deeperCards: z.number().int().default(0),
});
export type Progress = z.infer<typeof ProgressSchema>;

/**
 * The through-line, carried across every writer call. "Last 6 cards" keeps local continuity but
 * loses the plot over a long session; this is what the session is ABOUT, what has actually landed
 * so far, and where it is heading — so a card 40 slides deep still belongs to the same story.
 */
export const StorylineSchema = z.object({
  spine: z.string().max(280),            // what this session is really about, one or two sentences
  covered: z.array(z.string().max(80)).max(12),  // beats that have actually landed, in order
  next: z.string().max(120),             // where it is heading next
  updatedAtIdx: z.string().nullable().default(null), // card idx this was last refreshed at
});
export type Storyline = z.infer<typeof StorylineSchema>;

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
  storyline: StorylineSchema.nullable(),
  status: SessionStatus,
  error: z.string().nullable().default(null),
  position: z.number().int().default(0),          // last viewed card ordinal
  createdAt: z.string(),
  lastOpenedAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

export const InteractionSchema = z.object({
  choice: z.union([z.number(), z.string(), z.array(z.string())]).optional(),
  /** `open` cards: what they typed, and how it was graded — replayed when scrolling back. */
  text: z.string().optional(),
  feedback: z.object({
    verdict: z.enum(["got_it", "close", "not_yet"]),
    feedback: z.string(),
    missed: z.array(z.string()).default([]),
  }).optional(),
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
