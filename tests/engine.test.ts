import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createLocalStore } from "@/lib/db/local";
import type { Store } from "@/lib/db/store";
import type { LlmApi, LlmResult, WriteContext } from "@/lib/llm-types";
import type { Card } from "@/lib/schemas/cards";
import { CardSchema } from "@/lib/schemas/cards";
import type { PlanOutput } from "@/lib/schemas/plan";
import { PlanOutputSchema } from "@/lib/schemas/plan";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { uuid } from "@/lib/id";
import { findBannedInValue } from "@/lib/copy/banned";
import {
  answerClarifiers, ask, chooseAtCrossroads, createSession, dial, generateNext, interact, reapIfStuck, remixSession,
  replan, retrySession, setEngineDepsForTests, startPlanning, PLANNING_TIMEOUT_MS,
} from "@/lib/generation/engine";
import type { CrossroadsCard } from "@/lib/schemas/cards";

// ── fake LLM ────────────────────────────────────────────────────────────────
const okR = <T>(value: T): LlmResult<T> => ({ ok: true, value, meta: { model: "fake", promptVersion: "t", latencyMs: 1, inTokens: 1, outTokens: 1, attempts: 1 } });
const budgetR = <T>(): LlmResult<T> => ({ ok: false, code: "budget", error: "daily cap reached" });
const apiFail = <T>(): LlmResult<T> => ({ ok: false, code: "api", error: "boom" });

const N = (n: number) => `n${n}`;
const concept = (i: string, topicNodeId = "n1"): Card => ({ id: uuid(), type: "concept", topicNodeId, detourId: null, eyebrow: `idea ${i}`, headline: `concept ${i}`, body: `body ${i}` });
const hook = (i: string): Card => ({ id: uuid(), type: "hook", topicNodeId: "n1", detourId: null, headline: `hook ${i}` });
const binary = (i: string): Card => ({ id: uuid(), type: "binary", topicNodeId: "n1", detourId: null, eyebrow: `bet ${i}`, prompt: `hot take ${i}`, options: ["real", "nah"], correctIndex: 1, revealCopy: "nah.", difficulty: 2 });
const code = (i: string): Card => ({ id: uuid(), type: "code", topicNodeId: "n1", detourId: null, lang: "ts", code: `const a${i} = 1;`, annotations: [] });
const stat = (i: string): Card => ({ id: uuid(), type: "stat", topicNodeId: "n1", detourId: null, value: "80%", label: `hit rate ${i}`, context: `context ${i}` });
const recap = (i: string): Card => ({ id: uuid(), type: "recap", topicNodeId: "n1", detourId: null, headline: `again ${i}`, beats: ["a", "b", "c"], metaphor: `metaphor ${i}` });

function makePlan(over: Partial<PlanOutput> = {}): PlanOutput {
  return PlanOutputSchema.parse({
    title: "cache stampedes",
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    persona: { traits: ["dry", "fast", "kind"], tics: ["ok so", "here's the thing"], humor: "deadpan", neverDoes: "talks down" },
    outline: [
      { id: N(1), title: "what a cache is", estCards: 4, dependsOn: [], brief: "cache = bet on repetition" },
      { id: N(2), title: "stampedes", estCards: 4, dependsOn: [N(1)] },
      { id: N(3), title: "ttl and invalidation", estCards: 4, dependsOn: [N(1)] },
    ],
    clarifiers: [],
    firstCards: [hook("first"), concept("first-a"), concept("first-b")],
    ...over,
  });
}

type Fake = LlmApi & {
  calls: { fn: string; ctx: unknown }[];
  state: {
    planFail: boolean;
    writeMode: "ok" | "budget" | "fail";
    triage: "inline" | "detour";
    plan: PlanOutput;
    /** open-card grader: "off" degrades (no verdict), otherwise it returns that verdict */
    grade: "off" | "got_it" | "close" | "not_yet";
    storyline: boolean;
    wrap: boolean;
  };
};

