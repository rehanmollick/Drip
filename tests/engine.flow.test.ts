import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createLocalStore } from "@/lib/db/local";
import type { Store } from "@/lib/db/store";
import type { LlmApi, LlmResult, WriteContext } from "@/lib/llm-types";
import type { Card, CrossroadsCard, WrapCard } from "@/lib/schemas/cards";
import { CardSchema } from "@/lib/schemas/cards";
import type { PlanOutput } from "@/lib/schemas/plan";
import { PlanOutputSchema } from "@/lib/schemas/plan";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { uuid } from "@/lib/id";
import { findBannedInValue } from "@/lib/copy/banned";
import { keyBetween } from "@/lib/detour/splice";
import {
  ask, chooseAtCrossroads, createSession, generateNext, interact, listCardsPage, setEngineDepsForTests,
  settleBackgroundForTests, startPlanning,
} from "@/lib/generation/engine";

/**
 * The v2 generation loop: it asks at every topic boundary, remembers the story,
 * grades what the reader typed, and refuses to serve four paragraphs in a row.
 */

// ── fake LLM ────────────────────────────────────────────────────────────────
const okR = <T>(value: T): LlmResult<T> => ({ ok: true, value, meta: { model: "fake", promptVersion: "t", latencyMs: 1, inTokens: 1, outTokens: 1, attempts: 1 } });
const fail = <T>(): LlmResult<T> => ({ ok: false, code: "api", error: "boom" });

const concept = (i: string): Card => ({ id: uuid(), type: "concept", topicNodeId: "n1", detourId: null, headline: `concept ${i}`, body: `body ${i}` });
const hook = (i: string): Card => ({ id: uuid(), type: "hook", topicNodeId: "n1", detourId: null, headline: `hook ${i}` });
const stat = (i: string): Card => ({ id: uuid(), type: "stat", topicNodeId: "n1", detourId: null, value: "80%", label: `hit rate ${i}`, context: `ctx ${i}` });
const code = (i: string): Card => ({ id: uuid(), type: "code", topicNodeId: "n1", detourId: null, lang: "ts", code: `const a${i} = 1;`, annotations: [] });
const openCard = (i: string): Card => ({
  id: uuid(), type: "open", topicNodeId: "n1", detourId: null,
  prompt: `say ${i} back in your own words`, rubric: "repetition + eviction",
  modelAnswer: "a cache is a bet that you'll want the same answer again.", difficulty: 2,
});

function makePlan(over: Partial<PlanOutput> = {}): PlanOutput {
  return PlanOutputSchema.parse({
    title: "cache stampedes",
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    persona: { traits: ["dry", "fast", "kind"], tics: ["ok so", "here's the thing"], humor: "deadpan", neverDoes: "talks down" },
    outline: [
      { id: "n1", title: "what a cache is", estCards: 4, dependsOn: [], brief: "cache = bet on repetition" },
      { id: "n2", title: "stampedes", estCards: 4, dependsOn: ["n1"] },
    ],
    clarifiers: [],
    firstCards: [hook("first"), concept("a"), concept("b")],
    ...over,
  });
}

type Fake = LlmApi & {
  calls: { fn: string; ctx: unknown }[];
  state: {
    /** "varied" = what the prompts ask for; "prose" = the writer the reader complained about */
    shape: "varied" | "prose";
    triage: "inline" | "detour";
    grade: "off" | "got_it" | "close" | "not_yet";
    storyline: boolean;
    wrap: boolean;
  };
};

