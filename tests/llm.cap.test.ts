import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CardSchema } from "@/lib/schemas/cards";
import { PlanOutputSchema } from "@/lib/schemas/plan";
import { CANNED_TOASTS } from "@/lib/prompts/dial";
import { detourCtx, fakeStore, planInput, PERSONA, SESSION_ID, triageInput, writeCtx } from "./llm.fixtures.test";

process.env.LLM_MOCK_LATENCY_MS = "0";

type Llm = typeof import("@/lib/llm");
let llm: Llm;
beforeAll(async () => {
  llm = await import("@/lib/llm");
});

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.LLM_MODE = "mock";
  process.env.LLM_DAILY_CALL_CAP = "500";
  delete process.env.LLM_MOCK_DAILY_CALL_CAP;
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  llm.__resetDeps();
  for (const k of ["LLM_MODE", "LLM_DAILY_CALL_CAP", "LLM_MOCK_DAILY_CALL_CAP", "ANTHROPIC_API_KEY"]) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("spend cap (fails closed)", () => {
  it("cap reached → code budget; the refusal is logged and NOT counted as ok", async () => {
    process.env.LLM_MOCK_DAILY_CALL_CAP = "500"; // mock has its own cap; pin it to exercise the paid-cap path
    const store = fakeStore({ count: () => 500 });
    llm.__setDeps({ store });
    const r = await llm.writeBatch(writeCtx());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("budget");
    expect(!r.ok && r.error).toMatch(/daily cap reached \(500\/500\)/);
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].ok).toBe(false);
    expect(store.calls[0].purpose).toBe("write");
    expect(store.calls[0].promptVersion).toMatch(/^write\.v6\+shared\.v\d+\.[0-9a-f]{8}$/);
    expect(store.calls[0].error).toMatch(/budget/);
  });

  it("respects LLM_DAILY_CALL_CAP (real mode; the cap check runs before the key check)", async () => {
    delete process.env.LLM_MODE;
    process.env.LLM_DAILY_CALL_CAP = "3";
    const store = fakeStore({ count: () => 3 });
    llm.__setDeps({ store });
    const r = await llm.triage(triageInput());
    expect(!r.ok && r.code).toBe("budget");
    process.env.LLM_DAILY_CALL_CAP = "4";
    const next = await llm.triage(triageInput());
    expect(!next.ok && next.code).toBe("no_key"); // past the cap, stopped by the missing key, never budget
  });

  it("mock mode ignores the paid cap (a persistent .data store must never flip e2e to 'budget'), unless LLM_MOCK_DAILY_CALL_CAP is set", async () => {
    process.env.LLM_DAILY_CALL_CAP = "3";
    const store = fakeStore({ count: () => 5_000 });
    llm.__setDeps({ store });
    expect(llm.dailyCallCap()).toBe(llm.MOCK_DAILY_CALL_CAP);
    const r = await llm.triage(triageInput());
    expect(r.ok).toBe(true);
    process.env.LLM_MOCK_DAILY_CALL_CAP = "10";
    try {
      const capped = await llm.triage(triageInput());
      expect(!capped.ok && capped.code).toBe("budget");
    } finally {
      delete process.env.LLM_MOCK_DAILY_CALL_CAP;
    }
  });

  it("count throws → code api 'spend counter unreadable' (fails closed, but NOT a day-long budget)", async () => {
    const store = fakeStore({ count: () => { throw new Error("db down"); } });
    llm.__setDeps({ store });
    const r = await llm.plan(planInput());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("api");
    expect(!r.ok && r.error).toBe("spend counter unreadable");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].ok).toBe(false);
    expect(store.calls[0].error).toMatch(/^api: spend counter unreadable/);
  });

  it("unparseable / blank / zero cap env → api (fails closed) with a loud console.error; blank model env → default model", async () => {
    delete process.env.LLM_MODE;
    const store = fakeStore({ count: () => 0 });
    llm.__setDeps({ store });
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
    try {
      process.env.LLM_DAILY_CALL_CAP = "lots";
      const r = await llm.triage(triageInput());
      expect(!r.ok && r.code).toBe("api");
      expect(!r.ok && r.error).toMatch(/spend counter unreadable/);
      process.env.LLM_DAILY_CALL_CAP = "0";
      expect(Number.isNaN(llm.dailyCallCap())).toBe(true);
      expect(errors.some((e) => /LLM_DAILY_CALL_CAP/.test(e))).toBe(true);
    } finally {
      console.error = orig;
    }
    process.env.LLM_DAILY_CALL_CAP = "   ";
    expect(llm.dailyCallCap()).toBe(500);
    process.env.LLM_PLAN_MODEL = "";
    process.env.LLM_WRITE_MODEL = " ";
    try {
      expect(llm.PLAN_MODEL()).toBe("claude-sonnet-4-6");
      expect(llm.WRITE_MODEL()).toBe("claude-haiku-4-5");
    } finally {
      delete process.env.LLM_PLAN_MODEL;
      delete process.env.LLM_WRITE_MODEL;
    }
  });

  it("dialToast never fails: budget → canned copy", async () => {
    process.env.LLM_MOCK_DAILY_CALL_CAP = "500";
    llm.__setDeps({ store: fakeStore({ count: () => 10_000 }) });
    expect(await llm.dialToast({ sessionId: SESSION_ID, persona: PERSONA, direction: "simpler" })).toBe(CANNED_TOASTS.simpler);
    expect(await llm.dialToast({ sessionId: SESSION_ID, persona: PERSONA, direction: "deeper" })).toBe(CANNED_TOASTS.deeper);
  });
});