function fakeLlm(): Fake {
  let seq = 0;
  const f: Fake = {
    calls: [],
    state: { planFail: false, writeMode: "ok", triage: "inline", plan: makePlan(), grade: "off", storyline: false, wrap: false },
    async plan(input) {
      f.calls.push({ fn: "plan", ctx: input });
      if (f.state.planFail) return apiFail();
      if (input.previousPlan) {
        return okR(makePlan({ title: "cache stampedes (refined)", outline: [{ id: "r1", title: "refined one", estCards: 4, dependsOn: [] }, { id: "r2", title: "refined two", estCards: 4, dependsOn: [] }] }));
      }
      return okR(f.state.plan);
    },
    async writeBatch(ctx: WriteContext) {
      f.calls.push({ fn: "writeBatch", ctx });
      if (f.state.writeMode === "budget") return budgetR();
      if (f.state.writeMode === "fail") return apiFail();
      const i = String(++seq);
      switch (ctx.mode) {
        case "teaser": return okR([hook(`teaser-${i}`), concept(`teaser-${i}`)]);
        case "recap": return okR([recap(i)]);
        case "scaffold": return okR([concept(`scaffold-${i}`)]);
        case "adjacent": return okR([hook(`adjacent-${i}`), concept(`adjacent-${i}`)]);
        case "resurface": return okR([binary(`re-${i}a`), binary(`re-${i}b`), binary(`re-${i}c`), binary(`re-${i}d`)]);
        default: return okR([stat(`${i}a`), binary(`${i}b`), code(`${i}c`), concept(`${i}d`)]);
      }
    },
    async triage(input) {
      f.calls.push({ fn: "triage", ctx: input });
      if (f.state.writeMode === "budget") return budgetR();
      return f.state.triage === "detour" ? okR({ kind: "detour" as const, cardCount: 3, focus: "ttl" }) : okR({ kind: "inline" as const, answer: "short version: yes." });
    },
    async writeDetour(ctx) {
      f.calls.push({ fn: "writeDetour", ctx });
      const i = String(++seq);
      return okR(Array.from({ length: ctx.cardCount }, (_, k) => concept(`detour-${i}-${k}`)));
    },
    async dialToast({ direction }) {
      return direction === "simpler" ? "say less." : "bet.";
    },
    async evaluateOpen(input) {
      f.calls.push({ fn: "evaluateOpen", ctx: input });
      if (f.state.grade === "off") return { ok: false as const, code: "api" as const, error: "n/a" };
      return okR({
        verdict: f.state.grade,
        feedback: `you said "${input.answer.slice(0, 20)}" — nice.`,
        missed: f.state.grade === "got_it" ? [] : ["eviction"],
      });
    },
    async updateStoryline(input) {
      f.calls.push({ fn: "updateStoryline", ctx: input });
      if (!f.state.storyline) return { ok: false as const, code: "api" as const, error: "n/a" };
      return okR({ spine: "a sharpened spine", covered: ["what a cache is"], next: "stampedes", updatedAtIdx: null });
    },
    async writeWrap(ctx) {
      f.calls.push({ fn: "writeWrap", ctx });
      if (!f.state.wrap) return { ok: false as const, code: "api" as const, error: "n/a" };
      return okR({
        id: uuid(), type: "wrap" as const, topicNodeId: "system", detourId: null,
        headline: "that's the thread.", beats: ["one", "two", "three"], openThread: "ttl math",
      });
    },
  };
  return f;
}