function fakeLlm(): Fake {
  let seq = 0;
  const f: Fake = {
    calls: [],
    state: { shape: "varied", triage: "inline", grade: "off", storyline: false, wrap: false },
    async plan(input) {
      f.calls.push({ fn: "plan", ctx: input });
      return okR(makePlan());
    },
    async writeBatch(ctx: WriteContext) {
      f.calls.push({ fn: "writeBatch", ctx });
      const i = String(++seq);
      if (ctx.mode === "adjacent") return okR([hook(`adj-${i}`), stat(`adj-${i}`)]);
      if (ctx.mode === "resurface") return okR([stat(`re-${i}`), code(`re-${i}`), openCard(`re-${i}`), hook(`re-${i}`)]);
      if (ctx.mode === "scaffold" || ctx.mode === "recap") return okR([concept(`${ctx.mode}-${i}`)]);
      return f.state.shape === "prose"
        ? okR([concept(`${i}a`), concept(`${i}b`), concept(`${i}c`), concept(`${i}d`)])
        : okR([stat(`${i}a`), openCard(`${i}b`), code(`${i}c`), concept(`${i}d`)]);
    },
    async triage(input) {
      f.calls.push({ fn: "triage", ctx: input });
      return f.state.triage === "detour"
        ? okR({ kind: "detour" as const, cardCount: 2, focus: "ttl" })
        : okR({ kind: "inline" as const, answer: "short version: yes." });
    },
    async writeDetour(ctx) {
      f.calls.push({ fn: "writeDetour", ctx });
      // stat first: the detour is governed against the splice point's history, which often ends in prose
      return okR(Array.from({ length: ctx.cardCount }, (_, k) => (k % 2 ? concept(`d${k}`) : stat(`d${k}`))));
    },
    async dialToast() { return "bet."; },
    async evaluateOpen(input) {
      f.calls.push({ fn: "evaluateOpen", ctx: input });
      if (f.state.grade === "off") return fail();
      return okR({
        verdict: f.state.grade,
        feedback: `you said "${input.answer.slice(0, 24)}" — and that's the shape of it.`,
        missed: f.state.grade === "got_it" ? [] : ["eviction"],
      });
    },
    async updateStoryline(input) {
      f.calls.push({ fn: "updateStoryline", ctx: input });
      if (!f.state.storyline) return fail();
      return okR({ spine: "a sharpened spine", covered: ["caches, sharpened"], next: "stampedes", updatedAtIdx: null });
    },
    async writeWrap(ctx) {
      f.calls.push({ fn: "writeWrap", ctx });
      if (!f.state.wrap) return fail();
      return okR({
        id: uuid(), type: "wrap" as const, topicNodeId: "system", detourId: null,
        headline: "that's the whole thread.", beats: ["caches bet on repetition", "stampedes are the cost", "ttl is the dial"],
        openThread: "what breaks at 10x traffic",
      } as Card);
    },
  };
  return f;
}

// ── harness ─────────────────────────────────────────────────────────────────
let dir: string;
let store: Store;
let llm: Fake;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drip-flow-"));
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

async function planned() {
  const s = await createSession({ input: "how a cache keeps a site alive", sourceKind: "sentence", sourceMeta: {}, settings: {} });
  await startPlanning(s.id);
  return (await store.getSession(s.id))!;
}
/** Generate until the first crossroads and return its row. */
async function toFirstFork(sessionId: string) {
  const g = await generateNext(sessionId);
  const fork = g.cards.at(-1)!;
  expect(fork.type).toBe("crossroads");
  return fork;
}
const writes = () => llm.calls.filter((c) => c.fn === "writeBatch").length;

