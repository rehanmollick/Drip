import { describe, expect, it } from "vitest";
import { keywords, sliceFor, splitParagraphs } from "@/lib/generation/corpus";
import { cardSummary, recentSummaries, usedMetaphors } from "@/lib/generation/summaries";
import { toPublic } from "@/lib/generation/public";
import { autoTitle, directiveLines, recomputeProgress } from "@/lib/generation/engine";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import type { OutlineNode } from "@/lib/schemas/plan";
import type { CardRow, Session } from "@/lib/schemas/session";
import { defaultLearnerState } from "@/lib/schemas/learner";

const node = (over: Partial<OutlineNode> = {}): OutlineNode => ({ id: "n1", title: "cache stampedes", estCards: 4, dependsOn: [], ...over });

function corpus(): string {
  const parts: string[] = [];
  for (let i = 0; i < 40; i++) parts.push(`Filler paragraph ${i}. Talks about kittens, weather, and lunch options in some detail so it takes space.`);
  parts.push("A stampede happens when the cache restarts empty and every request becomes a miss at once. The database sees its peak with zero help.");
  parts.push("Warmups and request coalescing fix stampedes: only one miss goes to the database, the rest wait for that answer.");
  for (let i = 0; i < 40; i++) parts.push(`More filler ${i}. Nothing about the subject here, just prose about gardens and trains and paint drying slowly.`);
  parts.push("TTL is the countdown on a cached value; when it hits zero the value is evicted and the next reader refetches.");
  return parts.join("\n\n");
}

