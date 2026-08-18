import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createLocalStore } from "@/lib/db/local";
import type { Store } from "@/lib/db/store";
import type { LlmApi, LlmResult, WriteContext } from "@/lib/llm-types";
import type { Card, CardType } from "@/lib/schemas/cards";
import type { PlanOutput } from "@/lib/schemas/plan";
import { PlanOutputSchema } from "@/lib/schemas/plan";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { uuid } from "@/lib/id";
import { FIRST_CALLBACK_ORDINAL } from "@/lib/adapt/schedule";
import { dueBlock } from "@/lib/prompts/shared";
import { isContentCard } from "@/lib/generation/summaries";
import { enforceVariety } from "@/lib/generation/variety";
import { orderForLearning } from "@/lib/generation/pedagogy";
import { ask, chooseAtCrossroads, createSession, generateNext, interact, setEngineDepsForTests, startPlanning } from "@/lib/generation/engine";

/**
 * The pedagogy layer, from the engine's side: the callback the reader can't see, the reorder that
 * never costs a card, and the jargon governor that measures and never drops.
 *
 * The thing these tests are really guarding is the frame. `anchorMemories` numbers rows over the
 * FULL sorted list — detours, notices, crossroads and all — so the reader's position has to be
 * counted the same way. Count it over content rows only and the suppressor that stops the feed
 * asking about a card nobody has read yet quietly measures against the wrong ruler.
 */

// ── fake LLM ────────────────────────────────────────────────────────────────
const okR = <T>(value: T): LlmResult<T> => ({ ok: true, value, meta: { model: "fake", promptVersion: "t", latencyMs: 1, inTokens: 1, outTokens: 1, attempts: 1 } });
const failR = <T>(): LlmResult<T> => ({ ok: false, code: "api", error: "n/a" });

/** The domain's whole dictionary, and every word in it used at least twice — see corpusTerms. */
const SOURCE = [
  "tempering is what turns ganache into ganache.",
  "viscosity falls while the emulsion holds, and the bloom on a bad bar is the emulsion breaking.",
  "tempering, viscosity, bloom: the craft is those three and the ganache you pour them into.",
].join(" ");

const hook = (i: string, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(), type: "hook", topicNodeId: nodeId, detourId: null, anchor,
  headline: `viscosity is a lie ${i}`, sub: "the emulsion decides",
});
const stat = (i: string, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(), type: "stat", topicNodeId: nodeId, detourId: null, anchor,
  value: "80%", label: `the ganache holds ${i}`, context: "tempering is the whole trick, and bloom is the tell",
});
const concept = (i: string, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(), type: "concept", topicNodeId: nodeId, detourId: null, anchor,
  headline: `what a cache is ${i}`, body: `body ${i}`,
});
const binary = (i: string, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(), type: "binary", topicNodeId: nodeId, detourId: null, anchor,
  prompt: `hot take ${i}`, options: ["real", "nah"], correctIndex: 1, revealCopy: "nah.", difficulty: 2,
});

const PLAN_ANCHOR = "cache-bet";

function makePlan(estCards = 4, over: Partial<PlanOutput> = {}): PlanOutput {
  return PlanOutputSchema.parse({
    title: "tempering",
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    persona: { traits: ["dry", "fast", "kind"], tics: ["ok so", "here's the thing"], humor: "deadpan", neverDoes: "talks down" },
    outline: [
      { id: "n1", title: "what a cache is", estCards, dependsOn: [] },
      { id: "n2", title: "stampedes", estCards, dependsOn: ["n1"] },
      { id: "n3", title: "ttl", estCards, dependsOn: ["n1"] },
      { id: "n4", title: "invalidation", estCards, dependsOn: ["n1"] },
    ],
    clarifiers: [],
    firstCards: [hook("0", PLAN_ANCHOR), concept("0a", PLAN_ANCHOR), concept("0b", PLAN_ANCHOR)],
    ...over,
  });
}

type Fake = LlmApi & { calls: { fn: string; ctx: unknown }[]; state: { plan: PlanOutput } };