// ── the boundary ────────────────────────────────────────────────────────────
describe("crossroads", () => {
  it("costs no model call and is the last row of the batch that closed the topic", async () => {
    const s = await planned();
    const before = writes();
    const g = await generateNext(s.id);
    expect(writes()).toBe(before + 1); // one write for the batch; the fork is built locally
    expect(g.cards.at(-1)!.type).toBe("crossroads");
    expect(g.cards.filter((c) => c.type === "crossroads")).toHaveLength(1);
    expect(g.cards.at(-1)!.batchId).toBe(g.batch.id); // it lands atomically with its batch
  });

  it("'ask something' clears the pause without writing cards, and the detour still splices in", async () => {
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const before = writes();
    const r = await chooseAtCrossroads(s.id, fork.id, "ask");
    expect(r.cards).toEqual([]);
    expect(writes()).toBe(before);
    expect(r.session.progress.awaitingChoice).toBe(false);
    expect(r.session.progress.nodeIdx).toBe(1); // asking is also a step forward

    llm.state.triage = "detour";
    const asked = await ask(s.id, "wait, what is a ttl?", fork.id);
    expect(asked.kind).toBe("detour");
    const all = await store.listAllCards(s.id);
    const at = all.findIndex((c) => c.id === fork.id);
    expect(all[at + 1].type).toBe("detour_marker");
    expect(all.every((c, i) => i === 0 || all[i - 1].idx < c.idx)).toBe(true);
  });

  it("a choice on a card that has none, or a direction the card doesn't offer, is a 400", async () => {
    const s = await planned();
    const [first] = await store.listAllCards(s.id);
    await expect(chooseAtCrossroads(s.id, first.id, "continue")).rejects.toMatchObject({ status: 400 });
    await expect(chooseAtCrossroads(s.id, uuid(), "continue")).rejects.toMatchObject({ status: 404 });
    // end of the outline: "keep going" isn't on the card, so it can't be chosen
    const fork = await toFirstFork(s.id);
    await chooseAtCrossroads(s.id, fork.id, "continue");
    const last = (await store.listAllCards(s.id)).at(-1)!;
    expect((last.payload as CrossroadsCard).upNext).toBeNull();
    await expect(chooseAtCrossroads(s.id, last.id, "continue")).rejects.toMatchObject({ status: 400 });
  });

  it("the fork survives a dropped runway: the pause clears when its card is gone", async () => {
    const s = await planned();
    const fork = await toFirstFork(s.id);
    expect((await store.getSession(s.id))!.progress.awaitingChoice).toBe(true);
    // everything unviewed after the plan's opening goes (what a dial does)
    const opening = (await store.listAllCards(s.id))[2];
    await store.deleteUnviewedAfter(s.id, opening.idx);
    expect(await store.getCard(fork.id)).toBeNull();
    const g = await generateNext(s.id);
    expect(g.batch.reason).not.toBe("awaiting_choice");
    expect(g.cards.length).toBeGreaterThan(0);
  });
});

