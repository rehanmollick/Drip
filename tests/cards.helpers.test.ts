import { describe, expect, it } from "vitest";
import {
  codeFontSize, estimateCodeRows, estimateLines, fitFontSize, fraction, hashString, hexAddress,
  reserveHeight, sameOrder, seededRandom, shuffleDeterministic, sparkPoints, splitSentences,
} from "@/components/cards/helpers";
import { WORST_CARDS } from "@/lib/feed/worst";

describe("cards helpers: deterministic shuffle", () => {
  const ids = ["a", "b", "c", "d"];
  it("is stable for the same seed and never the input order", () => {
    const s1 = shuffleDeterministic(ids, "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a07");
    const s2 = shuffleDeterministic(ids, "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a07");
    expect(s1).toEqual(s2);
    expect(sameOrder(s1, ids)).toBe(false);
    expect([...s1].sort()).toEqual(ids);
  });
  it("never returns the correct order across many seeds and lengths", () => {
    for (let n = 2; n <= 6; n++) {
      const items = Array.from({ length: n }, (_, i) => `i${i}`);
      for (let s = 0; s < 300; s++) {
        expect(sameOrder(shuffleDeterministic(items, `seed-${n}-${s}`), items)).toBe(false);
      }
    }
  });
  it("different seeds produce different orders (usually)", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 40; s++) seen.add(shuffleDeterministic(["a", "b", "c", "d", "e"], `s${s}`).join(""));
    expect(seen.size).toBeGreaterThan(10);
  });
  it("hash + prng are deterministic and in range", () => {
    expect(hashString("drip")).toBe(hashString("drip"));
    expect(hashString("drip")).not.toBe(hashString("drop"));
    const r = seededRandom(42);
    const v = [r(), r(), r()];
    v.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
    const r2 = seededRandom(42);
    expect([r2(), r2(), r2()]).toEqual(v);
  });
});

describe("cards helpers: sizing", () => {
  it("hexAddress is 0x?? and stable", () => {
    expect(hexAddress("abc")).toMatch(/^0x[0-9A-F]{2}$/);
    expect(hexAddress("abc")).toBe(hexAddress("abc"));
    expect(hexAddress("abc", 3)).toMatch(/^0x[0-9A-F]{3}$/);
  });
  it("fitFontSize steps down with length", () => {
    const steps = [[40, 32], [64, 28], [Infinity, 24]] as const;
    expect(fitFontSize("short", steps)).toBe(32);
    expect(fitFontSize("x".repeat(50), steps)).toBe(28);
    expect(fitFontSize("x".repeat(200), steps)).toBe(24);
  });
  it("code sizing keeps worst-case blocks small", () => {
    expect(estimateCodeRows("a\nb\nc")).toBe(3);
    expect(estimateCodeRows("x".repeat(100), 44)).toBe(3);
    expect(codeFontSize("short")).toBe(13);
    const worst = Array.from({ length: 30 }, () => "x".repeat(40)).join("\n");
    expect(codeFontSize(worst)).toBeLessThanOrEqual(11);
  });
  it("estimateLines / reserveHeight are sane", () => {
    expect(estimateLines("one two three", 40)).toBe(1);
    expect(estimateLines("word ".repeat(40).trim(), 20)).toBeGreaterThan(5);
    expect(reserveHeight("hi", 16)).toBeGreaterThan(16);
  });
  it("fraction clamps", () => {
    expect(fraction(50, 0, 100)).toBe(0.5);
    expect(fraction(-5, 0, 100)).toBe(0);
    expect(fraction(500, 0, 100)).toBe(1);
    expect(fraction(3, 3, 3)).toBe(0);
  });
  it("sparkPoints spans the box", () => {
    const pts = sparkPoints([1, 5, 3], 100, 32, 2);
    expect(pts).toHaveLength(3);
    expect(pts[0].x).toBe(2);
    expect(pts[2].x).toBe(98);
    expect(pts[1].y).toBe(2);       // max at the top
    expect(pts[0].y).toBe(30);      // min at the bottom
  });
});