// ── harness ─────────────────────────────────────────────────────────────────
let dir: string;
let store: Store;
let llm: Fake;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drip-engine-"));
  store = createLocalStore({ dir });
});
beforeEach(() => {
  llm = fakeLlm();
  setEngineDepsForTests({ llm, store });
});
afterAll(() => {
  setEngineDepsForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

async function planned(input = "how a cache keeps a site alive", extra: Parameters<typeof createSession>[0] extends infer B ? Partial<B> : never = {}) {
  const s = await createSession({ input, sourceKind: "sentence", sourceMeta: {}, settings: {}, ...extra });
  await startPlanning(s.id);
  return (await store.getSession(s.id))!;
}
const idxs = async (sessionId: string) => (await store.listAllCards(sessionId)).map((c) => c.idx);
const isSorted = (xs: string[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);
const markViewed = async (ids: string[]) => { for (const id of ids) await store.updateCard(id, { viewedAt: new Date().toISOString() }); };

// ── planning ────────────────────────────────────────────────────────────────
describe("planning", () => {
  it("create → plan → first cards, status active, title from the plan when auto", async () => {
    const s = await planned();
    expect(s.status).toBe("active");
    expect(s.title).toBe("cache stampedes");
    expect(s.theme?.name).toBe("terminal noir");
    expect(s.persona?.traits).toHaveLength(3);
    expect(s.outline).toHaveLength(3);
    expect(s.sourceMeta.planningStartedAt).toBeUndefined();
    const cards = await store.listAllCards(s.id);
    expect(cards.map((c) => c.type)).toEqual(["hook", "concept", "concept"]);
    expect(cards.every((c) => c.payload.topicNodeId === "n1" && c.detourId === null)).toBe(true);
    expect(isSorted(cards.map((c) => c.idx))).toBe(true);
    expect(s.progress).toMatchObject({ nodeIdx: 0, cardsInNode: 3, totalGenerated: 3, exhausted: false, lastIdx: cards[2].idx });
    for (const c of cards) expect(CardSchema.safeParse(c.payload).success).toBe(true);
  });

  it("keeps a user-provided title", async () => {
    const s = await planned("cache stuff", { title: "my thing" });
    expect(s.title).toBe("my thing");
  });

  it("big corpus: teaser cards land first, then the plan's cards", async () => {
    const big = Array.from({ length: 120 }, (_, i) => `paragraph ${i} about caches and stampedes and ttl values.`).join("\n\n");
    expect(big.length).toBeGreaterThan(4000);
    const s = await planned(big, { sourceKind: "paste" });
    const cards = await store.listAllCards(s.id);
    expect(cards.map((c) => c.payload.topicNodeId)).toEqual(["teaser", "teaser", "n1", "n1", "n1"]);
    expect(llm.calls.filter((c) => c.fn === "writeBatch" && (c.ctx as WriteContext).mode === "teaser")).toHaveLength(1);
    expect(s.progress.totalGenerated).toBe(5);
    expect(s.progress.cardsInNode).toBe(3);
  });

  it("clarifiers become clarify cards before the first cards", async () => {
    llm.state.plan = makePlan({ clarifiers: [{ key: "audience", prompt: "who's this for?", options: ["me", "a friend"] }] });
    const s = await planned();
    const cards = await store.listAllCards(s.id);
    expect(cards.map((c) => c.type)).toEqual(["clarify", "hook", "concept", "concept"]);
    expect(cards[0].payload.topicNodeId).toBe("clarify");
  });

  it("plan failure → status error with a message; retry → planning → success", async () => {
    llm.state.planFail = true;
    const s = await planned();
    expect(s.status).toBe("error");
    expect(s.error).toMatch(/api/);
    llm.state.planFail = false;
    const r = await retrySession(s.id);
    expect(r.action).toBe("replan");
    expect(r.session.status).toBe("planning");
    await startPlanning(s.id);
    expect((await store.getSession(s.id))!.status).toBe("active");
  });

  it("watchdog flips a stuck planning session to a retryable error", async () => {
    const s = await createSession({ input: "x", sourceKind: "sentence", sourceMeta: {}, settings: {} });
    expect((await reapIfStuck(s.id))!.status).toBe("planning");
    const stuck = await reapIfStuck(s.id, Date.now() + PLANNING_TIMEOUT_MS + 1000);
    expect(stuck!.status).toBe("error");
    expect(stuck!.error).toBeTruthy();
    // generate on an errored session is a no-op failed pseudo batch, never a throw
    const g = await generateNext(s.id);
    expect(g.batch.status).toBe("failed");
    expect(g.cards).toEqual([]);
  });

  it("generate during planning returns a pending pseudo batch", async () => {
    const s = await createSession({ input: "x", sourceKind: "sentence", sourceMeta: {}, settings: {} });
    const g = await generateNext(s.id);
    expect(g.batch.status).toBe("pending");
    expect(g.cards).toEqual([]);
  });
});

// ── generation ──────────────────────────────────────────────────────────────
describe("generateNext", () => {
  it("is idempotent: 5 concurrent calls → one batch, one LLM call, no duplicate cards", async () => {
    const s = await planned();
    const results = await Promise.all(Array.from({ length: 5 }, () => generateNext(s.id)));
    const ids = new Set(results.map((r) => r.batch.id));
    expect(ids.size).toBe(1);
    for (const r of results) {
      expect(r.batch.status).toBe("done");
      expect(r.cards.map((c) => c.id)).toEqual(results[0].cards.map((c) => c.id));
    }
    expect(results[0].cards).toHaveLength(5); // 4 written + the crossroads that closes the topic
    expect(llm.calls.filter((c) => c.fn === "writeBatch")).toHaveLength(1);
    const all = await store.listAllCards(s.id);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((c) => c.id)).size).toBe(8);
    expect(new Set(all.map((c) => c.idx)).size).toBe(8);
    expect(isSorted(all.map((c) => c.idx))).toBe(true);
    // code cards are highlighted server-side
    const codeCard = all.find((c) => c.type === "code")!;
    expect((codeCard.payload as { highlighted?: unknown[] }).highlighted?.length).toBeGreaterThan(0);
    // frontier key shape
    expect(results[0].batch.frontierKey).toMatch(/^cardbatch:v\d+:[0-9a-f-]+:.+:[0-9a-f]{10}$/);
    for (const c of all) expect(findBannedInValue(c.payload)).toBeNull();
  });

  it("a finished topic ends in a crossroads, generation stops, and 'keep going' moves to the next topic", async () => {
    const s = await planned();
    const g1 = await generateNext(s.id); // node n1: 3 + 4 → complete
    expect(g1.cards.map((c) => c.type)).toEqual(["stat", "binary", "code", "concept", "crossroads"]);
    let cur = (await store.getSession(s.id))!;
    expect(cur.progress).toMatchObject({ nodeIdx: 0, cardsInNode: 7, awaitingChoice: true, totalGenerated: 8 });
    const ctx1 = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx1.mode).toBe("normal");
    expect(ctx1.node?.id).toBe("n1");
    expect(ctx1.extraDirectives.join(" ")).toMatch(/checkpoint/);
    expect(ctx1.recent.length).toBeGreaterThan(0);
    expect(ctx1.batchSize).toBe(4);

    // the crossroads is built here, with no model call, and it names both sides of the boundary
    const fork = g1.cards.at(-1)!.payload as CrossroadsCard;
    expect(fork.finished).toBe("what a cache is");
    expect(fork.upNext).toBe("stampedes");
    expect(fork.choices.map((c) => c.kind)).toEqual(["continue", "deeper", "ask", "wrap"]);
    expect(fork.choices[0].label).toContain("stampedes");
    expect(findBannedInValue(fork)).toBeNull();
    expect(CardSchema.safeParse(fork).success).toBe(true);

    // nothing more is written while the reader is at the fork
    const writes = llm.calls.filter((c) => c.fn === "writeBatch").length;
    const paused = await generateNext(s.id);
    expect(paused.batch.status).toBe("done");
    expect(paused.batch.reason).toBe("awaiting_choice");
    expect(paused.cards).toEqual([]);
    expect(llm.calls.filter((c) => c.fn === "writeBatch").length).toBe(writes);

    // keep going → the flag clears, the node advances, the next stretch lands
    const crossroadsRow = g1.cards.at(-1)!;
    const r = await chooseAtCrossroads(s.id, crossroadsRow.id, "continue");
    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.cards.filter((c) => c.type !== "crossroads").every((c) => c.payload.topicNodeId === "n2")).toBe(true);
    cur = (await store.getSession(s.id))!;
    expect(cur.progress.nodeIdx).toBe(1);
    expect(isSorted(await idxs(s.id))).toBe(true);

    // double tap: the second choice is a no-op, no second batch
    const after = (await store.listAllCards(s.id)).length;
    const again = await chooseAtCrossroads(s.id, crossroadsRow.id, "continue");
    expect(again.cards).toEqual([]);
    expect((await store.listAllCards(s.id)).length).toBe(after);
  });

  it("end of the outline drops 'keep going'; 'one more layer' opens the continuation stretch", async () => {
    const s = await planned();
    const viewAll = async () => markViewed((await store.listAllCards(s.id)).map((c) => c.id));
    const lastRow = async () => (await store.listAllCards(s.id)).at(-1)!;

    await generateNext(s.id); // n1 → crossroads
    await viewAll();
    let fork = await lastRow();
    expect(fork.type).toBe("crossroads");
    await chooseAtCrossroads(s.id, fork.id, "continue"); // n2 → crossroads
    await viewAll();
    fork = await lastRow();
    await chooseAtCrossroads(s.id, fork.id, "continue"); // n3 → crossroads (outline done)
    await viewAll();
    fork = await lastRow();
    const end = fork.payload as CrossroadsCard;
    expect(end.upNext).toBeNull();
    expect(end.choices.map((c) => c.kind)).toEqual(["deeper", "ask", "wrap"]);

    // one more layer at the end of the outline → adjacent waters / resurfaced near-misses
    const r = await chooseAtCrossroads(s.id, fork.id, "deeper");
    expect(r.cards.length).toBeGreaterThan(0);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(["adjacent", "resurface"]).toContain(ctx.mode);
    expect(ctx.node).toBeNull();
    expect(ctx.extraDirectives.join(" ")).toMatch(/one more layer/);
    const cur = (await store.getSession(s.id))!;
    expect(cur.progress.exhausted).toBe(true);
    expect(cur.progress.extensions).toBe(1);
    // and the continuation stretch asks again rather than running on
    expect(r.cards.at(-1)!.type).toBe("crossroads");
    expect((await generateNext(s.id)).batch.reason).toBe("awaiting_choice");
  });

  it("'one more layer' mid-outline writes more of the SAME topic, told to go under it", async () => {
    const s = await planned();
    const g1 = await generateNext(s.id);
    const fork = g1.cards.at(-1)!;
    const r = await chooseAtCrossroads(s.id, fork.id, "deeper");
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.node?.id).toBe("n1");
    expect(ctx.batchSize).toBe(3);
    expect(ctx.extraDirectives.join(" ")).toMatch(/one more layer/);
    expect(r.cards.filter((c) => c.type !== "crossroads").every((c) => c.payload.topicNodeId === "n1")).toBe(true);
    const cur = (await store.getSession(s.id))!;
    expect(cur.progress.nodeIdx).toBe(0);
    expect(cur.progress.deeperCards).toBe(0); // the debt was paid by this batch
    expect(cur.progress.awaitingChoice).toBe(true); // …and it ends in another fork
  });

  it("stops generating when the unviewed runway is already deep", async () => {
    llm.state.plan = makePlan({
      outline: [
        { id: N(1), title: "what a cache is", estCards: 4, dependsOn: [] },
        { id: N(2), title: "stampedes", estCards: 8, dependsOn: [] },
      ],
    });
    const s = await planned();
    const g = await generateNext(s.id);                      // n1 closes → crossroads
    const fork = g.cards.at(-1)!;
    await chooseAtCrossroads(s.id, fork.id, "continue");     // n2 (estCards 8) → 4 cards, no boundary yet
    expect((await store.getSession(s.id))!.progress.awaitingChoice).toBe(false);
    // a fast scroller's buffer: plenty of unviewed rows ahead of them
    const seed = (await store.listAllCards(s.id)).at(-1)!;
    await store.insertCards(Array.from({ length: 12 }, (_, i) => ({
      ...seed,
      id: uuid(),
      idx: `${seed.idx}${String.fromCharCode(97 + i)}`,
      payload: { ...seed.payload, id: uuid() },
      viewedAt: null,
      interaction: null,
    })));
    const before = (await store.listAllCards(s.id)).length;
    const blocked = await generateNext(s.id);
    expect(blocked.batch.id).toBe("runway_full");
    expect((await store.listAllCards(s.id)).length).toBe(before);
  });

  it("budget → exactly one notice card, marked done, not repeated", async () => {
    const s = await planned();
    llm.state.writeMode = "budget";
    const g = await generateNext(s.id);
    expect(g.batch.status).toBe("done");
    expect(g.cards).toHaveLength(1);
    expect(g.cards[0].payload.type).toBe("notice");
    expect((g.cards[0].payload as { kind: string }).kind).toBe("budget");
    const calls = llm.calls.filter((c) => c.fn === "writeBatch").length;
    const again = await generateNext(s.id);
    expect(again.cards.map((c) => c.id)).toEqual(g.cards.map((c) => c.id));
    expect(llm.calls.filter((c) => c.fn === "writeBatch").length).toBe(calls);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "notice")).toHaveLength(1);
    // still valid, still on-voice
    expect(CardSchema.safeParse(g.cards[0].payload).success).toBe(true);
    expect(findBannedInValue(g.cards[0].payload)).toBeNull();
  });

  it("failure → single fallback card, batch failed; retry drops it and regenerates", async () => {
    const s = await planned();
    llm.state.writeMode = "fail";
    const g = await generateNext(s.id);
    expect(g.batch.status).toBe("failed");
    expect(g.cards).toHaveLength(1);
    expect(g.cards[0].payload.type).toBe("fallback");
    expect((g.cards[0].payload as { retryKey?: string }).retryKey).toBe(g.batch.frontierKey);
    // a second generate does not stack fallbacks nor call the model
    const calls = llm.calls.length;
    const again = await generateNext(s.id);
    expect(again.cards[0].id).toBe(g.cards[0].id);
    expect(llm.calls.length).toBe(calls);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "fallback")).toHaveLength(1);
    // retry: fallback removed, then a fresh generate succeeds
    llm.state.writeMode = "ok";
    const r = await retrySession(s.id);
    expect(r.action).toBe("regenerate");
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "fallback")).toHaveLength(0);
    const g2 = await generateNext(s.id);
    expect(g2.batch.status).toBe("done");
    expect(g2.cards).toHaveLength(5);
    expect((await store.listAllCards(s.id))).toHaveLength(8);
  });

  it("recapDue / scaffoldNext prepend one recap / scaffold card and clear the directives", async () => {
    const s = await planned();
    await store.updateSession(s.id, {
      learnerState: { ...s.learnerState, directives: { ...s.learnerState.directives, recapDue: "ttl", scaffoldNext: ["ttl"] } },
    });
    const g = await generateNext(s.id);
    // the recap belongs to interact() — one trigger, one recap, whoever else is generating (spec §8)
    expect(g.cards.map((c) => c.type)).toEqual(["concept", "stat", "binary", "code", "concept", "crossroads"]);
    const modes = llm.calls.filter((c) => c.fn === "writeBatch").map((c) => (c.ctx as WriteContext).mode);
    expect(modes).toEqual(["scaffold", "normal"]);
    const cur = (await store.getSession(s.id))!;
    expect(cur.learnerState.directives.scaffoldNext).toEqual([]);
    expect(cur.progress.cardsInNode).toBe(7); // 3 + 4 main cards ≥ 4 → the topic closed (the scaffold doesn't count)
    expect(cur.progress.nodeIdx).toBe(0);     // …and the CHOICE advances the node, not the writer
    expect(cur.progress.awaitingChoice).toBe(true);
  });

  it("chill mode removes interactive types from allowedTypes", async () => {
    const s = await planned("cache", { settings: { chillMode: true } });
    await generateNext(s.id);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.allowedTypes).not.toContain("binary");
    expect(ctx.allowedTypes).not.toContain("open");
    expect(ctx.allowedTypes).toContain("stat");
    // …and the variety governor took `concept` off the table: the opening was already two of them
    expect(ctx.allowedTypes).not.toContain("concept");
  });
});

