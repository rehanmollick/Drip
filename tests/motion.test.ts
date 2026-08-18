import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CASCADE_FADE_MS, CASCADE_MAX_MS, REDUCED_FADE, cascade, cascadeStep, drawIn, growIn,
} from "@/lib/motion";
import { countTo } from "@/components/cards/helpers";
import { LiteralOdometer, Odometer } from "@/components/ui/Odometer";

const SPRING = { type: "spring", stiffness: 420, damping: 32 } as const;

/** Everything a variant asks for except the transition — i.e. what actually moves. */
function moved(v: unknown): Record<string, unknown> {
  const rest = { ...(v as Record<string, unknown>) };
  delete rest.transition;
  return rest;
}

describe("motion: cascade", () => {
  it("items animate opacity and nothing else (inline spans must not transform)", () => {
    for (const reduced of [false, true]) {
      const { item } = cascade(reduced, 60, 5);
      expect(Object.keys(moved(item.hidden))).toEqual(["opacity"]);
      expect(Object.keys(moved(item.show))).toEqual(["opacity"]);
      expect(moved(item.hidden).opacity).toBe(0);
      expect(moved(item.show).opacity).toBe(1);
    }
  });

  it("the whole cascade lands inside CASCADE_MAX_MS however many pieces there are", () => {
    for (const step of [30, 60, 90, 200]) {
      for (let count = 1; count <= 40; count++) {
        const gap = cascadeStep(step, count);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(step);
        expect((count - 1) * gap + CASCADE_FADE_MS).toBeLessThanOrEqual(CASCADE_MAX_MS + 1e-9);
      }
    }
  });

  it("keeps the asked-for gap while there is room for it", () => {
    expect(cascadeStep(60, 1)).toBe(0);
    expect(cascadeStep(60, 2)).toBe(60);
    expect(cascadeStep(60, 4)).toBe(60);
    expect(cascadeStep(60, 12)).toBeLessThan(60);
    expect(cascade(false, 60, 4).container.show).toEqual({ transition: { staggerChildren: 0.06 } });
  });

  it("reduced motion drops the stagger entirely: nothing waits its turn", () => {
    const { container, item } = cascade(true, 60, 9);
    expect(container.show).toEqual({ transition: { staggerChildren: 0 } });
    expect((item.show as { transition: unknown }).transition).toEqual(REDUCED_FADE);
  });
});

describe("motion: growIn", () => {
  it("grows from nothing to `to` along one axis, from the right edge", () => {
    const x = growIn(0.62, SPRING);
    expect(moved(x.hidden)).toEqual({ scaleX: 0, opacity: 1, transformOrigin: "left center" });
    expect(moved(x.show)).toEqual({ scaleX: 0.62, opacity: 1, transformOrigin: "left center" });

    const y = growIn(1, SPRING, false, { axis: "y" });
    expect(moved(y.hidden)).toEqual({ scaleY: 0, opacity: 1, transformOrigin: "center bottom" });
    expect(moved(y.show).scaleY).toBe(1);
  });

  it("takes delay in ms and hands framer seconds", () => {
    const t = (growIn(1, SPRING, false, { delay: 120 }).show as { transition: { delay: number } }).transition;
    expect(t.delay).toBeCloseTo(0.12);
  });

  it("reduced motion is full size from the first frame, opacity does the arriving", () => {
    const v = growIn(0.62, SPRING, true, { delay: 200 });
    expect(moved(v.hidden).scaleX).toBe(0.62);
    expect(moved(v.show).scaleX).toBe(0.62);
    expect((v.show as { transition: { delay?: number } }).transition).toEqual(REDUCED_FADE);
  });
});

