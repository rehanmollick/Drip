import { describe, expect, it } from "vitest";
import { parseStatValue, statBars, statFontSize } from "@/components/cards/helpers";
import { SAMPLE_CARDS_V2 } from "@/lib/feed/dev";
import { WORST_CARDS } from "@/lib/feed/worst";
import { StatCard } from "@/lib/schemas/cards";

describe("stat card: parseStatValue", () => {
  it("reads plain numbers, percents and units", () => {
    expect(parseStatValue("80%")).toEqual({ n: 80, unit: "%" });
    expect(parseStatValue("0.2ms")).toEqual({ n: 0.2, unit: "ms" });
    expect(parseStatValue("20 ms")).toEqual({ n: 20, unit: "ms" });
    expect(parseStatValue("42")).toEqual({ n: 42, unit: "" });
    expect(parseStatValue("$4.5")).toEqual({ n: 4.5, unit: "" });
  });

  it("folds k/M/B magnitudes into the number so they compare", () => {
    expect(parseStatValue("1.2M")).toEqual({ n: 1_200_000, unit: "" });
    expect(parseStatValue("300k")).toEqual({ n: 300_000, unit: "" });
    expect(parseStatValue("1,234,567")).toEqual({ n: 1_234_567, unit: "" });
  });

  it("does not mistake a unit starting with m for a magnitude", () => {
    expect(parseStatValue("3ms")).toEqual({ n: 3, unit: "ms" });
    expect(parseStatValue("7mb")).toEqual({ n: 7, unit: "mb" });
  });

  it("returns null for things that aren't numbers", () => {
    expect(parseStatValue("plenty")).toBeNull();
    expect(parseStatValue("")).toBeNull();
    expect(parseStatValue("1.2.3")).toBeNull();
  });
});

describe("stat card: statBars", () => {
  it("scales both bars against the bigger number", () => {
    expect(statBars("20ms", "10ms")).toEqual({ value: 1, compare: 0.5 });
    expect(statBars("50%", "100%")).toEqual({ value: 0.5, compare: 1 });
  });

  it("keeps a visible sliver when the gap is enormous", () => {
    const b = statBars("0.2ms", "20ms");
    expect(b).not.toBeNull();
    expect(b!.compare).toBe(1);
    expect(b!.value).toBeGreaterThan(0);
    expect(b!.value).toBeLessThan(0.1);
  });

  it("refuses to draw bars for values that aren't comparable", () => {
    expect(statBars("80%", "1.2M")).toBeNull();     // different units
    expect(statBars("fast", "20ms")).toBeNull();    // unparseable
    expect(statBars("0ms", "20ms")).toBeNull();     // zero has no scale
  });
});

describe("stat card: statFontSize", () => {
  it("shrinks as the number (plus its unit) gets longer", () => {
    const short = statFontSize("7");
    const mid = statFontSize("0.2", "ms");
    const worst = statFontSize("1,234,567ms", "queries/sec");
    expect(short).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(worst);
    expect(worst).toBeGreaterThanOrEqual(40);
  });

  it("keeps the schema-max number inside the 393px card width", () => {
    // 393 − 2×24 frame padding = 345px of content; display digits run ~0.58em
    const CONTENT = 345;
    const width = (chars: number, fs: number) => chars * fs * 0.58;
    for (const len of [1, 3, 6, 8, 10, 12]) {
      const value = "x".repeat(len);
      const fs = statFontSize(value, "x".repeat(12));
      expect(width(len, fs), `value of ${len} chars at ${fs}px`).toBeLessThanOrEqual(CONTENT);
    }
    // the unit rides beside the number and is allowed to wrap under it, but never past two lines
    const fsWorst = statFontSize("x".repeat(12), "x".repeat(12));
    expect(width(12 + 12 * 0.42, fsWorst)).toBeLessThanOrEqual(CONTENT * 2);
  });
});

describe("stat card fixtures", () => {
  it("the sample and the ruler both validate as stat cards", () => {
    const stats = [...SAMPLE_CARDS_V2, ...WORST_CARDS].filter((c) => c.type === "stat");
    expect(stats.length).toBe(2);
    for (const s of stats) expect(StatCard.safeParse(s).success).toBe(true);
  });

  it("the sample stat has a comparison the renderer can actually draw", () => {
    const s = SAMPLE_CARDS_V2.find((c) => c.type === "stat");
    expect(s && s.type === "stat" && s.compare).toBeTruthy();
    if (s && s.type === "stat" && s.compare) {
      expect(statBars(`${s.value}${s.unit ?? ""}`, s.compare.value)).not.toBeNull();
    }
  });
});