// ── dial ────────────────────────────────────────────────────────────────────
describe("dial", () => {
  it("drops only unviewed cards after the current one and moves globalLevel", async () => {
    const s = await planned();
    await generateNext(s.id);
    const all = await store.listAllCards(s.id);
    await markViewed(all.slice(0, 4).map((c) => c.id));
    const current = all[3];
    const r = await dial(s.id, "simpler", current.id);
    expect(r.toast).toBe("say less.");
    expect(r.removedAfter).toBe(current.idx);
    expect(r.session.learnerState.globalLevel).toBe(2);
    expect(r.session.learnerState.prefs.simplerTaps).toBe(1);
    const left = await store.listAllCards(s.id);
    expect(left.map((c) => c.id)).toEqual(all.slice(0, 4).map((c) => c.id));
    expect(r.session.progress.totalGenerated).toBe(4);
    expect(r.session.progress.lastIdx).toBe(current.idx);
    // the next generate uses a new frontier (idx + state hash changed) → fresh batch
    const g = await generateNext(s.id);
    expect(g.batch.status).toBe("done");
    expect(g.cards).toHaveLength(5); // 4 written + the crossroads that closes n2
    expect(isSorted(await idxs(s.id))).toBe(true);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.learnerState.globalLevel).toBe(2);
    expect(ctx.extraDirectives.join(" ")).toMatch(/simpler/);
  });

  it("deeper caps at 5 and unknown cards 404", async () => {
    const s = await planned();
    const [c] = await store.listAllCards(s.id);
    for (let i = 0; i < 3; i++) await dial(s.id, "deeper", c.id);
    expect((await store.getSession(s.id))!.learnerState.globalLevel).toBe(5);
    await expect(dial(s.id, "deeper", uuid())).rejects.toMatchObject({ status: 404 });
  });
});

