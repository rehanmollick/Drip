import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

import { createLocalStore } from "@/lib/db/local";
import type { Store } from "@/lib/db/store";
import { STALE_BATCH_MS, frontierKeyFor, frontierOf, setEngineDepsForTests } from "@/lib/generation/engine";
import { COUNTS_TOWARD_NODE, closedNodes, deeperGrants, frontierPublic, gateOf, nodeCensus } from "@/lib/generation/frontier";
import { WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import type { OutlineNode } from "@/lib/schemas/plan";
import { SessionSchema, type Batch, type CardRow, type Session } from "@/lib/schemas/session";
import { nowIso, uuid } from "@/lib/id";
import * as sessionRoute from "@/app/api/sessions/[id]/route";

/**
 * The engine used to be the only thing that knew where generation was; anything drawing a position
 * had to guess from `estCards`. These are the counts it now says out loud, so what they must never
 * do is flatter the feed: a card that doesn't teach a node isn't progress through it, a node isn't
 * finished until the writer said so with a crossroads, and a pulse only pulses while somebody is
 * actually writing.
 */

const OUTLINE: OutlineNode[] = [
  { id: "n1", title: "the stampede", estCards: 4, dependsOn: [] },
  { id: "n2", title: "warmups", estCards: 4, dependsOn: [] },
  { id: "n3", title: "ttl", estCards: 4, dependsOn: [] },
];

let seq = 0;
type Over = { detourId?: string; choice?: string; createdAt?: string; kind?: string };
const row = (type: string, topicNodeId: string, over: Over = {}): CardRow =>
  ({
    id: uuid(),
    sessionId: "s",
    idx: `a${(seq++).toString().padStart(4, "0")}`,
    type,
    payload: { type, topicNodeId, detourId: over.detourId ?? null, ...(over.kind ? { kind: over.kind } : {}) },
    detourId: over.detourId ?? null,
    batchId: null,
    viewedAt: null,
    interaction: over.choice ? { choice: over.choice, at: nowIso() } : null,
    createdAt: over.createdAt ?? nowIso(),
  }) as unknown as CardRow;

const session = (over: Partial<Session> = {}): Session =>
  SessionSchema.parse({
    id: uuid(),
    title: "how a cache keeps a site alive",
    sourceKind: "sentence",
    sourceMeta: {},
    sourceText: "how a cache keeps a site alive",
    theme: null,
    persona: null,
    outline: OUTLINE,
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    learnerState: defaultLearnerState(),
    progress: {},
    clarifierAnswers: {},
    storyline: null,
    status: "active",
    error: null,
    position: 0,
    createdAt: nowIso(),
    lastOpenedAt: nowIso(),
    ...over,
  });

describe("the census counts cards that exist, not cards that were promised", () => {
  it("counts only main-thread teaching cards, per node", () => {
    const cards = [
      row("hook", "n1"),
      row("concept", "n1"),
      row("code", "n1"),
      row("recap", "n1"),                       // scaffolding around the thread, not progress through it
      row("crossroads", "n1"),
      row("detour_marker", "n1", { detourId: "d1" }),
      row("concept", "n1", { detourId: "d1" }), // somebody's question, not the outline
      row("notice", "system", { kind: "budget" }),
      row("clarify", "clarify"),
      row("fallback", "system"),
      row("stat", "n2"),
      row("open", "n2"),
      row("wrap", "system"),
    ];
    expect(nodeCensus(cards, OUTLINE)).toEqual({ n1: 3, n2: 2 });
  });

  it("a node nobody has written yet is absent, not a zero — the client reads a missing node as none", () => {
    const cards = [row("concept", "n1"), row("hook", "adjacent"), row("concept", "resurface"), row("concept", "teaser")];
    expect(nodeCensus(cards, OUTLINE)).toEqual({ n1: 1 });
  });

  it("the census set is exactly the writer's types minus recap — the same predicate the engine budgets nodes with", () => {
    expect([...COUNTS_TOWARD_NODE].sort()).toEqual(WRITER_CARD_TYPES.filter((t) => t !== "recap").slice().sort());
    for (const t of ["recap", "crossroads", "wrap", "notice", "clarify", "fallback", "detour_marker"]) {
      expect(COUNTS_TOWARD_NODE.has(t), `${t} must never count toward a node`).toBe(false);
    }
  });
});

describe("a node is closed when the writer said so", () => {
  it("a crossroads row closes its node, once, in the order they were written", () => {
    const cards = [row("concept", "n1"), row("crossroads", "n1"), row("concept", "n2"), row("crossroads", "n2"), row("crossroads", "n2")];
    expect(closedNodes(cards)).toEqual(["n1", "n2"]);
  });

  it("a node with cards but no crossroads is still open, whatever estCards guessed", () => {
    expect(closedNodes([row("concept", "n1"), row("concept", "n1"), row("concept", "n1"), row("concept", "n1"), row("concept", "n1")])).toEqual([]);
  });

  it("detour rows never close anything", () => {
    expect(closedNodes([row("crossroads", "n1", { detourId: "d1" })])).toEqual([]);
  });
});

describe("what generation is parked on", () => {
  const parked = session({ progress: { ...session().progress, awaitingChoice: true } });

  it("an unanswered crossroads is the gate; an answered one isn't", () => {
    expect(gateOf(parked, [row("concept", "n1"), row("crossroads", "n1")])).toBe("crossroads");
    expect(gateOf(parked, [row("crossroads", "n1", { choice: "continue" })])).toBeNull();
  });

  it("a thread that isn't waiting on anybody has no gate", () => {
    expect(gateOf(session(), [row("concept", "n1"), row("crossroads", "n1")])).toBeNull();
  });

  it("a wrap ends the thread for good, whatever else is on it", () => {
    expect(gateOf(session(), [row("concept", "n1"), row("wrap", "system")])).toBe("wrap");
    expect(gateOf(parked, [row("crossroads", "n1"), row("wrap", "system")])).toBe("wrap");
  });
});

describe("the wire shape", () => {
  it("carries the counts, the gate, the epoch and the layers a tap bought", () => {
    const s = session({
      progress: { ...session().progress, nodeIdx: 1, epoch: 3, awaitingChoice: true },
    });
    const cards = [
      row("concept", "n1"),
      row("crossroads", "n1", { choice: "deeper" }),
      row("concept", "n1"),
      row("stat", "n2"),
      row("crossroads", "n2"),
    ];
    const f = frontierPublic(s, cards, { nodeIdx: 1, startedAt: "2026-08-16T11:00:00.000Z" });
    expect(f).toEqual({
      written: { n1: 2, n2: 1 },
      nodeIdx: 1,
      deeper: { n1: 3 },
      closed: ["n1", "n2"],
      gate: "crossroads",
      live: { nodeIdx: 1, startedAt: "2026-08-16T11:00:00.000Z" },
      epoch: 3,
    });
  });

  it("the deep preset buys a bigger layer", () => {
    const cards = [row("crossroads", "n1", { choice: "deeper" }), row("crossroads", "n2", { choice: "continue" })];
    expect(deeperGrants(cards, "standard")).toEqual({ n1: 3 });
    expect(deeperGrants(cards, "deep")).toEqual({ n1: 4 });
  });
});

describe("frontierOf: the engine's own answer", () => {
  let dir: string;
  let base: Store;
  let store: Store;
  let scans = 0;

  const storeRow = (sessionId: string, idx: string, type: string, topicNodeId: string): CardRow =>
    ({ ...row(type, topicNodeId), sessionId, idx }) as CardRow;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "drip-frontier-"));
    base = createLocalStore({ dir });
    store = { ...base, listAllCards: (id: string) => { scans += 1; return base.listAllCards(id); } };
    setEngineDepsForTests({ store });
  });
  afterAll(() => {
    setEngineDepsForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  const pending = (s: Session, frontierKey: string): Batch =>
    ({ id: uuid(), sessionId: s.id, frontierKey, status: "pending", cardIds: [], error: null, createdAt: nowIso(), updatedAt: nowIso() });

  it("pulses only while a batch is actually being written", async () => {
    const s = session();
    await store.createSession(s);
    await store.insertCards([storeRow(s.id, "a0", "hook", "n1"), storeRow(s.id, "a1", "concept", "n1")]);
    const b = pending(s, frontierKeyFor(s, "a1"));
    await store.claimBatch(b);

    const f = await frontierOf(s.id);
    expect(f?.live).toEqual({ nodeIdx: 0, startedAt: b.createdAt });
    expect(f?.written).toEqual({ n1: 2 });
    expect(f?.gate).toBeNull();

    // a batch that finished is not thinking
    await store.updateBatch(b.id, { status: "done", cardIds: [] });
    expect((await frontierOf(s.id))?.live).toBeNull();
    await store.updateBatch(b.id, { status: "failed" });
    expect((await frontierOf(s.id))?.live).toBeNull();

    // a pending batch nobody has touched in STALE_BATCH_MS is dead, not slow: pulsing for it would be a lie
    await store.updateBatch(b.id, { status: "pending", updatedAt: new Date(Date.now() - STALE_BATCH_MS - 1_000).toISOString() });
    expect((await frontierOf(s.id))?.live).toBeNull();
    // …and one whose owner just heartbeat is alive again
    await store.updateBatch(b.id, { updatedAt: nowIso() });
    expect((await frontierOf(s.id))?.live?.startedAt).toBe(b.createdAt);
  });

  it("a batch for some other frontier is not this one's pulse", async () => {
    const s = session();
    await store.createSession(s);
    await store.insertCards([storeRow(s.id, "b0", "concept", "n1"), storeRow(s.id, "b1", "concept", "n1")]);
    await store.claimBatch(pending(s, frontierKeyFor(s, "b0"))); // the frontier moved on when b1 landed
    expect((await frontierOf(s.id))?.live).toBeNull();
  });

  it("a session that isn't there has no frontier at all", async () => {
    expect(await frontierOf(uuid())).toBeNull();
  });

  it("GET /api/sessions/:id says where generation is without a second pass over the feed", async () => {
    const s = session();
    await store.createSession(s);
    await store.insertCards([
      storeRow(s.id, "c0", "hook", "n1"),
      storeRow(s.id, "c1", "concept", "n1"),
      storeRow(s.id, "c2", "stat", "n2"),
    ]);
    scans = 0;
    const res = await sessionRoute.GET(new Request(`http://drip.local/api/sessions/${s.id}`), { params: Promise.resolve({ id: s.id }) });
    const env = (await res.json()) as { data: { session: { cardCount: number; frontier: { written: Record<string, number>; nodeIdx: number } } }; error: unknown };
    expect(env.error).toBeNull();
    expect(env.data.session.cardCount).toBe(3);
    expect(env.data.session.frontier.written).toEqual({ n1: 2, n2: 1 });
    expect(scans, "the frontier must ride along with the card count, not scan the feed again").toBe(1);
  });
});