function fakeLlm(): Fake {
  let seq = 0;
  const f: Fake = {
    calls: [],
    state: { plan: makePlan() },
    async plan(input) {
      f.calls.push({ fn: "plan", ctx: input });
      return okR(f.state.plan);
    },
    async writeBatch(ctx: WriteContext) {
      f.calls.push({ fn: "writeBatch", ctx });
      const i = String(++seq);
      const node = ctx.node?.id ?? "n1";
      // every batch is four fresh ideas nobody has met before, in shapes the variety governor likes
      return okR([stat(`${i}a`, `idea-${i}-a`, node), hook(`${i}b`, `idea-${i}-b`, node), stat(`${i}c`, `idea-${i}-c`, node), hook(`${i}d`, `idea-${i}-d`, node)]);
    },
    async triage(input) {
      f.calls.push({ fn: "triage", ctx: input });
      return okR({ kind: "detour" as const, cardCount: 3, focus: "bloom" });
    },
    async writeDetour(ctx) {
      f.calls.push({ fn: "writeDetour", ctx });
      const i = String(++seq);
      return okR(Array.from({ length: ctx.cardCount }, (_, k) => concept(`d${i}-${k}`, `detour-${i}-${k}`)));
    },
    async dialToast() { return "bet."; },
    async evaluateOpen() { return failR(); },
    async updateStoryline() { return failR(); },
    async writeWrap() { return failR(); },
  };
  return f;
}

// ── harness ─────────────────────────────────────────────────────────────────
let dir: string;
let store: Store;
let llm: Fake;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drip-pedagogy-"));
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
  const s = await createSession({ input: SOURCE, sourceKind: "sentence", sourceMeta: {}, settings: {} });
  await startPlanning(s.id);
  return (await store.getSession(s.id))!;
}
const lastWrite = () => llm.calls.filter((c) => c.fn === "writeBatch").at(-1)!.ctx as WriteContext;
/** The reader has read everything on screen. */
async function readEverything(sessionId: string) {
  for (const c of await store.listAllCards(sessionId)) {
    if (!c.viewedAt) await store.updateCard(c.id, { viewedAt: new Date().toISOString() });
  }
}
/** Exactly ONE more batch: through the open crossroads when there is one, straight ahead when there isn't. */
async function advance(sessionId: string) {
  const all = await store.listAllCards(sessionId);
  const fork = [...all].reverse().find((c) => c.payload.type === "crossroads" && c.interaction?.choice === undefined);
  return fork ? (await chooseAtCrossroads(sessionId, fork.id, "continue")).cards : (await generateNext(sessionId)).cards;
}

// ── the callback ────────────────────────────────────────────────────────────
describe("the callback the reader can't see", () => {
  it("brings back exactly ONE idea, with the words to ask about it", async () => {
    const s = await planned();
    await advance(s.id);            // rows 0-2 plan, 3-6 batch, 7 crossroads
    await readEverything(s.id);
    await advance(s.id);            // rows 8-11 batch, 12 crossroads
    await readEverything(s.id);
    await advance(s.id);

    const ctx = lastWrite();
    // one, never two: a batch carrying two callbacks stops being a feed and starts being a check-up
    expect(ctx.learnerState.directives.due).toEqual([PLAN_ANCHOR]);
    // the writer is handed the idea in WORDS — a slug in a prompt teaches nothing
    const block = dueBlock(ctx.learnerState);
    expect(block).toBeTruthy();
    expect(block).toContain(PLAN_ANCHOR);
    // words, not a slug: "anchor \"cache-bet\"" on its own would teach the writer nothing
    expect(block).toMatch(/viscosity is a lie/);
  });

  it("counts the reader's position over the FULL row list, detour and system rows included", async () => {
    const s = await planned();
    const g = await generateNext(s.id);
    const fork = g.cards.at(-1)!;
    expect(fork.type).toBe("crossroads");
    await chooseAtCrossroads(s.id, fork.id, "ask");
    const r = await ask(s.id, "what is bloom?", fork.id);
    expect(r.kind).toBe("detour");
    await readEverything(s.id);
    // the rows the next batch is composed against
    const seen = await store.listAllCards(s.id);
    await generateNext(s.id);

    // the proof: counted the way anchorMemories counts, the reader is far enough in for a callback…
    expect(seen.length).toBeGreaterThan(FIRST_CALLBACK_ORDINAL);
    // …and counted over content rows only — no markers, no crossroads — they are not, so nothing would fire
    expect(seen.filter((c) => isContentCard(c.payload)).length).toBeLessThan(FIRST_CALLBACK_ORDINAL);
    expect(lastWrite().learnerState.directives.due).toEqual([PLAN_ANCHOR]);
  });

  it("never asks about a card the runway has written but the reader has not reached", async () => {
    // a topic wide enough that the runway keeps filling without a boundary to stop at
    llm.state.plan = makePlan(8);
    const s = await planned();
    await generateNext(s.id);
    await generateNext(s.id);
    // a dozen cards written and the thumb still on the first: every memory is a card that does not
    // exist for them yet, and asking about one reads as the app being broken, not as a hard question
    expect((await store.listAllCards(s.id)).length).toBeGreaterThanOrEqual(FIRST_CALLBACK_ORDINAL);
    expect(lastWrite().learnerState.directives.due).toEqual([]);

    // …and once they have actually travelled that far, the same idea comes back
    await readEverything(s.id);
    await advance(s.id);
    await readEverything(s.id);
    await advance(s.id);
    expect(lastWrite().learnerState.directives.due).toEqual([PLAN_ANCHOR]);
  });

  it("chill mode turns the whole thing off — it is the setting for reading, not for being asked", async () => {
    const s = await createSession({ input: SOURCE, sourceKind: "sentence", sourceMeta: {}, settings: { chillMode: true } });
    await startPlanning(s.id);
    await advance(s.id);
    await readEverything(s.id);
    await advance(s.id);
    await readEverything(s.id);
    await advance(s.id);
    expect(lastWrite().learnerState.directives.due).toEqual([]);
  });
});