// ── the ending ──────────────────────────────────────────────────────────────
describe("wrap", () => {
  it("writes the model's wrap, archives the thread, and stops generating — still scrollable", async () => {
    llm.state.wrap = true;
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const r = await chooseAtCrossroads(s.id, fork.id, "wrap");
    expect(r.cards).toHaveLength(1);
    const wrap = r.cards[0].payload as WrapCard;
    expect(wrap.type).toBe("wrap");
    expect(wrap.headline).toBe("that's the whole thread.");
    expect(CardSchema.safeParse(wrap).success).toBe(true);
    expect(findBannedInValue(wrap)).toBeNull();
    expect(r.session.status).toBe("archived");

    // nothing more is written…
    const before = writes();
    const g = await generateNext(s.id);
    expect(g.batch.reason).toBe("wrapped");
    expect(g.cards).toEqual([]);
    expect(writes()).toBe(before);
    // …and every card is still there to scroll
    const page = await listCardsPage(s.id, null, 50);
    expect(page.cards.at(-1)!.type).toBe("wrap");
    expect(page.cards.length).toBeGreaterThan(5);
  });

  it("degrades to a wrap built from the through-line when the model can't write one", async () => {
    llm.state.wrap = false;
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const r = await chooseAtCrossroads(s.id, fork.id, "wrap");
    const wrap = r.cards[0].payload as WrapCard;
    expect(wrap.type).toBe("wrap");
    expect(wrap.beats.length).toBeGreaterThanOrEqual(3);
    expect(wrap.beats[0]).toBe("what a cache is"); // the topic that actually landed
    expect(wrap.openThread).toContain("stampedes");
    expect(CardSchema.safeParse(wrap).success).toBe(true);
    expect(findBannedInValue(wrap)).toBeNull();
  });

  it("double-tapping wrap writes exactly one ending", async () => {
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const [a, b] = await Promise.all([
      chooseAtCrossroads(s.id, fork.id, "wrap"),
      chooseAtCrossroads(s.id, fork.id, "wrap"),
    ]);
    expect(a.cards.length + b.cards.length).toBe(1);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "wrap")).toHaveLength(1);
  });

  // ── the wrap race (field report: "click wrap up and it keeps generating") ──

  /** Poll until `cond` holds — the wrap race needs a foothold inside the claim→insert window. */
  async function until(cond: () => Promise<boolean>, ms = 2000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!(await cond())) {
      if (Date.now() > deadline) throw new Error("condition never held");
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Hold the model mid-writeWrap: the choice is claimed, the wrap row is not yet inserted. */
  function holdWrap() {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const realWrap = llm.writeWrap.bind(llm);
    llm.writeWrap = async (ctx) => { await held; return realWrap(ctx); };
    return release;
  }

  it("a generate racing between the wrap claim and its insert writes nothing — the gate survives", async () => {
    llm.state.wrap = true;
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const release = holdWrap();
    const choosing = chooseAtCrossroads(s.id, fork.id, "wrap");
    await until(async () => (await store.getSession(s.id))!.status === "archived");
    const before = writes();
    const g = await generateNext(s.id);
    expect(g.batch.reason).toBe("wrapped");
    expect(g.cards).toEqual([]);
    expect(writes()).toBe(before); // nothing was generated mid-wrap
    const mid = await store.listAllCards(s.id);
    expect(mid.some((c) => c.type === "wrap")).toBe(false); // and the heal didn't preempt the real ending
    expect(mid.filter((c) => c.type === "crossroads")).toHaveLength(1); // no second fork, ever
    release();
    const r = await choosing;
    expect(r.cards).toHaveLength(1);
    const wraps = (await store.listAllCards(s.id)).filter((c) => c.type === "wrap");
    expect(wraps).toHaveLength(1);
    expect((wraps[0].payload as WrapCard).headline).toBe("that's the whole thread."); // the model's wrap landed, not the heal's
  });

  it("archived is the halt, not row order: a batch landing after the wrap changes nothing", async () => {
    llm.state.wrap = true;
    const s = await planned();
    const fork = await toFirstFork(s.id);
    await chooseAtCrossroads(s.id, fork.id, "wrap");
    // a batch that raced in AFTER the ending landed: the last row is no longer the wrap
    const all = await store.listAllCards(s.id);
    const late: Card = { id: uuid(), type: "concept", topicNodeId: "n2", detourId: null, headline: "late", body: "landed after the wrap" };
    await store.insertCards([{
      id: late.id, sessionId: s.id, idx: keyBetween(all.at(-1)!.idx, null), type: "concept",
      payload: late, detourId: null, batchId: null, viewedAt: null, interaction: null, createdAt: new Date().toISOString(),
    }]);
    const before = writes();
    const g = await generateNext(s.id);
    expect(g.batch.reason).toBe("wrapped");
    expect(g.cards).toEqual([]);
    expect(writes()).toBe(before);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "wrap")).toHaveLength(1);
  });

  it("wrap-after-wrap is impossible: the doom loop's second crossroads never gets written", async () => {
    llm.state.wrap = true;
    const s = await planned();
    const fork = await toFirstFork(s.id);
    const release = holdWrap();
    const choosing = chooseAtCrossroads(s.id, fork.id, "wrap");
    await until(async () => (await store.getSession(s.id))!.status === "archived");
    // the client force-pumps right after a choose — the exact trigger from the field report
    await generateNext(s.id);
    await generateNext(s.id);
    release();
    await choosing;
    // one fork, one ending: a second crossroads is what let the reader wrap forever
    const rows = await store.listAllCards(s.id);
    expect(rows.filter((c) => c.type === "crossroads")).toHaveLength(1);
    expect(rows.filter((c) => c.type === "wrap")).toHaveLength(1);
    // and even the original card can't wrap twice
    const again = await chooseAtCrossroads(s.id, fork.id, "wrap");
    expect(again.cards).toEqual([]);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "wrap")).toHaveLength(1);
  });

  it("an archived thread with no ending gets exactly one deterministic wrap healed in", async () => {
    const s = await planned();
    const fork = await toFirstFork(s.id);
    // the process died between the wrap claim and its insert: archived, answered, no wrap row
    const at = new Date().toISOString();
    await store.updateCard(fork.id, { viewedAt: at, interaction: { choice: "wrap", at } });
    await store.updateSession(s.id, { status: "archived" });
    const g = await generateNext(s.id);
    expect(g.batch.reason).toBe("wrapped");
    expect(g.cards).toHaveLength(1);
    const wrap = g.cards[0].payload as WrapCard;
    expect(wrap.type).toBe("wrap");
    expect(wrap.beats.length).toBeGreaterThanOrEqual(3); // the deterministic ending, built from the through-line
    expect(CardSchema.safeParse(wrap).success).toBe(true);
    expect(findBannedInValue(wrap)).toBeNull();
    // healed once: the next generate finds the ending and writes nothing
    const again = await generateNext(s.id);
    expect(again.batch.reason).toBe("wrapped");
    expect(again.cards).toEqual([]);
    expect((await store.listAllCards(s.id)).filter((c) => c.type === "wrap")).toHaveLength(1);
    expect((await store.getSession(s.id))!.status).toBe("archived");
  });
});

