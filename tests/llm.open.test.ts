/**
 * The three calls that landed with the v2 feedback pass: evaluateOpen (reply to a typed
 * answer), updateStoryline (the session's through-line), writeWrap (the ending card).
 * Exercised through the real pipeline in lib/llm.ts — cap, logging, Zod, retry, scrub.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallOutcome, CallOpts } from "@/lib/llm";
import { findBannedInValue } from "@/lib/copy/banned";
import { CardSchema } from "@/lib/schemas/cards";
import { StorylineSchema } from "@/lib/schemas/session";
import { evaluateInput, fakeStore, storylineInput, wrapCtx, SESSION_ID } from "./llm.fixtures.test";

process.env.LLM_MOCK_LATENCY_MS = "0";

type Llm = typeof import("@/lib/llm");
type Mock = typeof import("@/lib/llm-mock");
let llm: Llm;
let m: Mock;
beforeAll(async () => {
  llm = await import("@/lib/llm");
  m = await import("@/lib/llm-mock");
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

/** Drive the real (non-mock) path with a scripted model. */
function scripted(...replies: string[]) {
  const seen: CallOpts[] = [];
  delete process.env.LLM_MODE;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const call = async (opts: CallOpts): Promise<CallOutcome> => {
    seen.push(opts);
    const text = replies[Math.min(seen.length - 1, replies.length - 1)];
    return { kind: "text", text, inTokens: 100, outTokens: 50, latencyMs: 5, truncated: false };
  };
  return { seen, call };
}

const GRADER_SPEAK = ["correct! nice one.", "that is incorrect.", "wrong answer, try again.", "good job — you got it."];

