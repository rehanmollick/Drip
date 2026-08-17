import type { Batch, CardRow, Detour, LlmCall, Session } from "@/lib/schemas/session";

/**
 * Persistence interface. Two implementations:
 *   - lib/db/supabase.ts  — Supabase Postgres (production; schema in supabase/migrations)
 *   - lib/db/local.ts     — JSON file in .data/ (dev/tests when Supabase env is absent)
 * Selected in lib/db/index.ts. Everything above this line is store-agnostic.
 *
 * Rules (from the spec):
 *   - Always write NEW learner-state / progress objects; never mutate in place.
 *   - Viewed cards are immutable; only unviewed runway may be deleted/regenerated.
 *   - Cards are ordered by `idx` (fractional-indexing string keys, lexicographic).
 */
export interface Store {
  // sessions
  createSession(s: Session): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  updateSession(id: string, patch: Partial<Session>): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  // cards
  insertCards(rows: CardRow[]): Promise<CardRow[]>;
  getCard(id: string): Promise<CardRow | null>;
  /** Cards with idx > after (or all when after is null), ascending, up to limit. */
  listCards(sessionId: string, opts?: { after?: string | null; limit?: number }): Promise<CardRow[]>;
  /** All cards for a session, ascending. */
  listAllCards(sessionId: string): Promise<CardRow[]>;
  updateCard(id: string, patch: Partial<Pick<CardRow, "viewedAt" | "interaction" | "payload">>): Promise<CardRow>;
  /** Delete UNVIEWED cards with idx > after on EVERY thread (main + detours) — used by simpler/deeper regeneration,
   *  re-plans and chill-mode toggles. Clients mirror this exactly (drop all local unviewed rows with idx > after). */
  deleteUnviewedAfter(sessionId: string, after: string | null): Promise<number>;
  /** Last card by idx (any thread) — the frontier. */
  lastCard(sessionId: string): Promise<CardRow | null>;

  // detours
  createDetour(d: Detour): Promise<Detour>;
  listDetours(sessionId: string): Promise<Detour[]>;

  // batches (idempotent generation)
  /** Insert if absent; returns { batch, created }. Unique on (sessionId, frontierKey). */
  claimBatch(b: Batch): Promise<{ batch: Batch; created: boolean }>;
  getBatch(sessionId: string, frontierKey: string): Promise<Batch | null>;
  updateBatch(id: string, patch: Partial<Batch>): Promise<Batch>;

  // llm observability + spend cap
  logLlmCall(c: LlmCall): Promise<void>;
  /** Number of calls logged since the given ISO timestamp. Throws if unreadable (caller fails closed). */
  countLlmCallsSince(iso: string): Promise<number>;
  listLlmCalls(sessionId?: string, limit?: number): Promise<LlmCall[]>;
}