describe("motion: drawIn", () => {
  it("draws the stroke from 0 to whole", () => {
    const v = drawIn(SPRING, false, { duration: 800, delay: 100 });
    expect(moved(v.hidden).pathLength).toBe(0);
    expect(moved(v.show).pathLength).toBe(1);
    expect((v.show as { transition: { duration: number; delay: number } }).transition).toEqual({
      duration: 0.8, ease: "easeOut", delay: 0.1,
    });
  });

  it("falls back to the theme spring when no duration is given", () => {
    const t = (drawIn(SPRING).show as { transition: Record<string, unknown> }).transition;
    expect(t.stiffness).toBe(420);
  });

  it("reduced motion starts already drawn", () => {
    const v = drawIn(SPRING, true, { duration: 800, delay: 300 });
    expect(moved(v.hidden).pathLength).toBe(1);
    expect(moved(v.show).pathLength).toBe(1);
    expect((v.show as { transition: unknown }).transition).toEqual(REDUCED_FADE);
  });
});

// ── the odometer's count plan ───────────────────────────────────────────────

const COUNTABLE = ["1.2M", "10x", "$0.02", "80%", "3ms", "1,234,567ms", "12 req", "1.5", "300k", "-40%"];

describe("odometer: counting up to an authored value", () => {
  it("settles on the authored string byte for byte", () => {
    for (const value of COUNTABLE) {
      const c = countTo(value);
      expect(c, value).not.toBeNull();
      expect(c!.at(c!.to)).toBe(value);
      expect(c!.at(c!.to * 1.5)).toBe(value);        // an overshooting spring still lands clean
      expect(c!.at(c!.to - c!.to * 1e-12)).toBe(value); // …and so does one that stops a hair short
    }
  });

  it("keeps the writer's shape on every frame in between", () => {
    expect(countTo("1.2M")!.at(0)).toBe("0.0M");
    expect(countTo("1.2M")!.at(0.6)).toBe("0.6M");
    expect(countTo("$0.02")!.at(0)).toBe("$0.00");
    expect(countTo("$0.02")!.at(0.01)).toBe("$0.01");
    expect(countTo("10x")!.at(0)).toBe("0x");
    expect(countTo("10x")!.at(4)).toBe("4x");
    expect(countTo("80%")!.at(20)).toBe("20%");
    expect(countTo("1,234,567ms")!.at(456001)).toBe("456,001ms");
    expect(countTo("12 req")!.at(3)).toBe("3 req");
    expect(countTo("-40%")!.at(0)).toBe("-0%");
  });

  it("never counts below zero", () => {
    expect(countTo("80%")!.at(-999)).toBe("0%");
  });

  it("refuses anything it can't count honestly", () => {
    for (const value of ["~3", "≈3", "<1ms", ">99%", "3/5", "n/a", "many", "0", "0.00", "1.2.3", "", "  ", "080%", "3+"]) {
      expect(countTo(value), value).toBeNull();
    }
  });
});

describe("odometer: what paints", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("paints an uncountable value at once — never a stuck 0", () => {
    const out = html(createElement(LiteralOdometer, { value: "~3" }));
    expect(out).toContain("~3");
    expect(out).not.toMatch(/>0</);
  });

  it("a card already under the thumb renders landed, not mid-roll", () => {
    expect(html(createElement(LiteralOdometer, { value: "1.2M", entered: true }))).toContain("1.2M");
    expect(html(createElement(LiteralOdometer, { value: "$0.02", entered: true }))).toContain("$0.02");
    expect(html(createElement(LiteralOdometer, { value: "10x", entered: true }))).toContain("10x");
  });

  it("a card still off-screen starts at the bottom of the roll", () => {
    expect(html(createElement(LiteralOdometer, { value: "1.2M", entered: false }))).toContain("0.0M");
  });

  it("reduced motion skips the roll", () => {
    expect(html(createElement(LiteralOdometer, { value: "1.2M", entered: false, reduced: true }))).toContain("1.2M");
  });

  it("the authored string is what a screen reader gets", () => {
    expect(html(createElement(LiteralOdometer, { value: "1.2M", entered: false }))).toContain("sr-only");
  });

  it("the live odometer formats through lib/expr", () => {
    expect(html(createElement(Odometer, { value: 1234.5, format: "int", unit: "/s" }))).toContain("1,235/s");
    expect(html(createElement(Odometer, { value: Number.NaN, format: "int" }))).toContain("—");
  });
});