// ── ask ─────────────────────────────────────────────────────────────────────
describe("ask", () => {
  it("inline answers pass straight through; failures degrade to a canned line", async () => {
    const s = await planned();
    const [c] = await store.listAllCards(s.id);
    const r = await ask(s.id, "is it always in RAM?", c.id);
    expect(r).toEqual({ kind: "inline", answer: "short version: yes." });
    llm.state.writeMode = "budget";
    const b = await ask(s.id, "hm?", c.id);
    expect(b.kind).toBe("inline");
    expect(findBannedInValue(b)).toBeNull();
  });

  it("detour splices open + cards + close between the current and next card; nested detours order correctly", async () => {
    const s = await planned();
    await generateNext(s.id);
    const all = await store.listAllCards(s.id);
    const current = all[1];
    const next = all[2];
    llm.state.triage = "detour";
    const r = await ask(s.id, "wait what is a ttl?", current.id);
    expect(r.kind).toBe("detour");
    if (r.kind !== "detour") return;
    expect(r.detour.parentDetourId).toBeNull();
    expect(r.detour.insertedAfterIdx).toBe(current.idx);
    expect(r.cards.map((c) => c.type)).toEqual(["detour_marker", "concept", "concept", "concept", "detour_marker"]);
    expect(r.cards.every((c) => c.detourId === r.detour.id && c.payload.detourId === r.detour.id)).toBe(true);
    for (const c of r.cards) {
      expect(c.idx > current.idx).toBe(true);
      expect(c.idx < next.idx).toBe(true);
    }
    const open = r.cards[0].payload as { kind: string; question?: string; label: string };
    expect(open.kind).toBe("open");
    expect(open.question).toBe("wait what is a ttl?");
    const after = await store.listAllCards(s.id);
    expect(after).toHaveLength(all.length + 5);
    expect(isSorted(after.map((c) => c.idx))).toBe(true);
    // in feed order: current, open, 3 cards, close, next
    const pos = after.findIndex((c) => c.id === current.id);
    expect(after.slice(pos, pos + 7).map((c) => c.id)).toEqual([current.id, ...r.cards.map((c) => c.id), next.id]);
    // learner state: reinforce
    const cur = (await store.getSession(s.id))!;
    expect(cur.learnerState.directives.reinforce).toEqual(["ttl"]);
    const dctx = llm.calls.find((c) => c.fn === "writeDetour")!.ctx as { detourId: string; cardCount: number; focus: string };
    expect(dctx.cardCount).toBe(3);
    expect(dctx.detourId).toBe(r.detour.id);

    // nested: ask from the 2nd detour card
    const inner = r.cards[2];
    const innerNext = r.cards[3];
    const r2 = await ask(s.id, "and inside that?", inner.id);
    expect(r2.kind).toBe("detour");
    if (r2.kind !== "detour") return;
    expect(r2.detour.parentDetourId).toBe(r.detour.id);
    for (const c of r2.cards) {
      expect(c.idx > inner.idx).toBe(true);
      expect(c.idx < innerNext.idx).toBe(true);
    }
    const final = await store.listAllCards(s.id);
    expect(isSorted(final.map((c) => c.idx))).toBe(true);
    const p = final.findIndex((c) => c.id === inner.id);
    expect(final.slice(p, p + 7).map((c) => c.id)).toEqual([inner.id, ...r2.cards.map((c) => c.id), innerNext.id]);
    expect((await store.listDetours(s.id)).map((d) => d.parentDetourId)).toEqual([null, r.detour.id]);
  });

  it("detour at the very end of the feed appends after the last card", async () => {
    const s = await planned();
    const all = await store.listAllCards(s.id);
    llm.state.triage = "detour";
    const r = await ask(s.id, "more?", all[all.length - 1].id);
    if (r.kind !== "detour") throw new Error("expected detour");
    const after = await store.listAllCards(s.id);
    expect(after.slice(-5).map((c) => c.id)).toEqual(r.cards.map((c) => c.id));
    // and generation continues after the detour close marker
    const g = await generateNext(s.id);
    const later = await store.listAllCards(s.id);
    expect(later.slice(-g.cards.length).map((c) => c.id)).toEqual(g.cards.map((c) => c.id));
    expect(isSorted(later.map((c) => c.idx))).toBe(true);
  });
});

