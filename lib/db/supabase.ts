import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ProgressSchema, type Batch, type CardRow, type Detour, type LlmCall, type Session } from "@/lib/schemas/session";
import { LearnerStateSchema, SessionSettingsSchema, defaultLearnerState } from "@/lib/schemas/learner";
import type { Store } from "./store";

/**
 * Supabase Postgres store (production). Schema: supabase/migrations/*.sql.
 * The server talks to Postgres with the SERVICE ROLE key (RLS bypass) — this
 * module is server-only and the key never reaches the browser.
 *
 * Row mapping (camelCase ↔ snake_case) lives in pure, exported helpers so it
 * can be unit-tested without a database. jsonb blobs (settings / learner
 * state / progress) are parsed through their Zod schemas on the way out so a
 * row with '{}' defaults (hand-inserted, older migration) yields real defaults
 * instead of crashing the engine.
 *
 * Retry policy. Cold start (free-tier pause): until the first query succeeds,
 * a failure is retried once after 3s (spec §12.8) unless Postgres gave a
 * definite answer (bad input, constraint, missing relation, auth) that a
 * retry cannot change; afterwards only transient gateway/network failures are
 * retried once. Inserts are retried as `upsert … ignoreDuplicates` (ids are
 * client-generated uuids) so a commit-then-lost-response never turns into a
 * duplicate row or a spurious 23505; claimBatch recognises its own row.
 *
 * Ordering. cards.idx / detours.inserted_after_idx are declared collate "C"
 * (byte order) so ORDER BY / > match the app's plain string comparison. As a
 * belt-and-braces measure results are re-sorted in JS and, if the database
 * ever returns idx out of byte order (migration 0002 not applied), the store
 * logs once and switches lastCard / listCards / deleteUnviewedAfter to
 * app-side ordering so the frontier cannot stall.
 */

// ── row types (what PostgREST returns) ──────────────────────────────────────
type Row = Record<string, unknown>;

const iso = (v: unknown, fallback = ""): string => {
  if (typeof v !== "string" || !v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
};
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : fallback);
const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === "object" ? (v as T) : fallback);

/** jsonb → schema with defaults. '{}' (the migration default), null or a partial blob become full defaults;
 *  a blob that fails validation outright also falls back (logged) rather than crashing every request. */
function parseSettings(v: unknown): Session["settings"] {
  const r = SessionSettingsSchema.safeParse(v ?? {});
  return r.success ? r.data : SessionSettingsSchema.parse({});
}
function parseLearnerState(v: unknown, id: unknown): Session["learnerState"] {
  const r = LearnerStateSchema.safeParse(v ?? {});
  if (r.success) return r.data;
  console.warn(`[supabase] learner_state for session ${String(id)} failed validation — using defaults`);
  return defaultLearnerState();
}
function parseProgress(v: unknown, id: unknown): Session["progress"] {
  const r = ProgressSchema.safeParse(v ?? {});
  if (r.success) return r.data;
  console.warn(`[supabase] progress for session ${String(id)} failed validation — using defaults`);
  return ProgressSchema.parse({});
}

// ── sessions ────────────────────────────────────────────────────────────────
export function rowToSession(r: Row): Session {
  return {
    id: str(r.id),
    title: str(r.title),
    sourceKind: str(r.source_kind, "sentence") as Session["sourceKind"],
    sourceMeta: obj<Record<string, unknown>>(r.source_meta, {}),
    sourceText: str(r.source_text),
    theme: (r.theme ?? null) as Session["theme"],
    persona: (r.persona ?? null) as Session["persona"],
    outline: Array.isArray(r.outline) ? (r.outline as Session["outline"]) : [],
    settings: parseSettings(r.settings),
    learnerState: parseLearnerState(r.learner_state, r.id),
    progress: parseProgress(r.progress, r.id),
    clarifierAnswers: obj<Record<string, string>>(r.clarifier_answers, {}),
    status: str(r.status, "planning") as Session["status"],
    error: (r.error as string | null) ?? null,
    position: num(r.position),
    createdAt: iso(r.created_at),
    lastOpenedAt: iso(r.last_opened_at),
  };
}

const SESSION_COLS: Record<keyof Session, string> = {
  id: "id", title: "title", sourceKind: "source_kind", sourceMeta: "source_meta", sourceText: "source_text",
  theme: "theme", persona: "persona", outline: "outline", settings: "settings", learnerState: "learner_state",
  progress: "progress", clarifierAnswers: "clarifier_answers", status: "status", error: "error",
  position: "position", createdAt: "created_at", lastOpenedAt: "last_opened_at",
};