describe("logging + mock pipeline", () => {
  it("every successful call is logged with purpose, model, promptVersion, tokens, latency, ok", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const p = await llm.plan(planInput());
    const w = await llm.writeBatch(writeCtx());
    const t = await llm.triage(triageInput());
    const d = await llm.writeDetour(detourCtx());
    const toast = await llm.dialToast({ sessionId: SESSION_ID, persona: PERSONA, direction: "deeper" });
    expect(p.ok && w.ok && t.ok && d.ok).toBe(true);
    expect(typeof toast).toBe("string");
    expect(store.calls.map((c) => c.purpose)).toEqual(["plan", "write", "triage", "detour", "chat"]);
    const shared = /\+shared\.v\d+\.[0-9a-f]{8}$/;
    expect(store.calls.map((c) => c.promptVersion.replace(shared, ""))).toEqual(["plan.v4", "write.v6", "triage.v2", "detour.v2+write.v6", "dial.v1"]);
    for (const c of store.calls) expect(c.promptVersion).toMatch(shared);
    for (const c of store.calls) {
      expect(c.ok).toBe(true);
      expect(c.model).toBe("mock");
      expect(c.sessionId).toBe(SESSION_ID);
      expect(c.inTokens).toBeGreaterThan(0);
      expect(c.outTokens).toBeGreaterThan(0);
      expect(c.error).toBeNull();
      expect(typeof c.createdAt).toBe("string");
    }
    if (p.ok) {
      expect(PlanOutputSchema.safeParse(p.value).success).toBe(true);
      expect(p.meta.promptVersion).toMatch(/^plan\.v4\+shared/);
      expect(p.meta.attempts).toBe(1);
    }
    if (w.ok) for (const c of w.value) expect(CardSchema.safeParse(c).success).toBe(true);
    if (d.ok) for (const c of d.value) expect(c.detourId).toBe("d-1");
  });

  it("re-plan (previousPlan set) logs purpose 'replan'", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const first = await llm.plan(planInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await llm.plan(planInput({ previousPlan: first.value, clarifierAnswers: { audience: "me, curious" } }));
    expect(again.ok).toBe(true);
    expect(store.calls.map((c) => c.purpose)).toEqual(["plan", "replan"]);
  });

  it("[[FAIL]] hook → validation failure with raw output, logged as not ok", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const r = await llm.plan(planInput({ sourceText: "[[FAIL]] caching" }));
    expect(!r.ok && r.code).toBe("validation");
    expect(!r.ok && typeof r.raw).toBe("string");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].ok).toBe(false);
    expect(store.calls[0].error).toMatch(/validation/);
  });

  it("[[BUDGET]] hook → budget failure even when the cap has room", async () => {
    const store = fakeStore({ count: () => 0 });
    llm.__setDeps({ store });
    const r = await llm.writeBatch(writeCtx({ node: { id: "n1", title: "[[BUDGET]] caching", estCards: 3, dependsOn: [] } }));
    expect(!r.ok && r.code).toBe("budget");
    expect(store.calls[0].ok).toBe(false);
  });

  it("logging failures never break a call", async () => {
    const store = fakeStore({ count: () => 0 });
    (store as unknown as { logLlmCall: () => Promise<void> }).logLlmCall = async () => { throw new Error("disk full"); };
    llm.__setDeps({ store });
    const r = await llm.triage(triageInput());
    expect(r.ok).toBe(true);
  });
});

