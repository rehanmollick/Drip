import { beforeAll, describe, expect, it } from "vitest";
import { findBannedInValue } from "@/lib/copy/banned";
import { CHILL_EXCLUDED_TYPES, CardBatchSchema, CardSchema, WRITER_CARD_TYPES, type CardType } from "@/lib/schemas/cards";
import { PlanOutputSchema, TriageOutputSchema } from "@/lib/schemas/plan";
import { ThemeSchema } from "@/lib/schemas/theme";
import { CORPUS, PERSONA, detourCtx, planInput, triageInput, writeCtx } from "./llm.fixtures.test";

process.env.LLM_MOCK_LATENCY_MS = "0";

type Mock = typeof import("@/lib/llm-mock");
let m: Mock;
beforeAll(async () => {
  m = await import("@/lib/llm-mock");
});

const chillTypes = WRITER_CARD_TYPES.filter((t) => !(CHILL_EXCLUDED_TYPES as readonly string[]).includes(t));

describe("mock plan", () => {
  it("validates, is banned-word free, and is deterministic for the same input", async () => {
    const a = await m.mockPlan(planInput());
    const b = await m.mockPlan(planInput());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(PlanOutputSchema.safeParse(a.value).success).toBe(true);
    expect(findBannedInValue(a.value)).toBeNull();
    expect(JSON.stringify(a.value)).toEqual(JSON.stringify(b.value));
    expect(a.value.outline.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(a.value.firstCards.map((c) => c.type)).toEqual(["hook", "concept", "concept"]);
    for (const c of a.value.firstCards) {
      expect(c.topicNodeId).toBe("n1");
      expect(c.detourId).toBeNull();
    }
    expect(a.value.clarifiers).toEqual([]);
    expect(a.value.title).toContain("caching");
  });

  it("themes cycle across the three built-ins and all validate", async () => {
    for (const t of m.MOCK_THEMES) expect(ThemeSchema.safeParse(t).success).toBe(true);
    const seen = new Set<string>();
    for (const txt of ["redis caching", "tide pools and kelp", "orbital mechanics", "compilers", "sourdough starters", "the fed"]) {
      const r = await m.mockPlan(planInput({ sourceText: txt, sourceKind: "sentence" }));
      expect(r.ok).toBe(true);
      if (r.ok) seen.add(r.value.theme.name);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("emits clarifiers only for short/ambiguous sentences", async () => {
    const short = await m.mockPlan(planInput({ sourceKind: "sentence", sourceText: "teach me redis?" }));
    const clear = await m.mockPlan(planInput({ sourceKind: "sentence", sourceText: "explain how a redis cache keeps a busy site alive during peak traffic" }));
    const paste = await m.mockPlan(planInput({ sourceKind: "paste", sourceText: "redis?" }));
    const answered = await m.mockPlan(planInput({ sourceKind: "sentence", sourceText: "redis?", clarifierAnswers: { audience: "me, curious" } }));
    expect(short.ok && short.value.clarifiers.length).toBeGreaterThan(0);
    expect(short.ok && short.value.clarifiers.length).toBeLessThanOrEqual(2);
    expect(clear.ok && clear.value.clarifiers.length).toBe(0);
    expect(paste.ok && paste.value.clarifiers.length).toBe(0);
    expect(answered.ok && answered.value.clarifiers.length).toBe(0);
  });

  it("[[FAIL]] → validation, [[BUDGET]] → budget", async () => {
    const f = await m.mockPlan(planInput({ sourceText: "[[FAIL]] anything" }));
    const b = await m.mockPlan(planInput({ sourceText: "[[BUDGET]] anything" }));
    expect(f.ok).toBe(false);
    expect(!f.ok && f.code).toBe("validation");
    expect(!f.ok && typeof f.raw).toBe("string");
    expect(b.ok).toBe(false);
    expect(!b.ok && b.code).toBe("budget");
  });
});

describe("mock writeBatch", () => {
  const modes = ["normal", "teaser", "resurface", "adjacent", "recap", "scaffold"] as const;

  it("every mode validates against CardBatchSchema with no banned words", async () => {
    for (const mode of modes) {
      const r = await m.mockWriteBatch(writeCtx({ mode, missedConcepts: ["TTL"] }));
      expect(r.ok, mode).toBe(true);
      if (!r.ok) continue;
      expect(CardBatchSchema.safeParse({ cards: r.value }).success, mode).toBe(true);
      expect(findBannedInValue(r.value), mode).toBeNull();
      for (const c of r.value) expect(c.detourId).toBeNull();
    }
  });

  it("normal mode writes batchSize cards, mixes types, and includes an interactive + code/diagram", async () => {
    const r = await m.mockWriteBatch(writeCtx({ batchSize: 4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(4);
    const types = r.value.map((c) => c.type);
    expect(new Set(types).size).toBeGreaterThan(1);
    expect(types.some((t) => ["binary", "predict", "sequence", "slider"].includes(t))).toBe(true);
    expect(types.some((t) => t === "code" || t === "diagram")).toBe(true);
    for (const c of r.value) expect(c.topicNodeId).toBe("n1");
  });

  it("obeys allowedTypes (chill mode → zero interactives)", async () => {
    for (let i = 0; i < 6; i++) {
      const r = await m.mockWriteBatch(writeCtx({ allowedTypes: chillTypes, recent: Array.from({ length: i }, (_, k) => ({ type: "concept" as CardType, gist: `g${k}` })) }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (const c of r.value) expect((CHILL_EXCLUDED_TYPES as readonly string[]).includes(c.type)).toBe(false);
    }
  });

  it("covers code and diagram over successive batches", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await m.mockWriteBatch(writeCtx({ recent: Array.from({ length: Math.min(6, i * 4) }, (_, k) => ({ type: "concept" as CardType, gist: `batch${i}-${k}` })) }));
      if (r.ok) for (const c of r.value) seen.add(c.type);
    }
    expect(seen.has("code")).toBe(true);
    expect(seen.has("diagram")).toBe(true);
  });

  it("ends the node with a checkpoint when asked", async () => {
    const r = await m.mockWriteBatch(writeCtx({ extraDirectives: ["end of node: write a checkpoint"] }));
    expect(r.ok && r.value.at(-1)?.type).toBe("checkpoint");
  });

  it("teaser: hook + concept with eyebrow 'reading your stuff'", async () => {
    const r = await m.mockWriteBatch(writeCtx({ mode: "teaser", node: null }));
    expect(r.ok && r.value.map((c) => c.type)).toEqual(["hook", "concept"]);
    if (r.ok) for (const c of r.value) expect(c.eyebrow).toBe("reading your stuff");
  });

  it("recap uses a metaphor not in usedMetaphors", async () => {
    const used = ["a sticky note on the fridge", "a bouncer with a guest list"];
    const r = await m.mockWriteBatch(writeCtx({ mode: "recap", usedMetaphors: used, missedConcepts: ["TTL"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    const card = r.value[0];
    expect(card.type).toBe("recap");
    if (card.type === "recap") expect(used).not.toContain(card.metaphor);
  });

  it("adjacent: hook offers to go one layer deeper", async () => {
    const r = await m.mockWriteBatch(writeCtx({ mode: "adjacent" }));
    expect(r.ok && r.value[0].type).toBe("hook");
    if (r.ok && r.value[0].type === "hook") expect(r.value[0].headline).toMatch(/one layer deeper/);
  });

  it("[[FAIL]] in node title → validation; [[BUDGET]] → budget", async () => {
    const f = await m.mockWriteBatch(writeCtx({ node: { id: "n9", title: "[[FAIL]] boom", estCards: 3, dependsOn: [] } }));
    const b = await m.mockWriteBatch(writeCtx({ node: { id: "n9", title: "[[BUDGET]] boom", estCards: 3, dependsOn: [] } }));
    expect(!f.ok && f.code).toBe("validation");
    expect(!b.ok && b.code).toBe("budget");
  });
});

describe("mock triage + detour + toast", () => {
  it("triage: short factual → inline; why/how/long → detour", async () => {
    const a = await m.mockTriage(triageInput({ question: "what is a TTL?" }));
    const b = await m.mockTriage(triageInput({ question: "why does a restart cause a stampede?" }));
    const c = await m.mockTriage(triageInput({ question: "so if the cache is in memory and the process dies, is there anything left at all afterwards" }));
    for (const r of [a, b, c]) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(TriageOutputSchema.safeParse(r.value).success).toBe(true);
        expect(findBannedInValue(r.value)).toBeNull();
      }
    }
    expect(a.ok && a.value.kind).toBe("inline");
    expect(b.ok && b.value.kind).toBe("detour");
    expect(c.ok && c.value.kind).toBe("detour");
    const f = await m.mockTriage(triageInput({ question: "[[FAIL]] hm" }));
    expect(!f.ok && f.code).toBe("validation");
  });

  it("detour: N cards, first answers directly, all tagged with the detour", async () => {
    for (const n of [2, 4, 6]) {
      const r = await m.mockWriteDetour(detourCtx({ cardCount: n }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value).toHaveLength(n);
      expect(CardBatchSchema.safeParse({ cards: r.value }).success).toBe(true);
      expect(findBannedInValue(r.value)).toBeNull();
      expect(r.value[0].type).toBe("concept");
      for (const c of r.value) {
        expect(c.detourId).toBe("d-1");
        expect(c.topicNodeId).toBe("n1");
        expect(CardSchema.safeParse(c).success).toBe(true);
      }
    }
    const b = await m.mockWriteDetour(detourCtx({ question: "[[BUDGET]] why" }));
    expect(!b.ok && b.code).toBe("budget");
  });

  it("toast is short and banned-word free", async () => {
    for (const direction of ["simpler", "deeper"] as const) {
      const r = await m.mockDialToast({ persona: PERSONA, direction });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.length).toBeLessThanOrEqual(90);
        expect(findBannedInValue(r.value)).toBeNull();
      }
    }
  });

  it("subjectOf skips stopwords and banned words; uuids are valid + stable", () => {
    expect(m.subjectOf("teach me about redis caching")).toBe("redis");
    expect(m.subjectOf("a test of the quiz system")).toBe("system");
    expect(m.subjectOf("")).toBe("this");
    const u = m.deterministicUuid("x");
    expect(u).toBe(m.deterministicUuid("x"));
    expect(u).not.toBe(m.deterministicUuid("y"));
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(CORPUS.length).toBeGreaterThan(0);
  });
});