export function sessionToRow(s: Partial<Session>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(s) as [keyof Session, unknown][]) {
    const col = SESSION_COLS[k];
    if (col && v !== undefined) out[col] = v;
  }
  return out;
}

// ── cards ───────────────────────────────────────────────────────────────────
export function rowToCard(r: Row): CardRow {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    idx: str(r.idx),
    type: str(r.type),
    payload: r.payload as CardRow["payload"],
    detourId: (r.detour_id as string | null) ?? null,
    batchId: (r.batch_id as string | null) ?? null,
    viewedAt: isoOrNull(r.viewed_at),
    interaction: (r.interaction as CardRow["interaction"]) ?? null,
    createdAt: iso(r.created_at),
  };
}

export function cardToRow(c: CardRow): Row {
  return {
    id: c.id, session_id: c.sessionId, idx: c.idx, type: c.type, payload: c.payload,
    detour_id: c.detourId, batch_id: c.batchId, viewed_at: c.viewedAt, interaction: c.interaction,
    created_at: c.createdAt,
  };
}

// ── detours ─────────────────────────────────────────────────────────────────
export function rowToDetour(r: Row): Detour {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    parentDetourId: (r.parent_detour_id as string | null) ?? null,
    question: str(r.question),
    insertedAfterIdx: str(r.inserted_after_idx),
    createdAt: iso(r.created_at),
  };
}
export function detourToRow(d: Detour): Row {
  return {
    id: d.id, session_id: d.sessionId, parent_detour_id: d.parentDetourId, question: d.question,
    inserted_after_idx: d.insertedAfterIdx, created_at: d.createdAt,
  };
}

