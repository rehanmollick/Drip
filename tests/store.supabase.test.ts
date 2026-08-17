import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  batchToRow, cardToRow, createSupabaseStore, detourToRow, llmCallToRow, rowToBatch, rowToCard, rowToDetour,
  rowToLlmCall, rowToSession, sessionToRow,
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
  progress: { nodeIdx: 1, cardsInNode: 2, totalGenerated: 6, exhausted: false, extensions: 0, lastIdx: "a3" },
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
  const next = () => {
    const fn = script.shift();
    if (!fn) throw new Error("fake client: unexpected extra query");
    return fn();
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (b[name] = () => { calls.push(`${table}.${name}`); return b; });
    for (const m of ["select", "insert", "update", "delete", "eq", "gt", "gte", "is", "order", "limit", "maybeSingle"]) chain(m);
    b.then = (res: (v: Result) => void, rej: (e: unknown) => void) => Promise.resolve().then(next).then(res, rej);
    return b;
  };
  return { client: { from: builder } as unknown as SupabaseClient, calls };
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
    await expect(store.getSession(session.id)).rejects.toThrow(/relation does not exist/);
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