// ── interact ────────────────────────────────────────────────────────────────
describe("interact", () => {
  it("records view + interaction, clamps dwell to 60s, returns a new learner state", async () => {
    const s = await planned();
    const [c] = await store.listAllCards(s.id);
    const r = await interact(c.id, { viewed: true, dwellMs: 59_000 });
    expect(r.card.viewedAt).toBeTruthy();
    expect(r.card.interaction?.dwellMs).toBe(59_000);
    expect(r.learnerState.rolling.dwellMs).toEqual([59_000]);
    expect(r.learnerState).not.toBe(s.learnerState);
    // engine clamps even if a caller bypasses the route schema
    // a revisit of the same card accumulates onto the row (hard-capped at 60s) without adding a second
    // pacing sample — locking the phone twice on one card must not read as two slow cards (spec §8)
    const r2 = await interact(c.id, { dwellMs: 90_000 });
    expect(r2.card.interaction?.dwellMs).toBe(60_000);
    expect(r2.learnerState.rolling.dwellMs).toEqual([59_000]);
  });

  it("two misses on one concept → one recap card inserted right after the current card", async () => {
    const s = await planned();
    await generateNext(s.id);
    const all = await store.listAllCards(s.id);
    const bet = all.find((c) => c.type === "binary")!;
    const pos = all.findIndex((c) => c.id === bet.id);
    const r1 = await interact(bet.id, { choice: 0, correct: false });
    expect(r1.inserted).toEqual([]);
    expect(r1.learnerState.perNode[bet.payload.topicNodeId].consecutiveMisses).toBe(1);
    // second miss on the same concept: the reducer counts a fresh answer only once per card, so use a fresh scored card
    const bet2 = { ...bet, id: uuid(), idx: bet.idx + "V", payload: { ...bet.payload, id: uuid() }, viewedAt: null, interaction: null };
    await store.insertCards([bet2]);
    const r2 = await interact(bet2.id, { choice: 0, correct: false });
    expect(r2.inserted).toHaveLength(1);
    expect(r2.inserted[0].type).toBe("recap");
    expect(r2.learnerState.directives.recapDue).toBeNull();
    const after = await store.listAllCards(s.id);
    const p2 = after.findIndex((c) => c.id === bet2.id);
    expect(after[p2 + 1].id).toBe(r2.inserted[0].id);
    expect(isSorted(after.map((c) => c.idx))).toBe(true);
    expect(pos).toBeGreaterThanOrEqual(0);
    // an unviewed recap already in the runway → no second one
    const bet3 = { ...bet, id: uuid(), idx: bet.idx + "Z", payload: { ...bet.payload, id: uuid() }, viewedAt: null, interaction: null };
    await store.insertCards([bet3]);
    // consecutive misses reset requires a fresh streak: two more misses
    await interact(bet3.id, { choice: 0, correct: false });
    const calls = llm.calls.filter((c) => c.fn === "writeBatch").length;
    const bet4 = { ...bet, id: uuid(), idx: bet.idx + "A", payload: { ...bet.payload, id: uuid() }, viewedAt: null, interaction: null };
    await store.insertCards([bet4]);
    const r4 = await interact(bet4.id, { choice: 0, correct: false });
    expect(r4.inserted).toEqual([]);
    expect(llm.calls.filter((c) => c.fn === "writeBatch").length).toBe(calls);
  });

  it("system cards do not touch learner state; tapping a clarify card records the answer", async () => {
    llm.state.plan = makePlan({ clarifiers: [{ key: "audience", prompt: "who's this for?", options: ["me", "a friend"] }] });
    const s = await planned();
    const [clar] = await store.listAllCards(s.id);
    const r = await interact(clar.id, { choice: 1, dwellMs: 40_000 });
    expect(r.card.interaction?.choice).toBe(1);
    expect(r.learnerState).toEqual(s.learnerState);
    expect(r.replanReady).toBe(true);
    expect((await store.getSession(s.id))!.clarifierAnswers).toEqual({ audience: "a friend" });
    await expect(interact(uuid(), {})).rejects.toMatchObject({ status: 404 });
  });
});