// ── batches ─────────────────────────────────────────────────────────────────
export function rowToBatch(r: Row): Batch {
  return {
    id: str(r.id),
    sessionId: str(r.session_id),
    frontierKey: str(r.frontier_key),
    status: str(r.status, "pending") as Batch["status"],
    cardIds: Array.isArray(r.card_ids) ? (r.card_ids as string[]) : [],
    error: (r.error as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
const BATCH_COLS: Record<keyof Batch, string> = {
  id: "id", sessionId: "session_id", frontierKey: "frontier_key", status: "status", cardIds: "card_ids",
  error: "error", createdAt: "created_at", updatedAt: "updated_at",
};
export function batchToRow(b: Partial<Batch>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(b) as [keyof Batch, unknown][]) {
    const col = BATCH_COLS[k];
    if (col && v !== undefined) out[col] = v;
  }
  return out;
}

// ── llm calls ───────────────────────────────────────────────────────────────
export function rowToLlmCall(r: Row): LlmCall {
  return {
    id: str(r.id),
    sessionId: (r.session_id as string | null) ?? null,
    purpose: str(r.purpose, "write") as LlmCall["purpose"],
    model: str(r.model),
    promptVersion: str(r.prompt_version),
    inTokens: num(r.in_tokens),
    outTokens: num(r.out_tokens),
    latencyMs: num(r.latency_ms),
    ok: Boolean(r.ok),
    error: (r.error as string | null) ?? null,
    createdAt: iso(r.created_at),
  };
}
export function llmCallToRow(c: LlmCall): Row {
  return {
    id: c.id, session_id: c.sessionId, purpose: c.purpose, model: c.model, prompt_version: c.promptVersion,
    in_tokens: c.inTokens, out_tokens: c.outTokens, latency_ms: c.latencyMs, ok: c.ok, error: c.error,
    created_at: c.createdAt,
  };
}

// ── client + retry ──────────────────────────────────────────────────────────
type PgError = { code?: string; message: string; details?: string | null; hint?: string | null } | null;
type Res<T> = { data: T; error: PgError; count?: number | null };

export class SupabaseStoreError extends Error {
  code: string;
  constructor(op: string, e: { code?: string; message: string }) {
    super(`[supabase:${op}] ${e.message}`);
    this.code = e.code ?? "supabase_error";
  }
}

const TRANSIENT = new Set(["502", "503", "504", "522", "523", "524", "PGRST000", "PGRST001", "PGRST002", "PGRST003", "57P01", "57P03", "08006", "08001", "fetch_failed"]);
export function isTransient(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code && TRANSIENT.has(String(e.code))) return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("fetch failed") || m.includes("econnreset") || m.includes("timeout") || m.includes("network") || m.includes("paused");
}
/** A definite answer from Postgres/PostgREST (SQLSTATE class 22/23/42/2F/0A/P0, PostgREST 1xx-3xx): retrying cannot change it. */
const DEFINITE = /^(22|23|42|2F|0A|P0|PGRST[123]\d\d)/;
export function isDefinite(e: { code?: string } | null | undefined): boolean {
  return !!e?.code && DEFINITE.test(String(e.code));
}
/** Malformed uuid in a filter (`.eq('id', 'not-a-uuid')`) — a point lookup for a row that cannot exist. */
const isBadUuid = (e: unknown) => e instanceof SupabaseStoreError && e.code === "22P02";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const byIdx = (a: { idx: string }, b: { idx: string }) => (a.idx < b.idx ? -1 : a.idx > b.idx ? 1 : 0);

export function createSupabaseStore(opts: { url?: string; key?: string; client?: SupabaseClient; retryDelayMs?: number } = {}): Store {
  const url = opts.url ?? process.env.SUPABASE_URL;
  const key = opts.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!opts.client && (!url || !key)) throw new Error("supabase store: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const client: SupabaseClient = opts.client ?? createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const retryDelay = opts.retryDelayMs ?? 3000;
  let warmed = false;
  /** Set once the database returns idx out of byte order (collate "C" missing) — see header. */
  let collationBroken = false;

  const attempt = async <T>(run: () => PromiseLike<Res<T>>): Promise<Res<T>> => {
    try {
      return await run();
    } catch (e) {
      return { data: null as T, error: { message: e instanceof Error ? e.message : String(e), code: "fetch_failed" } };
    }
  };
  const shouldRetry = (e: NonNullable<PgError>) => isTransient(e) || (!warmed && !isDefinite(e));

  /** Run a query with the retry policy from the header; `retryRun` (default: `run`) is used for the second attempt so
   *  non-idempotent inserts can be retried as upserts. Never throws — returns the PostgREST result. */
  async function exec<T>(run: () => PromiseLike<Res<T>>, retryRun: () => PromiseLike<Res<T>> = run): Promise<Res<T>> {
    let res = await attempt(run);
    if (res.error && shouldRetry(res.error)) {
      await sleep(retryDelay);
      res = await attempt(retryRun);
    }
    if (!res.error) warmed = true;
    return res;
  }
  /** exec + throw SupabaseStoreError on failure. */
  async function q<T>(op: string, run: () => PromiseLike<Res<T>>, retryRun?: () => PromiseLike<Res<T>>): Promise<T> {
    const res = await exec(run, retryRun);
    if (res.error) throw new SupabaseStoreError(op, res.error);
    return res.data;
  }
  /** q for point lookups keyed by uuid: a malformed id is "no such row", not a 500. */
  async function qLookup<T>(op: string, run: () => PromiseLike<Res<T>>): Promise<T | null> {
    try {
      return await q(op, run);
    } catch (e) {
      if (isBadUuid(e)) return null;
      throw e;
    }
  }
  /** Insert rows; the retry is an upsert that ignores rows already committed by a first attempt whose response was lost. */
  const insertRows = (op: string, table: string, rows: Row[]) =>
    q<Row[] | null>(
      op,
      () => client.from(table).insert(rows).select(),
      () => client.from(table).upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select(),
    );

  const rows = <T>(v: T[] | null | undefined): T[] => v ?? [];

  /** Rows came back ORDER BY idx: if they are not in byte order the column is missing collate "C". */
  function checkOrder(list: CardRow[]): void {
    if (collationBroken) return;
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].idx > list[i].idx) {
        collationBroken = true;
        console.error(
          "[supabase] cards.idx is not collated in byte order — apply supabase/migrations/0002_idx_collation.sql. " +
            "Falling back to app-side ordering for lastCard / listCards / deleteUnviewedAfter.",
        );
        return;
      }
    }
  }

  const store: Store = {
    // ── sessions ──────────────────────────────────────────────────────────
    async createSession(s) {
      const data = await insertRows("createSession", "sessions", [sessionToRow(s)]);
      const r = rows(data)[0];
      return r ? rowToSession(r) : s;
    },
    async getSession(id) {
      const data = await qLookup<Row | null>("getSession", () => client.from("sessions").select("*").eq("id", id).maybeSingle());
      return data ? rowToSession(data) : null;
    },
    async listSessions() {
      const data = await q<Row[] | null>("listSessions", () =>
        client.from("sessions").select("*").order("last_opened_at", { ascending: false }),
      );
      return rows(data).map(rowToSession);
    },
    async updateSession(id, patch) {
      const row = sessionToRow(patch);
      delete row.id;
      const notFound = () => new SupabaseStoreError("updateSession", { code: "not_found", message: `session not found: ${id}` });
      if (Object.keys(row).length === 0) {
        // PostgREST does nothing for `PATCH {}` — an empty patch is a read.
        const cur = await store.getSession(id);
        if (!cur) throw notFound();
        return cur;
      }
      const data = await qLookup<Row | null>("updateSession", () =>
        client.from("sessions").update(row).eq("id", id).select().maybeSingle(),
      );
      if (!data) throw notFound();
      return rowToSession(data);
    },
    async deleteSession(id) {
      await qLookup("deleteSession", () => client.from("sessions").delete().eq("id", id));
    },

    // ── cards ─────────────────────────────────────────────────────────────
    async insertCards(cards) {
      if (cards.length === 0) return [];
      const data = await insertRows("insertCards", "cards", cards.map(cardToRow));
      const out = rows(data).map(rowToCard);
      return out.length ? out.sort(byIdx) : [...cards].sort(byIdx);
    },
    async getCard(id) {
      const data = await qLookup<Row | null>("getCard", () => client.from("cards").select("*").eq("id", id).maybeSingle());
      return data ? rowToCard(data) : null;
    },
    async listCards(sessionId, opts = {}) {
      const after = opts.after ?? null;
      const limit = opts.limit ?? 12;
      if (!collationBroken) {
        const data = await qLookup<Row[] | null>("listCards", () => {
          let qb = client.from("cards").select("*").eq("session_id", sessionId);
          if (after !== null) qb = qb.gt("idx", after);
          return qb.order("idx", { ascending: true }).limit(limit);
        });
        const page = rows(data).map(rowToCard);
        checkOrder(page);
        if (!collationBroken) return page.sort(byIdx);
      }
      // byte order and the database's idea of `>` disagree: page in the app instead
      const all = await store.listAllCards(sessionId);
      return all.filter((c) => after === null || c.idx > after).slice(0, limit);
    },
    async listAllCards(sessionId) {
      const data = await qLookup<Row[] | null>("listAllCards", () =>
        client.from("cards").select("*").eq("session_id", sessionId).order("idx", { ascending: true }),
      );
      const all = rows(data).map(rowToCard);
      checkOrder(all);
      return all.sort(byIdx);
    },
    async updateCard(id, patch) {
      const row: Row = {};
      if (patch.viewedAt !== undefined) row.viewed_at = patch.viewedAt;
      if (patch.interaction !== undefined) row.interaction = patch.interaction;
      if (patch.payload !== undefined) row.payload = patch.payload;
      const notFound = () => new SupabaseStoreError("updateCard", { code: "not_found", message: `card not found: ${id}` });
      if (Object.keys(row).length === 0) {
        const cur = await store.getCard(id);
        if (!cur) throw notFound();
        return cur;
      }
      const data = await qLookup<Row | null>("updateCard", () => client.from("cards").update(row).eq("id", id).select().maybeSingle());
      if (!data) throw notFound();
      return rowToCard(data);
    },
    async deleteUnviewedAfter(sessionId, after) {
      if (collationBroken && after !== null) {
        const ids = (await store.listAllCards(sessionId)).filter((c) => !c.viewedAt && c.idx > after).map((c) => c.id);
        if (ids.length === 0) return 0;
        const data = await q<Row[] | null>("deleteUnviewedAfter", () =>
          client.from("cards").delete().eq("session_id", sessionId).is("viewed_at", null).in("id", ids).select("id"),
        );
        return rows(data).length;
      }
      const data = await qLookup<Row[] | null>("deleteUnviewedAfter", () => {
        let qb = client.from("cards").delete().eq("session_id", sessionId).is("viewed_at", null);
        if (after !== null) qb = qb.gt("idx", after);
        return qb.select("id");
      });
      return rows(data).length;
    },
    async lastCard(sessionId) {
      if (collationBroken) {
        // ORDER BY idx lies: pick the byte-order max in the app from a light projection.
        const keys = await qLookup<Row[] | null>("lastCard", () => client.from("cards").select("id, idx").eq("session_id", sessionId));
        const top = rows(keys).map((r) => ({ id: str(r.id), idx: str(r.idx) })).sort(byIdx).pop();
        return top ? store.getCard(top.id) : null;
      }
      const data = await qLookup<Row[] | null>("lastCard", () =>
        client.from("cards").select("*").eq("session_id", sessionId).order("idx", { ascending: false }).limit(1),
      );
      const r = rows(data)[0];
      return r ? rowToCard(r) : null;
    },

    // ── detours ───────────────────────────────────────────────────────────
    async createDetour(d) {
      await insertRows("createDetour", "detours", [detourToRow(d)]);
      return d;
    },
    async listDetours(sessionId) {
      const data = await qLookup<Row[] | null>("listDetours", () =>
        client.from("detours").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      );
      return rows(data).map(rowToDetour);
    },

    // ── batches ───────────────────────────────────────────────────────────
    async claimBatch(b) {
      const res = await exec<Row[] | null>(() => client.from("batches").insert(batchToRow(b)).select());
      if (res.error?.code === "23505") {
        const existing = await store.getBatch(b.sessionId, b.frontierKey);
        // Our own row (first insert committed, response lost) → we still own it.
        if (existing) return { batch: existing, created: existing.id === b.id };
        throw new SupabaseStoreError("claimBatch", res.error);
      }
      if (res.error) throw new SupabaseStoreError("claimBatch", res.error);
      const r = rows(res.data)[0];
      return { batch: r ? rowToBatch(r) : b, created: true };
    },
    async getBatch(sessionId, frontierKey) {
      const data = await qLookup<Row | null>("getBatch", () =>
        client.from("batches").select("*").eq("session_id", sessionId).eq("frontier_key", frontierKey).maybeSingle(),
      );
      return data ? rowToBatch(data) : null;
    },
    async updateBatch(id, patch) {
      const row = batchToRow(patch);
      delete row.id;
      const notFound = () => new SupabaseStoreError("updateBatch", { code: "not_found", message: `batch not found: ${id}` });
      if (Object.keys(row).length === 0) {
        const cur = await qLookup<Row | null>("updateBatch", () => client.from("batches").select("*").eq("id", id).maybeSingle());
        if (!cur) throw notFound();
        return rowToBatch(cur);
      }
      const data = await qLookup<Row | null>("updateBatch", () => client.from("batches").update(row).eq("id", id).select().maybeSingle());
      if (!data) throw notFound();
      return rowToBatch(data);
    },
    async takeoverBatch(id, opts) {
      const now = new Date().toISOString();
      // Conditional UPDATE … RETURNING: only a failed batch or a pending one nobody touched since the cutoff can be
      // claimed; `updated_at = now` additionally re-matches OUR OWN update if its response was lost and retried.
      const cond = `status.eq.failed,and(status.eq.pending,updated_at.lt."${opts.ifUpdatedBefore}"),updated_at.eq."${now}"`;
      const data = await qLookup<Row | null>("takeoverBatch", () =>
        client.from("batches").update({ status: "pending", error: null, card_ids: [], updated_at: now }).eq("id", id).or(cond).select().maybeSingle(),
      );
      return data ? rowToBatch(data) : null;
    },

    // ── llm calls ─────────────────────────────────────────────────────────
    async logLlmCall(c) {
      await insertRows("logLlmCall", "llm_calls", [llmCallToRow(c)]);
    },
    async countLlmCallsSince(sinceIso) {
      // Throws on any error → the LLM layer fails closed.
      const res = await exec<unknown>(() => client.from("llm_calls").select("id", { count: "exact", head: true }).gte("created_at", sinceIso));
      if (res.error) throw new SupabaseStoreError("countLlmCallsSince", res.error);
      if (res.count == null) throw new SupabaseStoreError("countLlmCallsSince", { message: "count unavailable" });
      return res.count;
    },
    async listLlmCalls(sessionId, limit = 100) {
      const data = await q<Row[] | null>("listLlmCalls", () => {
        let qb = client.from("llm_calls").select("*");
        if (sessionId) qb = qb.eq("session_id", sessionId);
        return qb.order("created_at", { ascending: false }).limit(limit);
      });
      return rows(data).map(rowToLlmCall);
    },
  };
  return store;
}