describe("evaluateOpen", () => {
  it("mock mode: replies to what they wrote, never grades, logs as chat with its own prompt version", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const r = await llm.evaluateOpen(evaluateInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(["got_it", "close", "not_yet"]).toContain(r.value.verdict);
    expect(r.value.feedback.length).toBeLessThanOrEqual(320);
    expect(findBannedInValue(r.value)).toBeNull();
    for (const g of GRADER_SPEAK) expect(r.value.feedback.toLowerCase()).not.toContain(g.split(" ")[0] + " answer");
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0].purpose).toBe("chat");
    expect(store.calls[0].sessionId).toBe(SESSION_ID);
    expect(store.calls[0].promptVersion).toMatch(/^evaluate\.v1\+shared\.v\d+\.[0-9a-f]{8}$/);
    expect(store.calls[0].ok).toBe(true);
  });

  it("the reply names something from THEIR answer, and the verdict tracks how much they had", async () => {
    llm.__setDeps({ store: fakeStore() });
    const good = await llm.evaluateOpen(evaluateInput());
    const partial = await llm.evaluateOpen(evaluateInput({ answer: "because everything becomes a miss" }));
    const empty = await llm.evaluateOpen(evaluateInput({ answer: "idk" }));
    expect(good.ok && good.value.verdict).toBe("got_it");
    expect(partial.ok && partial.value.verdict).toBe("close");
    expect(empty.ok && empty.value.verdict).toBe("not_yet");
    // a word they actually typed comes back in the reply
    if (good.ok) expect(good.value.feedback).toMatch(/miss|database|request/);
    if (partial.ok) expect(partial.value.missed.length).toBeGreaterThan(0);
    if (empty.ok) {
      expect(empty.value.feedback).toMatch(/no shame/);
      expect(empty.value.missed).toEqual([]);
    }
  });

  it("real mode: grader-speak fails validation and gets one retry with the reason appended", async () => {
    const store = fakeStore();
    const good = JSON.stringify({ verdict: "close", feedback: "the 'all at once' part is the hard half — you've got it. what's missing: the db was only ever sized for the misses.", missed: ["db sizing"] });
    const s = scripted(JSON.stringify({ verdict: "close", feedback: "correct! the misses all land at once.", missed: [] }), good);
    llm.__setDeps({ store, call: s.call });

    const r = await llm.evaluateOpen(evaluateInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.attempts).toBe(2);
    expect(r.value.feedback).toContain("all at once");
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1].user).toMatch(/failed validation/);
    expect(s.seen[1].user).toMatch(/grader-speak is not allowed/);
    expect(store.calls.map((c) => c.ok)).toEqual([false, true]);
  });

  it("real mode: grader-speak twice → validation failure, never reaching the screen", async () => {
    const bad = JSON.stringify({ verdict: "got_it", feedback: "that is correct. well done.", missed: [] });
    const s = scripted(bad, bad);
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.evaluateOpen(evaluateInput());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("validation");
  });

  it("real mode: an over-long reply is trimmed to a sentence instead of burning a retry", async () => {
    const long = "you nailed the 'everything misses at once' bit, which is the half most people skip. " +
      "the piece still missing is that the database was only ever sized for the misses, not for every single read. " +
      "that is why the first monday morning after a restart is the one that takes the whole site down for twenty minutes.";
    const s = scripted(JSON.stringify({ verdict: "close", feedback: long, missed: [] }));
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.evaluateOpen(evaluateInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.attempts).toBe(1);
    expect(r.value.feedback.length).toBeLessThanOrEqual(320);
    expect(r.value.feedback.endsWith(".")).toBe(true);
  });

  it("clamps the internal missed[] instead of retrying, and fails closed on budget", async () => {
    const s = scripted(JSON.stringify({ verdict: "not_yet", feedback: "the thing to hang onto: every ask becomes a miss.", missed: ["a".repeat(90), "b", "c", "d", "e"] }));
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.evaluateOpen(evaluateInput());
    expect(r.ok && r.value.missed).toHaveLength(4);
    expect(r.ok && r.value.missed[0].length).toBeLessThanOrEqual(60);

    llm.__resetDeps();
    process.env.LLM_MODE = "mock";
    process.env.LLM_MOCK_DAILY_CALL_CAP = "1";
    llm.__setDeps({ store: fakeStore({ count: () => 9_000 }) });
    const capped = await llm.evaluateOpen(evaluateInput());
    expect(!capped.ok && capped.code).toBe("budget");
  });

  it("[[FAIL]] / [[BUDGET]] hooks still work, scoped to this call", async () => {
    llm.__setDeps({ store: fakeStore() });
    const f = await m.mockEvaluateOpen(evaluateInput({ answer: "[[FAIL]] hmm" }));
    const b = await m.mockEvaluateOpen(evaluateInput({ answer: "[[BUDGET]] hmm" }));
    const scoped = await m.mockEvaluateOpen(evaluateInput({ answer: "[[FAIL:write]] hmm" }));
    expect(!f.ok && f.code).toBe("validation");
    expect(!b.ok && b.code).toBe("budget");
    expect(scoped.ok).toBe(true);
  });
});

describe("updateStoryline", () => {
  it("mock mode: returns a valid storyline that appends the beats that just landed", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const r = await llm.updateStoryline(storylineInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(StorylineSchema.safeParse(r.value).success).toBe(true);
    expect(findBannedInValue(r.value)).toBeNull();
    expect(r.value.covered).toContain("a miss costs a whole db read"); // carried forward
    expect(r.value.covered).toContain("10x fewer db reads");           // just landed
    expect(r.value.next).toContain("where caching breaks");
    expect(store.calls[0].promptVersion).toMatch(/^storyline\.v2\+shared/);
  });

  it("the model never sets updatedAtIdx — the engine's bookkeeping is carried through untouched", async () => {
    const s = scripted(JSON.stringify({ spine: "a cache is a bet on repetition", covered: ["what a cache is"], next: "the stampede", updatedAtIdx: "ZZZ" }));
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.updateStoryline(storylineInput());
    expect(r.ok && r.value.updatedAtIdx).toBe("a0"); // from prev, not from the model
    const fresh = await llm.updateStoryline(storylineInput({ prev: null }));
    expect(fresh.ok && fresh.value.updatedAtIdx).toBeNull();
  });

  it("soft-clamps an over-long spine / next / covered rather than spending a second call", async () => {
    const s = scripted(JSON.stringify({
      spine: "a cache is a bet on repetition ".repeat(20),
      covered: Array.from({ length: 20 }, (_, i) => `beat ${i} ${"x".repeat(120)}`),
      next: "y".repeat(300),
    }));
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.updateStoryline(storylineInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.attempts).toBe(1);
    expect(r.value.spine.length).toBeLessThanOrEqual(280);
    expect(r.value.next.length).toBeLessThanOrEqual(120);
    expect(r.value.covered).toHaveLength(12);
    for (const c of r.value.covered) expect(c.length).toBeLessThanOrEqual(80);
    expect(r.value.covered[11]).toContain("beat 19"); // keeps the most recent beats
  });
});