// ── clarifiers → replan, remix ──────────────────────────────────────────────
describe("clarifiers + remix", () => {
  it("answering every clarifier triggers a replan that swaps the outline and regenerates the unviewed runway", async () => {
    llm.state.plan = makePlan({ clarifiers: [{ key: "audience", prompt: "who's this for?", options: ["me", "a friend"] }, { key: "angle", prompt: "which angle?", options: ["ops", "theory"] }] });
    const s = await planned();
    const all = await store.listAllCards(s.id);
    await markViewed([all[0].id, all[1].id, all[2].id]); // both clarify cards + the hook viewed
    const a1 = await answerClarifiers(s.id, { audience: "me" });
    expect(a1.ready).toBe(false);
    const a2 = await answerClarifiers(s.id, { angle: "ops" });
    expect(a2.ready).toBe(true);
    expect(a2.session.clarifierAnswers).toEqual({ audience: "me", angle: "ops" });
    const after = await replan(s.id);
    expect(after!.outline.map((n) => n.id)).toEqual(["r1", "r2"]);
    expect(after!.title).toBe("cache stampedes"); // title + theme are kept mid-session (no flicker)
    expect(after!.theme?.name).toBe("terminal noir");
    expect(after!.sourceMeta.replannedAt).toBeTruthy();
    const cards = await store.listAllCards(s.id);
    // viewed clarify + hook stay; unviewed concept cards were replaced by the new first cards
    expect(cards.slice(0, 3).map((c) => c.id)).toEqual([all[0].id, all[1].id, all[2].id]);
    expect(cards.slice(3).map((c) => c.payload.topicNodeId)).toEqual(["r1", "r1", "r1"]);
    expect(after!.progress).toMatchObject({ nodeIdx: 0, cardsInNode: 3, exhausted: false });
    // planner got the answers + previous plan
    const planCall = llm.calls.filter((c) => c.fn === "plan").at(-1)!.ctx as { clarifierAnswers?: Record<string, string>; previousPlan?: PlanOutput };
    expect(planCall.clarifierAnswers).toEqual({ audience: "me", angle: "ops" });
    expect(planCall.previousPlan?.outline.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    // a second answer round doesn't replan again
    expect((await answerClarifiers(s.id, { audience: "me" })).ready).toBe(false);
  });

  it("remix creates a fresh planning session with the same source and merged settings", async () => {
    const s = await planned("cache", { settings: { depthPreset: "skim" } });
    const r = await remixSession(s.id, { chillMode: true });
    expect(r.id).not.toBe(s.id);
    expect(r.status).toBe("planning");
    expect(r.sourceText).toBe("cache");
    expect(r.settings).toMatchObject({ chillMode: true, depthPreset: "skim" });
    expect(r.learnerState.prefs.chillMode).toBe(true);
    expect(r.sourceMeta.remixOf).toBe(s.id);
  });
});
