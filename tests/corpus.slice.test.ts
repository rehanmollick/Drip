import { describe, expect, it } from "vitest";
import { isHeadingLike, queryTerms, scoreParagraph, sliceFor, stem } from "@/lib/generation/corpus";
import type { OutlineNode } from "@/lib/schemas/plan";

const node = (over: Partial<OutlineNode> = {}): OutlineNode => ({
  id: "n1", title: "ticket storms", estCards: 5, dependsOn: [], ...over,
});

/**
 * A realistic document: markdown headings, prose under them, and a lot of
 * unrelated filler in between — the shape that used to hand the writer a
 * keyword window that missed the passage the node was actually about.
 */
const OPENING = "Every service starts the same way: a cold empty room that is about to be very busy. That gap is what the whole night is about.";
const PASS_BODY = "The pass is the counter where finished plates wait. One person, the expediter, calls tickets and decides what leaves the kitchen and when.";
const STORM_BODY = "A ticket storm happens when twelve tables order at once. The expediter starts holding plates, the pass backs up, and every station is late at the same moment.";
const STORM_FIX = "Two things break a storm: pre-firing the slow items, and the expediter dropping courses so the pass never holds more than it can send.";
const LOUD_STORMS = "Storms are a genre on the news now. A storm here, a storm there, every storm gets a name, and storm coverage sells. Storms, basically.";

function filler(n: number, topic: string): string[] {
  return Array.from({ length: n }, (_, i) => `${topic} note ${i}. Nothing to do with the subject: laundry, parking, the walk-in fridge light, invoices, and a long story about the landlord.`);
}

function doc(): string {
  return [
    "# The Restaurant Kitchen, End to End",
    OPENING,
    ...filler(12, "Front of house"),
    "## The pass",
    PASS_BODY,
    ...filler(12, "Suppliers"),
    "## Ticket storms",
    STORM_BODY,
    STORM_FIX,
    ...filler(12, "Payroll"),
    "## Weather",
    LOUD_STORMS,
    ...filler(12, "Closing"),
  ].join("\n\n");
}

const stormNode = node({
  title: "ticket storms",
  brief: "why the pass backs up when tickets land at once",
  corpusHint: "## Ticket storms — expediter, holding plates",
});

describe("corpus: query terms", () => {
  it("stems plurals to a prefix both forms share", () => {
    expect(stem("stampedes")).toBe("stampede");
    expect(stem("batteries")).toBe("batter");
    expect(stem("process")).toBe("process");
    expect(stem("bus")).toBe("bus");
    expect(stem("analysis")).toBe("analysis");
    expect(stem("ttl")).toBe("ttl");
  });

  it("weights title over hint over brief, and sums a word carried by all three", () => {
    const terms = queryTerms(node({ title: "cache stampedes", brief: "a cache going cold", corpusHint: "cache warmup" }));
    const by = Object.fromEntries(terms.map((t) => [t.word, t.weight]));
    expect(by.cache).toBe(6);       // title 3 + hint 2 + brief 1
    expect(by.stampede).toBe(3);    // title only, singularised
    expect(by.warmup).toBe(2);      // hint only
    expect(by.cold).toBe(1);        // brief only
    expect(queryTerms(null)).toEqual([]);
  });

  it("only matches on a word boundary", () => {
    const terms = [{ word: "cat", weight: 3 }];
    expect(scoreParagraph("concatenated strings are concatenated again", terms, 3)).toBe(0);
    expect(scoreParagraph("the cats are loud", terms, 3)).toBeGreaterThan(0);
  });

  it("scores coverage of the query above repetition of one word", () => {
    const terms = queryTerms(stormNode);
    const total = terms.reduce((a, t) => a + t.weight, 0);
    expect(scoreParagraph(STORM_BODY, terms, total)).toBeGreaterThan(scoreParagraph(LOUD_STORMS, terms, total));
  });

  it("recognises heading-like lines", () => {
    expect(isHeadingLike("## Ticket storms")).toBe(true);
    expect(isHeadingLike("Ticket Storms")).toBe(true);
    expect(isHeadingLike(STORM_BODY)).toBe(false);
    expect(isHeadingLike("")).toBe(false);
  });
});

describe("corpus: slicing a real document", () => {
  it("returns short sources whole and stays inside the budget otherwise", () => {
    expect(sliceFor("tiny source", stormNode)).toBe("tiny source");
    for (const max of [400, 800, 2_000, 6_000]) {
      expect(sliceFor(doc(), stormNode, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("lands on the passage the node is about, not the paragraph that repeats its loudest word", () => {
    const slice = sliceFor(doc(), stormNode, 900);
    expect(slice).toContain(STORM_BODY);
    expect(slice).not.toContain(LOUD_STORMS);
    // the window doesn't wander off into whatever happens to sit next to the passage
    expect((slice.match(/note \d+\./g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("finds the prose under a heading the corpusHint names", () => {
    const slice = sliceFor(doc(), node({ id: "n2", title: "the pass", brief: "who decides what leaves the kitchen", corpusHint: "## The pass" }), 700);
    expect(slice).toContain("expediter");
    expect(slice).toContain(PASS_BODY);
    expect(slice).toContain("## The pass"); // the heading rides along as orientation
  });

  it("prefers one contiguous passage over scattered islands", () => {
    const slice = sliceFor(doc(), stormNode, 1_200);
    const breaks = slice.split("[…]").length - 1;
    expect(breaks).toBeLessThanOrEqual(2);
    expect(slice).toContain(STORM_BODY);
    expect(slice).toContain(STORM_FIX); // the neighbour that continues the thought
  });

  it("gives the FIRST node the document's opening as orientation, and later nodes not", () => {
    const first = sliceFor(doc(), stormNode, 1_200, { nodeIdx: 0, nodeCount: 5 });
    expect(first).toContain(OPENING);
    expect(first).toContain(STORM_BODY);
    const later = sliceFor(doc(), stormNode, 1_200, { nodeIdx: 3, nodeCount: 5 });
    expect(later).not.toContain(OPENING);
    // and the opening can be forced explicitly
    expect(sliceFor(doc(), stormNode, 1_200, { opening: true })).toContain(OPENING);
  });

  it("orientation never eats the whole budget", () => {
    const slice = sliceFor(doc(), stormNode, 700, { nodeIdx: 0, nodeCount: 5 });
    expect(slice).toContain(OPENING);
    expect(slice).toContain(STORM_BODY);
    expect(slice.length).toBeLessThanOrEqual(700);
  });

  it("falls back to the node's proportional position when nothing matches, and is deterministic", () => {
    const text = doc();
    const nowhere = node({ id: "n9", title: "zzz qqq", brief: "yyy", corpusHint: "xxx" });
    const first = sliceFor(text, nowhere, 500, { nodeIdx: 0, nodeCount: 4 });
    const last = sliceFor(text, nowhere, 500, { nodeIdx: 3, nodeCount: 4 });
    expect(first).toContain(OPENING);
    expect(last).not.toBe(first);
    expect(sliceFor(text, nowhere, 500, { nodeIdx: 3, nodeCount: 4 })).toBe(last);
    expect(sliceFor(text, null, 500).length).toBeLessThanOrEqual(500);
  });

  it("survives degenerate sources", () => {
    expect(sliceFor("   ", stormNode, 10)).toBe("");
    const wall = "x".repeat(5_000);
    expect(sliceFor(wall, stormNode, 100)).toHaveLength(100);
  });
});