// ── the story ───────────────────────────────────────────────────────────────
describe("storyline", () => {
  it("is set from the plan and reaches every write call", async () => {
    const s = await planned();
    // the spine is the planner's ARGUMENT (title + the hook's sharpest edge), not a list of topics —
    // spineFromPlan reads it off the plan; the topic list still lives in covered/next
    expect(s.storyline?.spine).toBe("cache stampedes — hook first");
    expect(s.storyline?.next).toBe("what a cache is");
    await generateNext(s.id);
    const ctxs = llm.calls.filter((c) => c.fn === "writeBatch").map((c) => c.ctx as WriteContext);
    expect(ctxs.length).toBeGreaterThan(0);
    for (const ctx of ctxs) {
      expect(ctx.storyline?.spine).toBeTruthy();
      expect(Array.isArray(ctx.recentTypes)).toBe(true);
    }
    expect(ctxs.at(-1)!.recentTypes).toEqual(["hook", "concept", "concept"]);
  });

  it("advances the moment a topic closes, with or without the model", async () => {
    const s = await planned();
    await generateNext(s.id);
    await settleBackgroundForTests();
    let cur = (await store.getSession(s.id))!;
    expect(cur.storyline?.covered).toEqual(["what a cache is"]); // deterministic, never waits
    expect(cur.storyline?.next).toBe("stampedes");
    expect(cur.storyline?.spine).toBe(s.storyline?.spine); // the refresh failed → previous kept

    llm.state.storyline = true;
    const fork = (await store.listAllCards(s.id)).at(-1)!;
    await chooseAtCrossroads(s.id, fork.id, "continue");
    await settleBackgroundForTests();
    cur = (await store.getSession(s.id))!;
    expect(cur.storyline?.spine).toBe("a sharpened spine");
    const call = llm.calls.filter((c) => c.fn === "updateStoryline").at(-1)!.ctx as { nodeIdx: number; recent: unknown[]; persona?: { tics: string[] } };
    expect(call.nodeIdx).toBe(1);
    expect(call.recent.length).toBeGreaterThan(0);
    // the spine can end up on screen, so it is written in the session's voice, not a neutral one
    expect(call.persona?.tics).toContain("ok so");
  });

  it("hands the writer the whole session's glossary, not just the recent window", async () => {
    const { glossedTerms } = await import("@/lib/generation/summaries");
    const s = await planned();
    await generateNext(s.id);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    // a word explained once is never handed over again forty slides later, so the ledger is the
    // whole deck — undefined here silently drops the writer back to the last-6 window
    const rows = await store.listAllCards(s.id);
    expect(ctx.glossedTerms).toEqual(glossedTerms(rows.map((r) => r.payload)));
    expect(ctx.glossedTerms).not.toBeUndefined();
  });

  it("re-anchors the first batch after a detour closes", async () => {
    const s = await planned();
    llm.state.triage = "detour";
    const last = (await store.listAllCards(s.id)).at(-1)!;
    await ask(s.id, "what is a ttl?", last.id);
    await generateNext(s.id);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.extraDirectives.join(" ")).toMatch(/came back from a detour/);
    expect(ctx.extraDirectives.join(" ")).toMatch(/we were on what a cache is/);
  });
});

