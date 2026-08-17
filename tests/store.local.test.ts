import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createLocalStore } from "@/lib/db/local";
import type { Store } from "@/lib/db/store";
import type { Batch, CardRow, Session } from "@/lib/schemas/session";
import { defaultLearnerState } from "@/lib/schemas/learner";
import { uuid, nowIso } from "@/lib/id";

function mkSession(over: Partial<Session> = {}): Session {
  const now = nowIso();
  return {
    id: uuid(),
    title: "cache stampedes",
    sourceKind: "sentence",
    sourceMeta: {},
    sourceText: "how a cache keeps a site alive",
    theme: null,
    persona: null,
    outline: [],
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    learnerState: defaultLearnerState(),
    progress: { nodeIdx: 0, cardsInNode: 0, totalGenerated: 0, exhausted: false, extensions: 0, lastIdx: null },
    clarifierAnswers: {},
    status: "planning",
    error: null,
    position: 0,
    createdAt: now,
    lastOpenedAt: now,
    ...over,
  };
}

function mkCard(sessionId: string, idx: string, over: Partial<CardRow> = {}): CardRow {
  const id = uuid();
  return {
    id,
    sessionId,
    idx,
    type: "concept",
    payload: { id, type: "concept", topicNodeId: "n1", detourId: null, headline: `card ${idx}`, body: "body" },
    detourId: null,
    batchId: null,
    viewedAt: null,
    interaction: null,
    createdAt: nowIso(),
    ...over,
  };
}

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drip-store-"));
  store = createLocalStore({ dir });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("local store: sessions", () => {
  it("creates, reads, lists, updates, deletes", async () => {
    const s = await store.createSession(mkSession());
    expect(await store.getSession(s.id)).toEqual(s);
    expect((await store.listSessions()).some((x) => x.id === s.id)).toBe(true);
    const upd = await store.updateSession(s.id, { status: "active", title: "renamed" });
    expect(upd.status).toBe("active");
    expect(upd.title).toBe("renamed");
    expect((await store.getSession(s.id))?.title).toBe("renamed");
    await store.deleteSession(s.id);
    expect(await store.getSession(s.id)).toBeNull();
  });

  it("returns copies, never live references", async () => {
    const s = await store.createSession(mkSession());
    const a = await store.getSession(s.id);
    a!.title = "mutated";
    expect((await store.getSession(s.id))!.title).toBe("cache stampedes");
  });

  it("persists to db.json atomically (no tmp files left behind)", async () => {
    await store.createSession(mkSession());
    expect(existsSync(path.join(dir, "db.json"))).toBe(true);
    const parsed = JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8"));
    expect(Object.keys(parsed.sessions).length).toBeGreaterThan(0);
    const leftovers = readdirSync(dir).filter((f: string) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("updateSession throws for unknown id", async () => {
    await expect(store.updateSession(uuid(), { title: "x" })).rejects.toThrow(/not found/);
  });
});

describe("local store: cards", () => {
  it("orders by idx with plain string comparison and paginates with after/limit", async () => {
    const s = await store.createSession(mkSession());
    // insert out of order on purpose
    await store.insertCards([mkCard(s.id, "a2"), mkCard(s.id, "a0"), mkCard(s.id, "a1"), mkCard(s.id, "a0V"), mkCard(s.id, "Zz")]);
    const all = await store.listAllCards(s.id);
    expect(all.map((c) => c.idx)).toEqual(["Zz", "a0", "a0V", "a1", "a2"]);
    const page = await store.listCards(s.id, { after: "a0", limit: 2 });
    expect(page.map((c) => c.idx)).toEqual(["a0V", "a1"]);
    const fromStart = await store.listCards(s.id, { limit: 1 });
    expect(fromStart.map((c) => c.idx)).toEqual(["Zz"]);
    expect((await store.lastCard(s.id))?.idx).toBe("a2");
  });

  it("rejects duplicate (session, idx) and duplicate ids", async () => {
    const s = await store.createSession(mkSession());
    const c = mkCard(s.id, "a0");
    await store.insertCards([c]);
    await expect(store.insertCards([mkCard(s.id, "a0")])).rejects.toThrow(/duplicate idx/);
    await expect(store.insertCards([{ ...mkCard(s.id, "a1"), id: c.id }])).rejects.toThrow(/duplicate card id/);
    // a different session may reuse the idx
    const s2 = await store.createSession(mkSession());
    await expect(store.insertCards([mkCard(s2.id, "a0")])).resolves.toHaveLength(1);
  });

  it("updateCard merges viewedAt/interaction/payload", async () => {
    const s = await store.createSession(mkSession());
    const [c] = await store.insertCards([mkCard(s.id, "a0")]);
    const at = nowIso();
    const upd = await store.updateCard(c.id, { viewedAt: at, interaction: { correct: true, at } });
    expect(upd.viewedAt).toBe(at);
    expect(upd.interaction?.correct).toBe(true);
    const again = await store.updateCard(c.id, { interaction: { dwellMs: 1200, at } });
    expect(again.viewedAt).toBe(at);
    expect(again.interaction).toEqual({ dwellMs: 1200, at });
  });

  it("deleteUnviewedAfter removes only unviewed rows with idx > after (all threads)", async () => {
    const s = await store.createSession(mkSession());
    const rows = await store.insertCards([
      mkCard(s.id, "a0", { viewedAt: nowIso() }),
      mkCard(s.id, "a1", { viewedAt: nowIso() }),
      mkCard(s.id, "a2"),
      mkCard(s.id, "a2V", { detourId: "d1" }),
      mkCard(s.id, "a3", { viewedAt: nowIso() }),
      mkCard(s.id, "a4"),
    ]);
    const n = await store.deleteUnviewedAfter(s.id, "a1");
    expect(n).toBe(3);
    const left = (await store.listAllCards(s.id)).map((c) => c.idx);
    expect(left).toEqual(["a0", "a1", "a3"]);
    expect(await store.getCard(rows[2].id)).toBeNull();
    // after=null → every unviewed card
    await store.insertCards([mkCard(s.id, "Z")]);
    expect(await store.deleteUnviewedAfter(s.id, null)).toBe(1);
  });

  it("deleteSession cascades to cards/detours/batches", async () => {
    const s = await store.createSession(mkSession());
    const [c] = await store.insertCards([mkCard(s.id, "a0")]);
    await store.createDetour({ id: uuid(), sessionId: s.id, parentDetourId: null, question: "q", insertedAfterIdx: "a0", createdAt: nowIso() });
    await store.claimBatch(mkBatch(s.id, "k"));
    await store.deleteSession(s.id);
    expect(await store.getCard(c.id)).toBeNull();
    expect(await store.listDetours(s.id)).toEqual([]);
    expect(await store.getBatch(s.id, "k")).toBeNull();
  });
});

function mkBatch(sessionId: string, frontierKey: string): Batch {
  const now = nowIso();
  return { id: uuid(), sessionId, frontierKey, status: "pending", cardIds: [], error: null, createdAt: now, updatedAt: now };
}

describe("local store: batches", () => {
  it("claimBatch is unique on (sessionId, frontierKey) even under concurrency", async () => {
    const s = await store.createSession(mkSession());
    const results = await Promise.all(Array.from({ length: 5 }, () => store.claimBatch(mkBatch(s.id, "cardbatch:v1:x"))));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.batch.id));
    expect(ids.size).toBe(1);
    // other session, same key → its own batch
    const s2 = await store.createSession(mkSession());
    expect((await store.claimBatch(mkBatch(s2.id, "cardbatch:v1:x"))).created).toBe(true);
  });

  it("updateBatch + getBatch", async () => {
    const s = await store.createSession(mkSession());
    const { batch } = await store.claimBatch(mkBatch(s.id, "k1"));
    const upd = await store.updateBatch(batch.id, { status: "done", cardIds: ["a", "b"] });
    expect(upd.status).toBe("done");
    expect((await store.getBatch(s.id, "k1"))?.cardIds).toEqual(["a", "b"]);
  });
});

describe("local store: llm calls", () => {
  it("logs and counts since a timestamp", async () => {
    const s = await store.createSession(mkSession());
    const base = Date.now();
    const mk = (offset: number, ok = true) => ({
      id: uuid(), sessionId: s.id, purpose: "write" as const, model: "m", promptVersion: "v1",
      inTokens: 1, outTokens: 1, latencyMs: 5, ok, error: null, createdAt: new Date(base + offset).toISOString(),
    });
    await store.logLlmCall(mk(-100_000));
    await store.logLlmCall(mk(-1000));
    await store.logLlmCall(mk(0, false));
    expect(await store.countLlmCallsSince(new Date(base - 5000).toISOString())).toBe(2);
    const calls = await store.listLlmCalls(s.id, 2);
    expect(calls).toHaveLength(2);
    expect(calls[0].ok).toBe(false); // newest first
  });
});

describe("local store: concurrency", () => {
  it("interleaved writes never lose data", async () => {
    const s = await store.createSession(mkSession());
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.insertCards([mkCard(s.id, `b${String(i).padStart(2, "0")}`)])));
    expect(await store.listAllCards(s.id)).toHaveLength(25);
    // a second store instance on the same dir shares state
    const other = createLocalStore({ dir });
    expect(await other.listAllCards(s.id)).toHaveLength(25);
    // and a fresh process would read the same thing from disk
    const parsed = JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8"));
    expect(Object.values(parsed.cards).filter((c) => (c as CardRow).sessionId === s.id)).toHaveLength(25);
  });
});