// ── sentence pieces ─────────────────────────────────────────────────────────

/** Every string the schema-max rulers carry, at any depth. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringsIn(v, out);
  return out;
}

const FIXTURES = [
  "",
  " ",
  "   ",
  "hello",
  "hello.",
  "hello. ",
  "hello.  ",
  " hello. there",
  "one. two.",
  "one.two",
  "one!two",
  "no! yes? maybe.",
  "it caches. that is the whole trick.",
  "we hit today's budget. resets at midnight. go touch grass, legend.",
  "e.g. redis answers before postgres wakes up.",
  "pick one, e.g. redis. then measure it.",
  "i.e. the answer was already there.",
  "redis vs. postgres is the wrong fight.",
  "3.5ms is not fast. 0.2ms is.",
  "it costs 1.2M requests a day.",
  "the U.S. market opened flat.",
  "Dr. Smith shipped it on a Friday.",
  "approx. nine minutes of nothing.",
  "wait... really?",
  "wait… really?",
  "he said \"stop.\" then left.",
  "she asked (why?) and nobody answered.",
  "one sentence with a trailing space ",
  "\nleading newline. and a second one.\n",
  "two\nlines. same idea.",
  "a. big deal",
  "the answer is A. the question was worse.",
  "cache hit rate went to 99.9%. the pager stayed quiet.",
  "why? because the answer was already warm.",
  "!!!",
  "...",
  ". ",
  " . ",
  "`code. inside` a span. then more.",
  "ends with an ellipsis…",
  "ends with an exclamation!",
  "ends with a question?",
  "1,234,567 requests. every second.",
  "$0.02 per call. that is the whole bill.",
  "et al. wrote it up in 1998.",
  "no. that is not what happened.",
  "emoji 🔥 still splits. right here.",
  "über. straße. done.",
];

describe("cards helpers: splitSentences", () => {
  const all = [...FIXTURES, ...stringsIn(WORST_CARDS)];

  it("rejoins byte for byte and never emits an empty piece", () => {
    expect(all.length).toBeGreaterThan(40);
    for (const text of all) {
      const pieces = splitSentences(text);
      expect(pieces.join(""), JSON.stringify(text)).toBe(text);
      for (const p of pieces) expect(p.length, JSON.stringify(text)).toBeGreaterThan(0);
      if (text.length === 0) expect(pieces).toEqual([]);
      else expect(pieces.length).toBeGreaterThan(0);
    }
  });

  it("splits on sentence ends, whitespace and all", () => {
    expect(splitSentences("one. two.")).toEqual(["one. ", "two."]);
    expect(splitSentences("no! yes? maybe.")).toEqual(["no! ", "yes? ", "maybe."]);
    expect(splitSentences("it caches. that is the whole trick.")).toEqual(["it caches. ", "that is the whole trick."]);
    expect(splitSentences("one sentence with a trailing space ")).toEqual(["one sentence with a trailing space "]);
    expect(splitSentences("two\nlines. same idea.")).toEqual(["two\nlines. ", "same idea."]);
  });

  it("does not break mid-thought on abbreviations, initialisms or decimals", () => {
    expect(splitSentences("pick one, e.g. redis. then measure it.")).toEqual(["pick one, e.g. redis. ", "then measure it."]);
    expect(splitSentences("redis vs. postgres is the wrong fight.")).toHaveLength(1);
    expect(splitSentences("the U.S. market opened flat.")).toHaveLength(1);
    expect(splitSentences("Dr. Smith shipped it on a Friday.")).toHaveLength(1);
    expect(splitSentences("3.5ms is not fast. 0.2ms is.")).toEqual(["3.5ms is not fast. ", "0.2ms is."]);
    expect(splitSentences("cache hit rate went to 99.9%. the pager stayed quiet.")).toHaveLength(2);
  });

  it("keeps the closing punctuation with its sentence", () => {
    expect(splitSentences("he said \"stop.\" then left.")).toEqual(["he said \"stop.\" ", "then left."]);
    expect(splitSentences("wait... really?")).toEqual(["wait... ", "really?"]);
  });
});