// ── answering in your own words ─────────────────────────────────────────────
describe("open cards", () => {
  async function anOpenCard() {
    const s = await planned();
    await generateNext(s.id);
    const row = (await store.listAllCards(s.id)).find((c) => c.type === "open")!;
    return { s, row };
  }

  it("got_it: the answer is graded as a hit and the reply speaks to what they wrote", async () => {
    llm.state.grade = "got_it";
    const { s, row } = await anOpenCard();
    const r = await interact(row.id, { text: "  a cache is a bet on repetition  " });
    expect(r.feedback?.verdict).toBe("got_it");
    expect(r.feedback?.feedback).toContain("a cache is a bet on rep");
    expect(r.card.interaction?.text).toBe("a cache is a bet on repetition"); // trimmed, stored, replayable
    expect(r.card.interaction?.correct).toBe(true);
    expect(r.learnerState.rolling.last10Interactive).toEqual([true]);
    expect(r.learnerState.perNode[row.payload.topicNodeId].hits).toBe(1);
    const grader = llm.calls.filter((c) => c.fn === "evaluateOpen").at(-1)!.ctx as { rubric: string; modelAnswer: string; answer: string };
    expect(grader.rubric).toBe("repetition + eviction");
    expect(grader.answer).toBe("a cache is a bet on repetition");
    void s;
  });

  it("close: still a hit, but what they missed is remembered for the writer", async () => {
    llm.state.grade = "close";
    const { row } = await anOpenCard();
    const r = await interact(row.id, { text: "it stores stuff" });
    expect(r.feedback?.verdict).toBe("close");
    expect(r.card.interaction?.correct).toBe(true);
    expect(r.learnerState.rolling.last10Interactive).toEqual([true]);
    expect(r.learnerState.perNode[row.payload.topicNodeId].lastMissConcepts).toContain("eviction");
  });

  it("not_yet: a miss, recorded like any other", async () => {
    llm.state.grade = "not_yet";
    const { row } = await anOpenCard();
    const r = await interact(row.id, { text: "no idea" });
    expect(r.feedback?.verdict).toBe("not_yet");
    expect(r.card.interaction?.correct).toBe(false);
    expect(r.learnerState.rolling.last10Interactive).toEqual([false]);
    const node = r.learnerState.perNode[row.payload.topicNodeId];
    expect(node.consecutiveMisses).toBe(1);
    expect(node.lastMissConcepts).toContain("eviction");
  });

  it("grader down: keeps what they wrote, shows the answer, and grades nothing", async () => {
    llm.state.grade = "off";
    const { row } = await anOpenCard();
    const r = await interact(row.id, { text: "something about repeats" });
    expect(r.card.interaction?.text).toBe("something about repeats");
    expect(r.feedback?.feedback).toContain("a cache is a bet that you'll want the same answer again.");
    expect(r.feedback?.missed).toEqual([]);
    expect(r.card.interaction?.correct).toBeUndefined(); // never pretend to have judged it
    expect(r.learnerState.rolling.last10Interactive).toEqual([]);
    expect(findBannedInValue(r.feedback)).toBeNull();
  });

  it("the stored reply comes back on a plain re-view (scroll-back replays it)", async () => {
    llm.state.grade = "got_it";
    const { row } = await anOpenCard();
    await interact(row.id, { text: "a cache is a bet on repetition" });
    const again = await interact(row.id, { viewed: true, dwellMs: 1200 });
    expect(again.feedback?.verdict).toBe("got_it");
    expect(again.card.interaction?.text).toBe("a cache is a bet on repetition");
    expect(llm.calls.filter((c) => c.fn === "evaluateOpen")).toHaveLength(1); // no re-grade without new text
  });

  it("a card with no typed answer never reaches the grader", async () => {
    llm.state.grade = "got_it";
    const { s } = await anOpenCard();
    const first = (await store.listAllCards(s.id))[0];
    const r = await interact(first.id, { viewed: true });
    expect(r.feedback).toBeNull();
    expect(llm.calls.filter((c) => c.fn === "evaluateOpen")).toHaveLength(0);
  });
});

