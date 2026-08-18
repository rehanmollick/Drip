import { z } from "zod";
import { CardRowSchema, DetourSchema, SessionSchema, SourceKind } from "@/lib/schemas/session";
import { LearnerStateSchema, SessionSettingsSchema } from "@/lib/schemas/learner";
import { CardSchema } from "@/lib/schemas/cards";

/**
 * API contract — request/response `data` shapes for every route (spec §10).
 * Every response is wrapped in the envelope { data, error, meta }.
 * Client (lib/api/client.ts) and server (app/api/**) both import from here.
 */

/**
 * Where generation actually is, counted from rows that exist rather than from what the plan hoped
 * for. `estCards` is a guess the writer routinely overshoots or undershoots, so nobody downstream
 * can derive any of this from the outline — the server has to say it out loud.
 */
export const FrontierPublicSchema = z.object({
  written: z.record(z.string(), z.number().int()).default({}),  // outline node id → main-thread cards that EXIST for it
  beyond: z.number().int().default(0),                          // cards written past the end of the outline
  nodeIdx: z.number().int().default(0),                         // outline index the writer is working in
  deeper: z.record(z.string(), z.number().int()).default({}),   // node id → extra cards "one more layer here" bought there
  /** node ids the writer has finished. a node closes when it carries a crossroads row, whatever estCards guessed. */
  closed: z.array(z.string()).default([]),
  /** parked on the reader: an unanswered crossroads, or the wrap that ended the thread. null = still moving. */
  gate: z.enum(["crossroads", "wrap"]).nullable().default(null),
  /** a batch is in flight RIGHT NOW — the difference between "nothing is coming" and "wait a beat". */
  live: z.object({ nodeIdx: z.number().int(), startedAt: z.string() }).nullable().default(null),
  epoch: z.number().int().default(0),                           // runway epoch this was counted against; older = stale
  halted: z.boolean().default(false),                           // stopped for something scrolling can't clear (spend cap, dead session)
});
export type FrontierPublic = z.infer<typeof FrontierPublicSchema>;

/** Session as sent to the browser: no full corpus, just its size. */
export const SessionPublicSchema = SessionSchema.omit({ sourceText: true }).extend({
  sourceChars: z.number().int(),
  cardCount: z.number().int().default(0),
  /** absent on responses that didn't count it, and on every session stored before it existed. */
  frontier: FrontierPublicSchema.nullish(),
});
export type SessionPublic = z.infer<typeof SessionPublicSchema>;

// ── POST /api/sessions ───────────────────────────────────────────────────────
export const CreateSessionBody = z.object({
  input: z.string().min(1).max(400_000),               // sentence, paste, transcript, or already-ingested text
  sourceKind: SourceKind.default("sentence"),
  sourceMeta: z.record(z.string(), z.unknown()).default({}),
  settings: SessionSettingsSchema.partial().default({}),
  title: z.string().max(60).optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;
export const CreateSessionData = z.object({ session: SessionPublicSchema });

// ── GET /api/sessions ────────────────────────────────────────────────────────
export const ListSessionsData = z.object({ sessions: z.array(SessionPublicSchema) });

// ── GET /api/sessions/:id ────────────────────────────────────────────────────
export const GetSessionData = z.object({ session: SessionPublicSchema });

// ── PATCH /api/sessions/:id ──────────────────────────────────────────────────
export const PatchSessionBody = z.object({
  settings: SessionSettingsSchema.partial().optional(),
  position: z.number().int().min(0).optional(),
  title: z.string().max(60).optional(),
  status: z.enum(["archived", "active"]).optional(),
  clarifierAnswers: z.record(z.string(), z.string()).optional(), // answering the setup cards → refines the plan
});
export type PatchSessionBody = z.infer<typeof PatchSessionBody>;
export const PatchSessionData = z.object({ session: SessionPublicSchema });

// ── DELETE /api/sessions/:id ─────────────────────────────────────────────────
export const DeleteSessionData = z.object({ deleted: z.literal(true) });

// ── POST /api/sessions/:id/remix ─────────────────────────────────────────────
export const RemixSessionBody = z.object({ settings: SessionSettingsSchema.partial().default({}) });
export const RemixSessionData = z.object({ session: SessionPublicSchema });

// ── POST /api/sessions/:id/retry  (planning error / watchdog → retry) ────────
export const RetrySessionData = z.object({ session: SessionPublicSchema });

// ── GET /api/sessions/:id/cards?after=idx&limit=12 ───────────────────────────
export const ListCardsQuery = z.object({
  after: z.string().optional(),               // fractional idx; omit for from-start
  limit: z.coerce.number().int().min(1).max(100).default(12),
});
export const ListCardsData = z.object({ cards: z.array(CardRowSchema), hasMore: z.boolean() });
export type ListCardsData = z.infer<typeof ListCardsData>;

// ── POST /api/sessions/:id/generate ──────────────────────────────────────────
export const GenerateBody = z.object({
  after: z.string().nullable().optional(),    // client's known frontier (informational; server computes the real one)
});
export const GenerateData = z.object({
  batch: z.object({
    id: z.string(),
    status: z.enum(["pending", "done", "failed"]),
    frontierKey: z.string(),
    /** Why a done batch carries no cards: "runway_full" (≥16 unviewed rows — post views first), "budget", "superseded" (epoch moved). */
    reason: z.string().optional(),
  }),
  cards: z.array(CardRowSchema),              // the batch's cards when done (may include a single fallback/notice card)
  /** where the writer stands after this batch — so the client never has to guess from card counts. */
  frontier: FrontierPublicSchema.nullish(),
});
export type GenerateData = z.infer<typeof GenerateData>;

// ── POST /api/sessions/:id/dial  (🧒 simpler / 🎓 deeper) ─────────────────────
export const DialBody = z.object({
  direction: z.enum(["simpler", "deeper"]),
  currentCardId: z.string(),                  // everything unviewed after this card regenerates
});
export const DialData = z.object({
  session: SessionPublicSchema,
  toast: z.string(),                          // 1-line toast in the persona's voice
  removedAfter: z.string().nullable(),        // idx after which unviewed cards were dropped
});

// ── POST /api/sessions/:id/ask ───────────────────────────────────────────────
export const AskBody = z.object({
  question: z.string().min(1).max(500),
  currentCardId: z.string(),
});
export const AskData = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inline"), answer: z.string() }),
  z.object({ kind: z.literal("detour"), detour: DetourSchema, cards: z.array(CardRowSchema) }),
]);
export type AskData = z.infer<typeof AskData>;