// ── the ledger ──────────────────────────────────────────────────────────────
describe("the ledger of ideas met", () => {
  it("records what they met and what they got, and only a DELAYED answer closes the callback", async () => {
    const s = await planned();
    await advance(s.id);
    const early = (await store.listAllCards(s.id))[1];
    expect(early.type).toBe("concept");

    // nobody scrolls up in a feed by accident: the idea goes to the front of the queue
    await interact(early.id, { scrollBack: true });
    expect((await store.getSession(s.id))!.learnerState.directives.due).toContain(PLAN_ANCHOR);

    // a bet on the same idea seven rows later is a pop check, not a retrieval — the queue stands
    const near = await betOn(s.id, PLAN_ANCHOR);
    await interact(near.id, { choice: 1, correct: true });
    let state = (await store.getSession(s.id))!.learnerState;
    expect(state.directives.due).toContain(PLAN_ANCHOR);
    expect(state.ledger.find((e) => e.anchor === PLAN_ANCHOR)).toMatchObject({ hits: 1, label: expect.stringContaining("cache") });

    // …and one far enough down the feed IS the retrieval the queue asked for
    await advance(s.id);
    await advance(s.id);
    const far = await betOn(s.id, PLAN_ANCHOR);
    await interact(far.id, { choice: 1, correct: true });
    state = (await store.getSession(s.id))!.learnerState;
    expect(state.directives.due).not.toContain(PLAN_ANCHOR);
    expect(state.ledger.find((e) => e.anchor === PLAN_ANCHOR)?.hits).toBe(2);
  });

  /** A bet carrying `anchor`, appended after the last row. */
  async function betOn(sessionId: string, anchor: string) {
    const last = (await store.listAllCards(sessionId)).at(-1)!;
    const payload = binary(anchor, anchor);
    const [row] = await store.insertCards([{
      id: payload.id, sessionId, idx: `${last.idx}V`, type: payload.type, payload,
      detourId: null, batchId: null, viewedAt: null, interaction: null, createdAt: new Date().toISOString(),
    }]);
    return row;
  }
});

// ── the reorder and the jargon governor ─────────────────────────────────────
describe("concrete before abstract, and never at the cost of a card", () => {
  it("is handed the same history the governor reads, which is what makes the guard exact", () => {
    // the engine calls orderForLearning(main, history) and enforceVariety(history, ordered) with ONE
    // history. Split them and the reorder could tidy the batch into a card the governor then drops.
    const batches: Card[][] = [
      [concept("1", "a"), stat("1", "a"), concept("2", "a"), stat("2", "b")],
      [concept("1", "a"), stat("1", "a"), concept("2", "b"), concept("3", "b")],
      [stat("1", "a"), concept("1", "a"), binary("1", "a"), concept("2", "a")],
    ];
    const windows: CardType[][] = [[], ["concept"], ["concept", "concept"], ["stat", "hook"]];
    for (const batch of batches) {
      for (const history of windows) {
        const ordered = orderForLearning(batch, history);
        expect(ordered).toHaveLength(batch.length);
        expect(enforceVariety(history, ordered).dropped.length).toBeLessThanOrEqual(enforceVariety(history, batch).dropped.length);
      }
    }
  });

  it("the jargon governor sharpens the NEXT batch and never takes a card away", async () => {
    const s = await planned();
    const first = await advance(s.id);
    expect(first.filter((c) => c.type !== "crossroads")).toHaveLength(4);
    expect(lastWrite().extraDirectives.join(" ")).not.toMatch(/never handed/);

    const second = await advance(s.id);
    // the batch that came back put five domain words on screen with nothing to tap, so the next
    // call is told about it — and still gets every one of its four cards
    expect(lastWrite().extraDirectives.join(" ")).toMatch(/never handed/);
    expect(second.filter((c) => c.type !== "crossroads")).toHaveLength(4);
  });
});