// ── the variety governor, end to end ────────────────────────────────────────
describe("variety in the loop", () => {
  it("a writer that returns four paragraphs gets trimmed, and the next batch is told to stop", async () => {
    llm.state.shape = "prose";
    const s = await planned();
    const g = await generateNext(s.id);
    const written = g.cards.filter((c) => c.type !== "crossroads");
    expect(written.length).toBeLessThan(4);
    expect(written.every((c, i) => i === 0 || !(written[i - 1].type === "concept" && c.type === "concept"))).toBe(true);
    // the batch is kept, not thrown away, and it still closes the topic properly
    expect(written.length).toBeGreaterThan(0);
    expect(g.cards.at(-1)!.type).toBe("crossroads");

    // pressure: the next call is told harder, and `concept` is off the table
    const fork = g.cards.at(-1)!;
    await chooseAtCrossroads(s.id, fork.id, "continue");
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.allowedTypes).not.toContain("concept");
    expect(ctx.extraDirectives.join(" ")).toMatch(/dropped for repeating the same shape/);
  });

  it("a varied writer is left alone", async () => {
    llm.state.shape = "varied";
    const s = await planned();
    const g = await generateNext(s.id);
    expect(g.cards.map((c) => c.type)).toEqual(["stat", "open", "code", "concept", "crossroads"]);
    const ctx = llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
    expect(ctx.extraDirectives.join(" ")).not.toMatch(/dropped for repeating/);
  });
});

describe("nothing is ever inserted above the reader", () => {
  it("a recap triggered by a scroll-back reported late lands ahead of the furthest card they've seen", async () => {
    const s = await planned();
    await generateNext(s.id);
    const all = await store.listAllCards(s.id);
    expect(all.length).toBeGreaterThan(4);

    // a card that can trigger a recap (a hook can't), early in the deck
    const early = all.find((c) => c.payload.type === "concept")!;
    expect(early).toBeTruthy();
    // the reader has walked well past it; that scroll-back only reaches the server now (outbox drain)
    for (const c of all.slice(0, 5)) await interact(c.id, { viewed: true, dwellMs: 900 });
    const furthest = all[4].idx;
    const r = await interact(early.id, { scrollBack: true });

    expect(r.inserted.length, "the scroll-back should still produce a recap").toBeGreaterThan(0);
    for (const row of r.inserted) {
      expect(row.idx > furthest, `recap at ${row.idx} landed behind the reader at ${furthest}`).toBe(true);
    }
  });

  it("still lands the recap when the reader has outrun the page the splice looks at", async () => {
    const s = await planned();
    for (let i = 0; i < 2; i++) {
      const g = await generateNext(s.id);
      const fork = g.cards.at(-1);
      if (fork?.type === "crossroads") await chooseAtCrossroads(s.id, fork.id, "continue");
    }
    const all = await store.listAllCards(s.id);

    const early = all.find((c) => c.payload.type === "concept")!;
    // the splice reads one page of rows after the trigger; the reader is past the end of that page
    expect(all.length - all.indexOf(early)).toBeGreaterThan(10);
    for (const c of all) await interact(c.id, { viewed: true, dwellMs: 900 });
    const furthest = all[all.length - 1].idx;

    const r = await interact(early.id, { scrollBack: true });
    expect(r.inserted.length, "the recap must survive, not die on a duplicate idx").toBe(1);
    expect(r.inserted[0].idx > furthest).toBe(true);
    const after = await store.listAllCards(s.id);
    expect(new Set(after.map((c) => c.idx)).size).toBe(after.length);
    expect(after.length).toBe(all.length + 1);
  });
});

describe("crossroads copy survives real planner titles", () => {
  it("never truncates a topic mid-word into the headline", async () => {
    const { crossroadsHeadline, fitsInSentence } = await import("@/lib/generation/crossroads");
    // the shape that broke live: a story-like clause, not a noun phrase
    for (let seed = 0; seed < 5; seed++) {
      const h = crossroadsHeadline("sound is pressure, and pressure can be undone", seed);
      expect(h).not.toMatch(/…/);
      expect(h.toLowerCase()).not.toContain("pressure c.");
      expect(h.length).toBeLessThanOrEqual(80);
      expect(h).toMatch(/\?|\./);
    }
    // short noun phrases still get the warmer, specific line
    expect(crossroadsHeadline("the read path", 0)).toBe("that's the read path. where to?");
    expect(fitsInSentence("the read path")).toBe(true);
    expect(fitsInSentence("sound is pressure, and pressure can be undone")).toBe(false);
    expect(fitsInSentence("why low rumble vanishes but voices survive")).toBe(false);
  });
});