describe("writeWrap", () => {
  it("mock mode: one valid wrap card, on no topic node, outside any detour", async () => {
    const store = fakeStore();
    llm.__setDeps({ store });
    const r = await llm.writeWrap(wrapCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CardSchema.safeParse(r.value).success).toBe(true);
    expect(r.value.type).toBe("wrap");
    expect(r.value.topicNodeId).toBe("system");
    expect(r.value.detourId).toBeNull();
    expect(findBannedInValue(r.value)).toBeNull();
    if (r.value.type === "wrap") {
      expect(r.value.beats.length).toBeGreaterThanOrEqual(3);
      expect(r.value.beats.length).toBeLessThanOrEqual(5);
      for (const b of r.value.beats) expect(b.length).toBeLessThanOrEqual(120);
      expect(r.value.headline.length).toBeLessThanOrEqual(80);
    }
    expect(store.calls[0].purpose).toBe("write");
    expect(store.calls[0].promptVersion).toMatch(/^wrap\.v1\+shared/);
  });

  it("real mode: a model that forgets the bookkeeping still produces a renderable card", async () => {
    const s = scripted(JSON.stringify({
      card: {
        type: "summary", // wrong type — forced back to "wrap"
        headline: "you can argue about caches now. genuinely.",
        beats: ["a cache is a bet you'll ask twice", "a miss costs a whole slow read", "ttls exist so the answer can stop lying"],
        openThread: "we never touched two writers racing for the same key.",
      },
    }));
    llm.__setDeps({ store: fakeStore(), call: s.call });
    const r = await llm.writeWrap(wrapCtx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CardSchema.safeParse(r.value).success).toBe(true);
    expect(r.value.type).toBe("wrap");
    expect(r.value.topicNodeId).toBe("system");
    expect(r.value.detourId).toBeNull();
    expect(r.value.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("[[BUDGET]] on the wrap hook fails closed", async () => {
    llm.__setDeps({ store: fakeStore() });
    const r = await llm.writeWrap(wrapCtx({ storyline: { spine: "[[BUDGET]] x", covered: [], next: "y", updatedAtIdx: null } }));
    expect(!r.ok && r.code).toBe("budget");
  });
});

describe("mock parity", () => {
  it("the mock is deterministic for the same input across all three", async () => {
    const a = await Promise.all([m.mockEvaluateOpen(evaluateInput()), m.mockUpdateStoryline(storylineInput()), m.mockWriteWrap(wrapCtx())]);
    const b = await Promise.all([m.mockEvaluateOpen(evaluateInput()), m.mockUpdateStoryline(storylineInput()), m.mockWriteWrap(wrapCtx())]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("overlapWords ignores stopwords and short words", () => {
    expect(m.overlapWords("every request becomes a miss", "misses and requests land at once")).toEqual([]);
    expect(m.overlapWords("the database is slammed", "the database was only sized for misses")).toEqual(["database"]);
  });
});