describe("real mode guards (no network)", () => {
  it("no ANTHROPIC_API_KEY → code no_key, logged", async () => {
    delete process.env.LLM_MODE;
    delete process.env.ANTHROPIC_API_KEY;
    const store = fakeStore();
    llm.__setDeps({ store });
    const r = await llm.writeBatch(writeCtx());
    expect(!r.ok && r.code).toBe("no_key");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].ok).toBe(false);
    expect(store.calls[0].error).toMatch(/no_key/);
    expect(store.calls[0].model).toBe("claude-haiku-4-5");
    expect(await llm.dialToast({ sessionId: SESSION_ID, persona: PERSONA, direction: "simpler" })).toBe("say less. rewinding the jargon.");
  });

  it("cap check runs before the key check", async () => {
    delete process.env.LLM_MODE;
    const store = fakeStore({ count: () => { throw new Error("nope"); } });
    llm.__setDeps({ store });
    const r = await llm.triage(triageInput());
    expect(!r.ok && r.code).toBe("api");
  });
});

describe("json extraction + card normalization", () => {
  it("extractJsonObject ignores fences/prose around the object and takes the first balanced object", () => {
    expect(llm.extractJsonObject('sure!\n```json\n{"a":1,"b":{"c":"}"}}\n```\ntrailing')).toBe('{"a":1,"b":{"c":"}"}}');
    expect(llm.extractJsonObject('{"s":"esc\\"aped {"}')).toBe('{"s":"esc\\"aped {"}');
    expect(llm.extractJsonObject("no json here")).toBeNull();
    expect(llm.extractJsonObject('{"unterminated": ')).toBeNull();
  });

  it("extractJsonObject never rewrites fences INSIDE string values (a code card may contain ```)", () => {
    const src = '{"cards":[{"code":"```js\\nx\\n```"}]}';
    const out = llm.extractJsonObject("```json\n" + src + "\n```");
    expect(out).toBe(src);
    expect((JSON.parse(out!) as { cards: Array<{ code: string }> }).cards[0].code).toBe("```js\nx\n```");
  });

  it("batchMaxTokens scales with the card count and stays bounded", () => {
    expect(llm.batchMaxTokens(1)).toBe(3_000);
    expect(llm.batchMaxTokens(4)).toBe(5_000);
    expect(llm.batchMaxTokens(6)).toBe(7_000);
    expect(llm.batchMaxTokens(40)).toBe(8_000);
    expect(llm.batchMaxTokens(Number.NaN)).toBe(5_000);
  });

  it("clampPlanInternalFields normalizes estCards / clarifiers / outline / firstCards bounds instead of rejecting the plan", () => {
    const outline = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, title: `t${i}`, estCards: i % 2 ? 1 : 12, dependsOn: [] }));
    const clarifiers = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, prompt: "p", options: ["a", "b", "c", "d"] }));
    const o = llm.clampPlanInternalFields({ title: "x", outline, clarifiers, firstCards: [1, 2, 3, 4] }) as { outline: Array<{ estCards: number }>; clarifiers: Array<{ options: string[] }>; firstCards: unknown[] };
    expect(o.outline).toHaveLength(24);
    expect(o.outline.every((n) => n.estCards >= 3 && n.estCards <= 8)).toBe(true);
    expect(o.clarifiers).toHaveLength(3);
    expect(o.clarifiers[0].options).toHaveLength(3);
    expect(o.firstCards).toHaveLength(3);
  });

  it("normalizeCards replaces bad ids and fills missing detourId only", () => {
    const out = llm.normalizeCards([{ id: "card-1", type: "hook", headline: "x" }, { id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01", detourId: "d9" }, "junk"], "d-1") as Array<Record<string, unknown>>;
    expect(out[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out[0].detourId).toBe("d-1");
    expect(out[0].headline).toBe("x");
    expect(out[1].id).toBe("3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01");
    expect(out[1].detourId).toBe("d9");
    expect(out[2]).toBe("junk");
    expect(llm.normalizeCards("nope", null)).toBe("nope");
  });

  it("startOfTodayUtc is midnight UTC of the injected clock", () => {
    llm.__setDeps({ now: () => new Date("2026-08-16T19:30:00.000Z") });
    expect(llm.startOfTodayUtc()).toBe("2026-08-16T00:00:00.000Z");
  });
});
