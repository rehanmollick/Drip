import { describe, expect, it } from "vitest";
import {
  codeFontSize, estimateCodeRows, estimateLines, fitFontSize, fraction, hashString, hexAddress,
  reserveHeight, sameOrder, seededRandom, shuffleDeterministic, sparkPoints,
} from "@/components/cards/helpers";

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
