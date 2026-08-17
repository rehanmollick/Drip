import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Batch, CardRow, Detour, LlmCall, Session } from "@/lib/schemas/session";
import type { Store } from "./store";

/**
 * Supabase Postgres store (production). Schema: supabase/migrations/0001_init.sql.
 * The server talks to Postgres with the SERVICE ROLE key (RLS bypass) — this
 * module is server-only and the key never reaches the browser.
 *
 * Row mapping (camelCase ↔ snake_case) lives in pure, exported helpers so it
 * can be unit-tested without a database. Cold start (free-tier pause): the
 * first failing query is retried once after 3s (spec §12.8); transient
 * gateway errors are retried once at any time.
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
    outline: obj<Session["outline"]>(r.outline, []),
    settings: obj<Session["settings"]>(r.settings, { chillMode: false, depthPreset: "standard", soundOn: false }),
    learnerState: obj<Session["learnerState"]>(r.learner_state, {} as Session["learnerState"]),
    progress: obj<Session["progress"]>(r.progress, {
      nodeIdx: 0, cardsInNode: 0, totalGenerated: 0, exhausted: false, extensions: 0, lastIdx: null,
    }),
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

export class SupabaseStoreError extends Error {
  code: string;
  constructor(op: string, e: { code?: string; message: string }) {
    super(`[supabase:${op}] ${e.message}`);
    this.code = e.code ?? "supabase_error";
  }
}

const TRANSIENT = new Set(["502", "503", "504", "522", "523", "524", "PGRST001", "PGRST002", "57P01", "57P03", "08006", "08001"]);
function isTransient(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code && TRANSIENT.has(String(e.code))) return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("fetch failed") || m.includes("econnreset") || m.includes("timeout") || m.includes("network") || m.includes("paused");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSupabaseStore(opts: { url?: string; key?: string; client?: SupabaseClient; retryDelayMs?: number } = {}): Store {
  const url = opts.url ?? process.env.SUPABASE_URL;
  const key = opts.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!opts.client && (!url || !key)) throw new Error("supabase store: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const client: SupabaseClient = opts.client ?? createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const retryDelay = opts.retryDelayMs ?? 3000;
  let warmed = false;

  /**
   * Run a query with cold-start protection: until the first query succeeds,
   * any failure is retried once after `retryDelay`; afterwards only transient
   * gateway/network failures are retried once.
   */
  async function q<T>(op: string, run: () => PromiseLike<{ data: T; error: PgError }>): Promise<T> {
    let res: { data: T; error: PgError };
    try {
      res = await run();
    } catch (e) {
      res = { data: null as T, error: { message: e instanceof Error ? e.message : String(e), code: "fetch_failed" } };
    }
    if (res.error && (!warmed || isTransient(res.error))) {
      await sleep(retryDelay);
      try {
        res = await run();
      } catch (e) {
        res = { data: null as T, error: { message: e instanceof Error ? e.message : String(e), code: "fetch_failed" } };
      }
    }
    if (res.error) throw new SupabaseStoreError(op, res.error);
    warmed = true;
    return res.data;
  }

  const rows = <T>(v: T[] | null | undefined): T[] => v ?? [];

  return {
    // ── sessions ──────────────────────────────────────────────────────────
    async createSession(s) {
      const data = await q<Row[] | null>("createSession", () => client.from("sessions").insert(sessionToRow(s)).select());
      const r = rows(data)[0];
      return r ? rowToSession(r) : s;
    },
    async getSession(id) {
      const data = await q<Row | null>("getSession", () => client.from("sessions").select("*").eq("id", id).maybeSingle());
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
      const data = await q<Row | null>("updateSession", () =>
        client.from("sessions").update(row).eq("id", id).select().maybeSingle(),
      );
      if (!data) throw new SupabaseStoreError("updateSession", { code: "not_found", message: `session not found: ${id}` });
      return rowToSession(data);
    },
    async deleteSession(id) {
      await q("deleteSession", () => client.from("sessions").delete().eq("id", id));
    },

    // ── cards ─────────────────────────────────────────────────────────────
    async insertCards(cards) {
      if (cards.length === 0) return [];
      const data = await q<Row[] | null>("insertCards", () => client.from("cards").insert(cards.map(cardToRow)).select());
      const out = rows(data).map(rowToCard);
      return out.length ? out.sort((a, b) => (a.idx < b.idx ? -1 : 1)) : cards;
    },
    async getCard(id) {
      const data = await q<Row | null>("getCard", () => client.from("cards").select("*").eq("id", id).maybeSingle());
      return data ? rowToCard(data) : null;
    },
    async listCards(sessionId, opts = {}) {
      const after = opts.after ?? null;
      const limit = opts.limit ?? 12;
      const data = await q<Row[] | null>("listCards", () => {
        let qb = client.from("cards").select("*").eq("session_id", sessionId);
        if (after !== null) qb = qb.gt("idx", after);
        return qb.order("idx", { ascending: true }).limit(limit);
      });
      return rows(data).map(rowToCard);
    },
    async listAllCards(sessionId) {
      const data = await q<Row[] | null>("listAllCards", () =>
        client.from("cards").select("*").eq("session_id", sessionId).order("idx", { ascending: true }),
      );
      return rows(data).map(rowToCard);
    },
    async updateCard(id, patch) {
      const row: Row = {};
      if (patch.viewedAt !== undefined) row.viewed_at = patch.viewedAt;
      if (patch.interaction !== undefined) row.interaction = patch.interaction;
      if (patch.payload !== undefined) row.payload = patch.payload;
      const data = await q<Row | null>("updateCard", () => client.from("cards").update(row).eq("id", id).select().maybeSingle());
      if (!data) throw new SupabaseStoreError("updateCard", { code: "not_found", message: `card not found: ${id}` });
      return rowToCard(data);
    },
    async deleteUnviewedAfter(sessionId, after) {
      const data = await q<Row[] | null>("deleteUnviewedAfter", () => {
        let qb = client.from("cards").delete().eq("session_id", sessionId).is("viewed_at", null);
        if (after !== null) qb = qb.gt("idx", after);
        return qb.select("id");
      });
      return rows(data).length;
    },
    async lastCard(sessionId) {
      const data = await q<Row[] | null>("lastCard", () =>
        client.from("cards").select("*").eq("session_id", sessionId).order("idx", { ascending: false }).limit(1),
      );
      const r = rows(data)[0];
      return r ? rowToCard(r) : null;
    },

    // ── detours ───────────────────────────────────────────────────────────
    async createDetour(d) {
      await q("createDetour", () => client.from("detours").insert(detourToRow(d)));
      return d;
    },
    async listDetours(sessionId) {
      const data = await q<Row[] | null>("listDetours", () =>
        client.from("detours").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      );
      return rows(data).map(rowToDetour);
    },

    // ── batches ───────────────────────────────────────────────────────────
    async claimBatch(b) {
      let res: { data: Row[] | null; error: PgError };
      try {
        res = await client.from("batches").insert(batchToRow(b)).select();
      } catch (e) {
        res = { data: null, error: { message: e instanceof Error ? e.message : String(e), code: "fetch_failed" } };
      }
      if (res.error && res.error.code !== "23505" && (!warmed || isTransient(res.error))) {
        await sleep(retryDelay);
        res = await client.from("batches").insert(batchToRow(b)).select();
      }
      if (res.error?.code === "23505") {
        const existing = await this.getBatch(b.sessionId, b.frontierKey);
        if (existing) return { batch: existing, created: false };
        throw new SupabaseStoreError("claimBatch", res.error);
      }
      if (res.error) throw new SupabaseStoreError("claimBatch", res.error);
      warmed = true;
      const r = rows(res.data)[0];
      return { batch: r ? rowToBatch(r) : b, created: true };
    },
    async getBatch(sessionId, frontierKey) {
      const data = await q<Row | null>("getBatch", () =>
        client.from("batches").select("*").eq("session_id", sessionId).eq("frontier_key", frontierKey).maybeSingle(),
      );
      return data ? rowToBatch(data) : null;
    },
    async updateBatch(id, patch) {
      const row = batchToRow(patch);
      delete row.id;
      const data = await q<Row | null>("updateBatch", () => client.from("batches").update(row).eq("id", id).select().maybeSingle());
      if (!data) throw new SupabaseStoreError("updateBatch", { code: "not_found", message: `batch not found: ${id}` });
      return rowToBatch(data);
    },

    // ── llm calls ─────────────────────────────────────────────────────────
    async logLlmCall(c) {
      await q("logLlmCall", () => client.from("llm_calls").insert(llmCallToRow(c)));
    },
    async countLlmCallsSince(sinceIso) {
      // Throws on any error → the LLM layer fails closed.
      let res: { count: number | null; error: PgError };
      try {
        res = await client.from("llm_calls").select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
      } catch (e) {
        res = { count: null, error: { message: e instanceof Error ? e.message : String(e), code: "fetch_failed" } };
      }
      if (res.error && (!warmed || isTransient(res.error))) {
        await sleep(retryDelay);
        res = await client.from("llm_calls").select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
      }
      if (res.error) throw new SupabaseStoreError("countLlmCallsSince", res.error);
      if (res.count == null) throw new SupabaseStoreError("countLlmCallsSince", { message: "count unavailable" });
      warmed = true;
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
}