// ── POST /api/sessions/:id/choose  (crossroads: the feed asks before running on) ─────────────
export const ChooseBody = z.object({
  cardId: z.string(),
  choice: z.enum(["continue", "deeper", "ask", "wrap"]),
});
export type ChooseBody = z.infer<typeof ChooseBody>;
export const ChooseData = z.object({
  session: SessionPublicSchema,
  /** Cards produced by the choice (the wrap card, or the first of the next stretch). May be empty — the runway fills normally after. */
  cards: z.array(CardRowSchema),
});
export type ChooseData = z.infer<typeof ChooseData>;

// ── POST /api/cards/:id/interact ─────────────────────────────────────────────
export const InteractBody = z.object({
  viewed: z.boolean().optional(),
  /** `open` cards: what they typed. The reply is written against this, not a canned answer. */
  text: z.string().max(1200).optional(),
  choice: z.union([z.number(), z.string(), z.array(z.string())]).optional(),
  correct: z.boolean().optional(),
  dwellMs: z.number().min(0).max(60_000).optional(),   // client hard-caps at 60s; server clamps too
  value: z.number().optional(),                        // slider
  scrollBack: z.boolean().optional(),                  // user scrolled back up to this card
});
export type InteractBody = z.infer<typeof InteractBody>;
export const OpenFeedbackSchema = z.object({
  verdict: z.enum(["got_it", "close", "not_yet"]),
  feedback: z.string(),
  missed: z.array(z.string()).default([]),
});
export type OpenFeedback = z.infer<typeof OpenFeedbackSchema>;

export const InteractData = z.object({
  card: CardRowSchema,
  /** `open` cards only: the reply to what they wrote. */
  feedback: OpenFeedbackSchema.nullable().default(null),
  learnerState: LearnerStateSchema,
  inserted: z.array(CardRowSchema),                     // e.g. an auto-inserted recap card after the current one
});
export type InteractData = z.infer<typeof InteractData>;

// ── Ingest ───────────────────────────────────────────────────────────────────
export const IngestUrlBody = z.object({ url: z.url() });
export const IngestData = z.object({
  text: z.string(),
  sourceKind: SourceKind,
  meta: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
});
export type IngestData = z.infer<typeof IngestData>;
export const IngestRepoBody = z.object({ url: z.url() });
export const IngestYoutubeBody = z.object({ url: z.string().min(3) });

// ── Cards as sent inline in some responses ───────────────────────────────────
export const CardsData = z.object({ cards: z.array(CardSchema) });
