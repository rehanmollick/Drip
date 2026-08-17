import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import path from "path";
import { generateNKeysBetween } from "fractional-indexing";
import {
  batchToRow, cardToRow, createSupabaseStore, detourToRow, isDefinite, isTransient, llmCallToRow, rowToBatch, rowToCard,
  rowToDetour, rowToLlmCall, rowToSession, sessionToRow, isSchemaMissing, SupabaseStoreError,
} from "@/lib/db/supabase";
import type { Batch, CardRow, Detour, LlmCall, Session } from "@/lib/schemas/session";
import { defaultLearnerState } from "@/lib/schemas/learner";

const session: Session = {
  id: "9c1c7c1a-2f7f-4d5f-9d4a-9a5c1a2b3c4d",
  title: "t",
  sourceKind: "paste",
  sourceMeta: { url: "x" },
  sourceText: "hello",
  theme: null,
  persona: null,
  outline: [{ id: "n1", title: "one", estCards: 4, dependsOn: [] }],
  settings: { chillMode: true, depthPreset: "deep", soundOn: false },
  learnerState: defaultLearnerState(),
  progress: { nodeIdx: 1, cardsInNode: 2, totalGenerated: 6, exhausted: false, extensions: 0, lastIdx: "a3", epoch: 0, pendingReplan: false },
  clarifierAnswers: { audience: "me" },
  status: "active",
  error: null,
  position: 3,
  createdAt: "2026-08-16T10:00:00.000Z",
  lastOpenedAt: "2026-08-16T11:00:00.000Z",
};

describe("supabase row mapping", () => {
  it("session round-trips camelCase ↔ snake_case", () => {
    const row = sessionToRow(session);
    expect(row.source_kind).toBe("paste");
    expect(row.learner_state).toEqual(session.learnerState);
    expect(row.clarifier_answers).toEqual({ audience: "me" });
    expect(row.last_opened_at).toBe(session.lastOpenedAt);
    // postgres returns timestamptz with an offset — normalised to ISO Z
    const back = rowToSession({ ...row, created_at: "2026-08-16T10:00:00+00:00", last_opened_at: "2026-08-16T11:00:00+00:00" });
    expect(back).toEqual(session);
  });

  it("partial session patch only maps present keys", () => {
    expect(sessionToRow({ status: "error", error: "boom" })).toEqual({ status: "error", error: "boom" });
    expect(sessionToRow({ position: 0 })).toEqual({ position: 0 });
  });

  it("card round-trips", () => {
    const c: CardRow = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01", sessionId: session.id, idx: "a0V", type: "concept",
      payload: { id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01", type: "concept", topicNodeId: "n1", detourId: null, headline: "h", body: "b" },
      detourId: null, batchId: "b1", viewedAt: null, interaction: { correct: true, at: "2026-08-16T10:00:00.000Z" },
      createdAt: "2026-08-16T10:00:00.000Z",
    };
    expect(rowToCard(cardToRow(c))).toEqual(c);
    expect(rowToCard({ ...cardToRow(c), viewed_at: "2026-08-16T12:00:00+00:00" }).viewedAt).toBe("2026-08-16T12:00:00.000Z");
  });

  it("jsonb '{}' defaults (migration default / hand-inserted row) parse to real schema defaults", () => {
    const back = rowToSession({ id: session.id, title: "x", source_kind: "sentence", status: "active", settings: {}, learner_state: {}, progress: {} });
    expect(back.learnerState).toEqual(defaultLearnerState());
    expect(back.learnerState.rolling.last10Interactive).toEqual([]);
    expect(back.settings).toEqual({ chillMode: false, depthPreset: "standard", soundOn: false });
    expect(back.progress).toEqual({ nodeIdx: 0, cardsInNode: 0, totalGenerated: 0, exhausted: false, extensions: 0, lastIdx: null, epoch: 0, pendingReplan: false });
    // missing columns entirely (older migration) → same defaults, no throw
    const bare = rowToSession({ id: session.id, title: "x", status: "active" });
    expect(bare.learnerState.directives.pace).toBe("normal");
    expect(bare.outline).toEqual([]);
    // a partial blob keeps what it has and fills the rest
    const partial = rowToSession({ id: session.id, settings: { chillMode: true }, progress: { nodeIdx: 3 } });
    expect(partial.settings).toEqual({ chillMode: true, depthPreset: "standard", soundOn: false });
    expect(partial.progress.nodeIdx).toBe(3);
    expect(partial.progress.epoch).toBe(0);
  });

  it("detour / batch / llm call round-trip", () => {
    const d: Detour = { id: "d", sessionId: session.id, parentDetourId: "p", question: "q", insertedAfterIdx: "a1", createdAt: "2026-08-16T10:00:00.000Z" };
    expect(rowToDetour(detourToRow(d))).toEqual(d);
    const b: Batch = { id: "b", sessionId: session.id, frontierKey: "k", status: "done", cardIds: ["x"], error: null, createdAt: "2026-08-16T10:00:00.000Z", updatedAt: "2026-08-16T10:00:00.000Z" };
    expect(rowToBatch(batchToRow(b))).toEqual(b);
    expect(batchToRow({ status: "failed", error: "e" })).toEqual({ status: "failed", error: "e" });
    const l: LlmCall = { id: "l", sessionId: null, purpose: "plan", model: "m", promptVersion: "v2", inTokens: 1, outTokens: 2, latencyMs: 3, ok: false, error: "x", createdAt: "2026-08-16T10:00:00.000Z" };
    expect(rowToLlmCall(llmCallToRow(l))).toEqual(l);
  });
});