describe("corpus slicing", () => {
  it("returns short sources whole", () => {
    expect(sliceFor("tiny source", node())).toBe("tiny source");
  });

  it("extracts keywords without stopwords", () => {
    expect(keywords("The cache and the stampede: TTL values")).toEqual(["cache", "stampede", "ttl", "values"]);
  });

  it("splits paragraphs and chunks walls of text", () => {
    expect(splitParagraphs("a\n\nb\n\n\nc")).toEqual(["a", "b", "c"]);
    const wall = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = splitParagraphs(wall, 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });

  it("picks the paragraphs relevant to the node and respects the budget", () => {
    const text = corpus();
    const slice = sliceFor(text, node({ title: "cache stampedes", brief: "why a cold cache slams the database" }), 700);
    expect(slice.length).toBeLessThanOrEqual(700);
    expect(slice).toMatch(/stampede/i);
    expect(slice).toMatch(/database/i);
    expect(slice).not.toMatch(/kittens/);
    // a different node gets a different slice
    const ttl = sliceFor(text, node({ id: "n3", title: "TTL and eviction", corpusHint: "countdown, evicted" }), 400);
    expect(ttl).toMatch(/TTL/);
    expect(ttl).not.toMatch(/stampede/);
  });

  it("falls back to the node's proportional position when nothing matches", () => {
    const text = corpus();
    const first = sliceFor(text, node({ title: "zzz qqq" }), 300, { nodeIdx: 0, nodeCount: 4 });
    const last = sliceFor(text, node({ title: "zzz qqq" }), 300, { nodeIdx: 3, nodeCount: 4 });
    expect(first).toMatch(/Filler paragraph 0\./);
    expect(last).not.toBe(first);
    expect(sliceFor(text, null, 300)).toMatch(/Filler paragraph 0\./);
  });
});

describe("summaries", () => {
  it("summarises every sample card type in ≤80 chars", () => {
    for (const c of SAMPLE_CARDS) {
      const s = cardSummary(c);
      expect(s.type).toBe(c.type);
      expect(s.gist.length).toBeLessThanOrEqual(80);
      expect(s.gist.length).toBeGreaterThan(0);
    }
    const recapS = cardSummary(SAMPLE_CARDS.find((c) => c.type === "recap")!);
    expect(recapS.metaphor).toBe("sticky note on the fridge");
    expect(usedMetaphors(SAMPLE_CARDS)).toEqual(["sticky note on the fridge"]);
  });

  it("recentSummaries keeps the last 6 content cards, skipping system cards", () => {
    const r = recentSummaries(SAMPLE_CARDS, 6);
    expect(r).toHaveLength(6);
    expect(r.every((s) => !["notice", "fallback", "detour_marker", "clarify"].includes(s.type))).toBe(true);
  });
});

describe("misc engine helpers", () => {
  it("autoTitle takes the first line, ≤48 chars", () => {
    expect(autoTitle("  how a cache keeps a site alive\nmore")).toBe("how a cache keeps a site alive");
    expect(autoTitle("x".repeat(100))).toHaveLength(48);
    expect(autoTitle("   ")).toBe("untitled");
  });

  it("toPublic drops sourceText and adds sourceChars/cardCount", () => {
    const s = { sourceText: "abc", progress: { totalGenerated: 7 } } as unknown as Session;
    const p = toPublic(s);
    expect((p as unknown as { sourceText?: string }).sourceText).toBeUndefined();
    expect(p.sourceChars).toBe(3);
    expect(p.cardCount).toBe(7);
    expect(toPublic(s, 2).cardCount).toBe(2);
  });

  it("directiveLines renders learner directives as writer-facing lines", () => {
    const st = defaultLearnerState();
    expect(directiveLines(st)).toEqual([]);
    st.directives = { ...st.directives, difficultyDelta: 1, pace: "compress", reinforce: ["ttl"] };
    const lines = directiveLines(st);
    expect(lines.some((l) => /difficulty \+1/.test(l))).toBe(true);
    expect(lines.some((l) => /compress/.test(l))).toBe(true);
    expect(lines.some((l) => /ttl/.test(l))).toBe(true);
  });

  it("recomputeProgress derives the frontier from the remaining main-thread cards", () => {
    const outline = [node({ id: "n1", estCards: 3 }), node({ id: "n2", estCards: 4 })];
    const session = { outline, progress: { nodeIdx: 1, cardsInNode: 3, totalGenerated: 9, exhausted: false, extensions: 0, lastIdx: "zz" } } as unknown as Session;
    const row = (idx: string, topicNodeId: string, detourId: string | null = null, type = "concept") =>
      ({ idx, detourId, type, payload: { topicNodeId, type } }) as unknown as CardRow;
    // node n1 complete (3), n2 has 1 card, plus a detour card that must not count
    const p = recomputeProgress(session, [row("a0", "n1"), row("a1", "n1"), row("a2", "n1"), row("a3", "n2"), row("a3V", "n2", "d1")]);
    expect(p).toMatchObject({ nodeIdx: 1, cardsInNode: 1, exhausted: false, totalGenerated: 5, lastIdx: "a3V" });
    // only n1 left and complete → frontier moves to n2
    expect(recomputeProgress(session, [row("a0", "n1"), row("a1", "n1"), row("a2", "n1")])).toMatchObject({ nodeIdx: 1, cardsInNode: 0 });
    // nothing left → start over
    expect(recomputeProgress(session, [])).toMatchObject({ nodeIdx: 0, cardsInNode: 0, totalGenerated: 0, lastIdx: null });
    // outline exhausted
    expect(recomputeProgress(session, [row("a0", "n2"), row("a1", "n2"), row("a2", "n2"), row("a3", "n2")])).toMatchObject({ nodeIdx: 2, exhausted: true });
    // a trailing unanswered crossroads means the reader is still parked at the fork; it never counts toward a node
    const parked = recomputeProgress(session, [row("a0", "n1"), row("a1", "n1"), row("a2", "n1"), row("a3", "n1", null, "crossroads")]);
    expect(parked).toMatchObject({ awaitingChoice: true, nodeIdx: 1, cardsInNode: 0 });
    expect(recomputeProgress(session, [row("a0", "n1"), row("a1", "n1")]).awaitingChoice).toBe(false);
  });
});
