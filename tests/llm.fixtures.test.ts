/** Shared fixtures for the LLM-layer tests (not a test file itself). */
import type {
  DetourContext, EvaluateOpenInput, PlanInput, StorylineInput, TriageInput, WrapContext, WriteContext,
} from "@/lib/llm-types";
import type { Store } from "@/lib/db/store";
import type { LlmCall, Storyline } from "@/lib/schemas/session";
import { WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import type { Persona } from "@/lib/schemas/plan";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { SAMPLE_CARDS } from "@/lib/sample/cards";

export const PERSONA: Persona = {
  name: "ops",
  traits: ["on-call for a decade", "allergic to hand-waving", "dry as a log line"],
  tics: ["says 'here's the footgun'", "ends hard truths with 'anyway.'"],
  humor: "deadpan",
  neverDoes: "never says 'simply'",
};

export const SESSION_ID = "0f8c1c2e-1b2a-4c3d-9e4f-5a6b7c8d9e0f";

export const CORPUS = `# Caching, the short version

A cache is a bet on repetition. Most requests ask for the same thing again and again.

## Cache-aside
Ask the fast thing first. On a miss, read the database and write the value back with a TTL.

## Stampedes
When a cache restarts empty, every request becomes a miss at once. That is a thundering herd.
`;

export function planInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    sessionId: SESSION_ID,
    sourceKind: "paste",
    sourceText: CORPUS,
    sourceMeta: {},
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    ...over,
  };
}

export function writeCtx(over: Partial<WriteContext> = {}): WriteContext {
  return {
    sessionId: SESSION_ID,
    mode: "normal",
    persona: PERSONA,
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    node: { id: "n1", title: "caching: the core idea", estCards: 4, dependsOn: [], brief: "land what a cache is", corpusHint: "opening" },
    corpusSlice: CORPUS,
    sourceKind: "paste",
    learnerState: defaultLearnerState(),
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    recent: [],
    usedMetaphors: [],
    allowedTypes: WRITER_CARD_TYPES,
    batchSize: 4,
    detourId: null,
    extraDirectives: [],
    ...over,
  };
}

export function triageInput(over: Partial<TriageInput> = {}): TriageInput {
  return {
    sessionId: SESSION_ID,
    question: "what is a TTL?",
    currentCard: SAMPLE_CARDS[1],
    sessionSummary: "caching, scrolled in — n1 caching: the core idea",
    persona: PERSONA,
    corpusSlice: CORPUS,
    ...over,
  };
}

export function detourCtx(over: Partial<DetourContext> = {}): DetourContext {
  const { mode: _m, node: _n, ...rest } = writeCtx();
  void _m; void _n;
  return {
    ...rest,
    question: "why does a restart cause a stampede?",
    focus: "land why an empty cache turns every hit into a miss at once",
    cardCount: 3,
    currentCard: SAMPLE_CARDS[1],
    detourId: "d-1",
    ...over,
  };
}

export const STORYLINE: Storyline = {
  spine: "a cache is a bet that you'll ask for the same thing twice, and every hard part of caching is what happens when the bet is wrong.",
  covered: ["a cache is a bet on repetition", "a miss costs a whole db read"],
  next: "what an empty cache does to the database",
  updatedAtIdx: "a0",
};

export function evaluateInput(over: Partial<EvaluateOpenInput> = {}): EvaluateOpenInput {
  return {
    sessionId: SESSION_ID,
    prompt: "in your own words — why does an empty cache hurt the database?",
    rubric: "every ask becomes a miss; the misses all land at once; the database was only sized for the misses",
    modelAnswer: "nothing is in memory, so every ask goes to the database at the same moment — and it was never sized for all of them at once.",
    answer: "because every request becomes a miss and they all hit the database at once",
    persona: PERSONA,
    corpusSlice: CORPUS,
    ...over,
  };
}

export function storylineInput(over: Partial<StorylineInput> = {}): StorylineInput {
  return {
    sessionId: SESSION_ID,
    prev: STORYLINE,
    title: "caching, scrolled in",
    outline: [
      { id: "n1", title: "caching: the core idea", estCards: 4, dependsOn: [], brief: "land what a cache is" },
      { id: "n2", title: "where caching breaks", estCards: 4, dependsOn: ["n1"], brief: "stampedes and staleness" },
    ],
    nodeIdx: 0,
    recent: [{ type: "stat", gist: "10x fewer db reads" }, { type: "diagram", gist: "flow: a miss, start to finish" }],
    corpusSlice: CORPUS,
    ...over,
  };
}

export function wrapCtx(over: Partial<WrapContext> = {}): WrapContext {
  return {
    sessionId: SESSION_ID,
    persona: PERSONA,
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    storyline: STORYLINE,
    outline: storylineInput().outline,
    covered: [
      { type: "hook", gist: "your site is one restart from a stampede" },
      { type: "stat", gist: "10x fewer db reads" },
      { type: "diagram", gist: "flow: a miss, start to finish" },
    ],
    learnerState: defaultLearnerState(),
    ...over,
  };
}

/** In-memory fake of the llm_calls half of Store. Everything else throws if touched. */
export function fakeStore(opts: { count?: () => Promise<number> | number } = {}) {
  const calls: LlmCall[] = [];
  const store = {
    calls,
    async logLlmCall(c: LlmCall) { calls.push(c); },
    async countLlmCallsSince() { return opts.count ? await opts.count() : calls.length; },
    async listLlmCalls() { return calls; },
  } as unknown as Store & { calls: LlmCall[] };
  return store;
}

// ── this file doubles as a fixture module; keep one real assertion so vitest is happy ──
import { describe, expect, it } from "vitest";
import { CardSchema } from "@/lib/schemas/cards";
import { PersonaSchema } from "@/lib/schemas/plan";

describe("llm test fixtures", () => {
  it("are schema-valid", () => {
    expect(PersonaSchema.safeParse(PERSONA).success).toBe(true);
    expect(CardSchema.safeParse(triageInput().currentCard).success).toBe(true);
    expect(writeCtx().allowedTypes.length).toBeGreaterThan(0);
  });
});