// ── a tiny fake PostgREST builder to exercise claimBatch + retry logic ──────
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };
function fakeClient(script: Array<() => Result | Promise<Result>>) {
  const calls: string[] = [];
  const args: Record<string, unknown[][]> = {};
  const next = () => {
    const fn = script.shift();
    if (!fn) throw new Error("fake client: unexpected extra query");
    return fn();
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (b[name] = (...a: unknown[]) => { calls.push(`${table}.${name}`); (args[`${table}.${name}`] ??= []).push(a); return b; });
    for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "gt", "gte", "in", "is", "or", "order", "limit", "maybeSingle"]) chain(m);
    b.then = (res: (v: Result) => void, rej: (e: unknown) => void) => Promise.resolve().then(next).then(res, rej);
    return b;
  };
  return { client: { from: builder } as unknown as SupabaseClient, calls, args };
}

describe("supabase store behaviour (fake client)", () => {
  it("claimBatch: unique violation → returns the existing batch with created:false", async () => {
    const existing = { id: "b1", session_id: session.id, frontier_key: "k", status: "pending", card_ids: [], error: null, created_at: "2026-08-16T10:00:00.000Z", updated_at: "2026-08-16T10:00:00.000Z" };
    const { client } = fakeClient([
      () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
      () => ({ data: existing, error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const b: Batch = { id: "b2", sessionId: session.id, frontierKey: "k", status: "pending", cardIds: [], error: null, createdAt: "x", updatedAt: "x" };
    const res = await store.claimBatch(b);
    expect(res.created).toBe(false);
    expect(res.batch.id).toBe("b1");
  });

  it("claimBatch: fresh insert → created:true", async () => {
    const { client } = fakeClient([() => ({ data: [{ id: "b2", session_id: session.id, frontier_key: "k", status: "pending", card_ids: [] }], error: null })]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const b: Batch = { id: "b2", sessionId: session.id, frontierKey: "k", status: "pending", cardIds: [], error: null, createdAt: "x", updatedAt: "x" };
    expect((await store.claimBatch(b)).created).toBe(true);
  });

  it("cold start: first failing query is retried once", async () => {
    const { client } = fakeClient([
      () => ({ data: null, error: { message: "fetch failed" } }),
      () => ({ data: { id: session.id, title: "t", status: "active" }, error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const s = await store.getSession(session.id);
    expect(s?.title).toBe("t");
  });

  it("after warm-up, non-transient errors surface immediately", async () => {
    const { client } = fakeClient([
      () => ({ data: { id: session.id, title: "t", status: "active" }, error: null }),
      () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    await store.getSession(session.id);
    await expect(store.getSession(session.id)).rejects.toThrow(/DRIP tables are missing/);
  });

  it("countLlmCallsSince throws when the count is unreadable (fail closed)", async () => {
    const { client } = fakeClient([
      () => ({ data: null, error: null, count: 7 }),
      () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    expect(await store.countLlmCallsSince("2026-08-16T00:00:00.000Z")).toBe(7);
    await expect(store.countLlmCallsSince("2026-08-16T00:00:00.000Z")).rejects.toThrow(/permission denied/);
  });
});

describe("supabase store: retry policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("classifies errors: transient vs definite", () => {
    expect(isTransient({ code: "PGRST001", message: "" })).toBe(true);
    expect(isTransient({ message: "TypeError: fetch failed" })).toBe(true);
    expect(isTransient({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isDefinite({ code: "22P02" })).toBe(true);
    expect(isDefinite({ code: "42P01" })).toBe(true);
    expect(isDefinite({ code: "PGRST205" })).toBe(true);
    expect(isDefinite({ code: "503" })).toBe(false);
    expect(isDefinite({ code: "fetch_failed" })).toBe(false);
  });

  it("cold start does NOT retry a definite Postgres answer (no 3s sleep for a bad uuid / missing table)", async () => {
    const { client, calls } = fakeClient([
      () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    await expect(store.listSessions()).rejects.toThrow(/DRIP tables are missing/);
    expect(calls.filter((c) => c === "sessions.select")).toHaveLength(1);
  });

  it("a malformed uuid on a point lookup is 'no such row', not a 500", async () => {
    const { client } = fakeClient([
      () => ({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }),
      () => ({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }),
      () => ({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    expect(await store.getSession("not-a-uuid")).toBeNull();
    expect(await store.getCard("not-a-uuid")).toBeNull();
    await expect(store.updateCard("not-a-uuid", { viewedAt: "x" })).rejects.toThrow(/card not found/);
  });

  it("insert retry after a lost response is an upsert that ignores duplicates (never a spurious 23505 or a double insert)", async () => {
    const c: CardRow = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01", sessionId: session.id, idx: "a0", type: "concept",
      payload: { id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01", type: "concept", topicNodeId: "n1", detourId: null, headline: "h", body: "b" },
      detourId: null, batchId: null, viewedAt: null, interaction: null, createdAt: "2026-08-16T10:00:00.000Z",
    };
    const { client, calls } = fakeClient([
      () => { throw new Error("fetch failed"); },      // first insert: committed server-side, response lost
      () => ({ data: [], error: null }),                // upsert ignoreDuplicates → nothing new to return
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const out = await store.insertCards([c]);
    expect(out).toEqual([c]);
    expect(calls).toContain("cards.insert");
    expect(calls).toContain("cards.upsert");
  });

  it("claimBatch: our own row after a lost response → created:true (we still own it)", async () => {
    const mine = { id: "b2", session_id: session.id, frontier_key: "k", status: "pending", card_ids: [], error: null, created_at: "2026-08-16T10:00:00.000Z", updated_at: "2026-08-16T10:00:00.000Z" };
    const { client } = fakeClient([
      () => { throw new Error("ECONNRESET"); },
      () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
      () => ({ data: mine, error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const b: Batch = { id: "b2", sessionId: session.id, frontierKey: "k", status: "pending", cardIds: [], error: null, createdAt: "x", updatedAt: "x" };
    const res = await store.claimBatch(b);
    expect(res.created).toBe(true);
    expect(res.batch.id).toBe("b2");
  });

  it("empty session / batch patch is a read, never `PATCH {}`", async () => {
    const row = { id: session.id, title: "t", status: "active" };
    const { client, calls } = fakeClient([
      () => ({ data: row, error: null }),
      () => ({ data: null, error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    expect((await store.updateSession(session.id, {})).title).toBe("t");
    expect(calls).not.toContain("sessions.update");
    await expect(store.updateSession(session.id, { title: undefined })).rejects.toThrow(/session not found/);
  });

  it("takeoverBatch: conditional update; null when someone else already owns it", async () => {
    const taken = { id: "b1", session_id: session.id, frontier_key: "k", status: "pending", card_ids: [], error: null, created_at: "2026-08-16T10:00:00.000Z", updated_at: "2026-08-16T10:00:00.000Z" };
    const { client, calls, args } = fakeClient([
      () => ({ data: taken, error: null }),
      () => ({ data: null, error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const cutoff = "2026-08-16T09:59:00.000Z";
    expect((await store.takeoverBatch("b1", { ifUpdatedBefore: cutoff }))?.status).toBe("pending");
    expect(calls).toContain("batches.or");
    // failed OR (pending AND untouched since cutoff) OR our own just-written updated_at (lost-response retry)
    const cond = String(args["batches.or"][0][0]);
    expect(cond).toMatch(/^status\.eq\.failed,and\(status\.eq\.pending,updated_at\.lt\."2026-08-16T09:59:00\.000Z"\),updated_at\.eq\."/);
    const upd = args["batches.update"][0][0] as Record<string, unknown>;
    expect(upd).toMatchObject({ status: "pending", error: null, card_ids: [] });
    expect(cond.endsWith(`updated_at.eq."${upd.updated_at}"`)).toBe(true);
    expect(await store.takeoverBatch("b1", { ifUpdatedBefore: cutoff })).toBeNull();
  });
});

describe("supabase store: idx byte order", () => {
  afterEach(() => vi.restoreAllMocks());

  const mkRow = (id: string, idx: string) => ({
    id, session_id: session.id, idx, type: "concept", detour_id: null, batch_id: null, viewed_at: null, interaction: null,
    created_at: "2026-08-16T10:00:00.000Z",
    payload: { id, type: "concept", topicNodeId: "n1", detourId: null, headline: idx, body: "b" },
  });

  it("fractional-indexing keys are monotonic under byte order but NOT under en_US collation — hence collate \"C\"", () => {
    const keys = generateNKeysBetween(null, null, 60); // a0..a9, aA..aZ, aa.. crosses the case boundary
    const byteSorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(byteSorted).toEqual(keys);
    const collator = new Intl.Collator("en-US");
    const localeSorted = [...keys].sort(collator.compare);
    expect(localeSorted).not.toEqual(keys);
    // and the migration says so
    const init = readFileSync(path.join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8");
    expect(init).toMatch(/idx\s+text collate "C" not null/);
    expect(init).toMatch(/inserted_after_idx text collate "C" not null/);
    const alter = readFileSync(path.join(process.cwd(), "supabase/migrations/0002_idx_collation.sql"), "utf8");
    expect(alter).toMatch(/alter table cards\s+alter column idx\s+type text collate "C"/);
    expect(alter).toMatch(/alter table detours alter column inserted_after_idx type text collate "C"/);
  });

  it("re-sorts pages in byte order and, once the database misorders idx, stops trusting ORDER BY / > for lastCard, listCards, deleteUnviewedAfter", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // en_US order of the byte-ordered sequence a9 < aA < aZ < aa
    const enUS = [mkRow("00000000-0000-4000-8000-000000000001", "a9"), mkRow("00000000-0000-4000-8000-000000000002", "aa"), mkRow("00000000-0000-4000-8000-000000000003", "aA"), mkRow("00000000-0000-4000-8000-000000000004", "aZ")];
    const { client, calls } = fakeClient([
      () => ({ data: enUS, error: null }),                                       // listAllCards (ORDER BY idx, en_US)
      () => ({ data: enUS.map((r) => ({ id: r.id, idx: r.idx })), error: null }), // lastCard: id/idx projection
      () => ({ data: enUS[1], error: null }),                                     // getCard(byte-order max = 'aa')
      () => ({ data: enUS, error: null }),                                        // listCards → listAllCards
      () => ({ data: enUS, error: null }),                                        // deleteUnviewedAfter → listAllCards
      () => ({ data: [{ id: enUS[1].id }], error: null }),                       // delete .in(ids)
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    const all = await store.listAllCards(session.id);
    expect(all.map((c) => c.idx)).toEqual(["a9", "aA", "aZ", "aa"]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toMatch(/0002_idx_collation/);
    expect((await store.lastCard(session.id))?.idx).toBe("aa");
    expect((await store.listCards(session.id, { after: "aA", limit: 5 })).map((c) => c.idx)).toEqual(["aZ", "aa"]);
    expect(await store.deleteUnviewedAfter(session.id, "aZ")).toBe(1);
    expect(calls).toContain("cards.in");
    expect(err).toHaveBeenCalledTimes(1); // logged once
  });

  it("with a correctly collated database the single-query paths are used", async () => {
    const ok = [mkRow("00000000-0000-4000-8000-000000000001", "a9"), mkRow("00000000-0000-4000-8000-000000000003", "aA"), mkRow("00000000-0000-4000-8000-000000000004", "aZ"), mkRow("00000000-0000-4000-8000-000000000002", "aa")];
    const { client, calls } = fakeClient([
      () => ({ data: ok, error: null }),
      () => ({ data: [ok[3]], error: null }),
    ]);
    const store = createSupabaseStore({ client, retryDelayMs: 1 });
    expect((await store.listAllCards(session.id)).map((c) => c.idx)).toEqual(["a9", "aA", "aZ", "aa"]);
    expect((await store.lastCard(session.id))?.idx).toBe("aa");
    expect(calls.filter((c) => c === "cards.select")).toHaveLength(2);
  });
});

describe("un-migrated project", () => {
  it("turns PostgREST's schema-cache miss into an actionable message, not a raw 500", () => {
    const e = new SupabaseStoreError("getSession", { code: "PGRST205", message: "Could not find the table 'public.sessions' in the schema cache" });
    expect(e.code).toBe("schema_missing");
    expect(e.message).toMatch(/0001_init\.sql/);
    expect(e.message).toMatch(/DRIP_STORE=local/);
    expect(isSchemaMissing({ code: "42P01", message: 'relation "sessions" does not exist' })).toBe(true);
    expect(isSchemaMissing({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
