import { describe, expect, it } from "vitest";
import { compile, evaluate, formatOutput, parse, sampleCurve, tokenize } from "@/lib/expr";

describe("expr: tokenize/parse", () => {
  it("tokenizes numbers, identifiers, operators", () => {
    expect(tokenize("2*x + sqrt(4)").map((t) => t.k)).toEqual(["num", "op", "id", "op", "id", "lp", "num", "rp"]);
  });
  it("accepts ** as ^", () => {
    expect(evaluate("2 ** 3", 0)).toBe(8);
  });
  it("rejects unknown identifiers and characters", () => {
    expect(() => parse("y + 1")).toThrow();
    expect(() => parse("x; 1")).toThrow();
    expect(() => parse("window.alert(1)")).toThrow();
    expect(() => parse("x[0]")).toThrow();
    expect(compile("foo(x)")).toBeNull();
  });
  it("rejects trailing / unbalanced input", () => {
    expect(() => parse("(1 + 2")).toThrow();
    expect(() => parse("1 + 2)")).toThrow();
    expect(() => parse("1 2")).toThrow();
    expect(() => parse("")).toThrow();
  });
});

describe("expr: evaluate", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluate("1 + 2 * 3", 0)).toBe(7);
    expect(evaluate("(1 + 2) * 3", 0)).toBe(9);
    expect(evaluate("10 / 4", 0)).toBe(2.5);
    expect(evaluate("10 % 4", 0)).toBe(2);
    expect(evaluate("2 - 3 - 4", 0)).toBe(-5);
    expect(evaluate("8 / 2 / 2", 0)).toBe(2);
  });
  it("^ is right-associative and binds tighter than unary minus", () => {
    expect(evaluate("2 ^ 3 ^ 2", 0)).toBe(512);
    expect(evaluate("-2 ^ 2", 0)).toBe(-4);
    expect(evaluate("2 ^ -1", 0)).toBe(0.5);
    expect(evaluate("(-2) ^ 2", 0)).toBe(4);
  });
  it("substitutes x", () => {
    expect(evaluate("(1 - x/100) * 1000", 90)).toBeCloseTo(100);
    expect(evaluate("x", 3.5)).toBe(3.5);
    expect(evaluate("X * 2", 4)).toBe(8);
  });
  it("supports the function whitelist", () => {
    expect(evaluate("sqrt(16)", 0)).toBe(4);
    expect(evaluate("log(1000)", 0)).toBeCloseTo(3);
    expect(evaluate("log(8, 2)", 0)).toBeCloseTo(3);
    expect(evaluate("ln(e)", 0)).toBeCloseTo(1);
    expect(evaluate("exp(0)", 0)).toBe(1);
    expect(evaluate("abs(-3)", 0)).toBe(3);
    expect(evaluate("min(3, 1, 2)", 0)).toBe(1);
    expect(evaluate("max(3, 1, 2)", 0)).toBe(3);
    expect(evaluate("pow(2, 10)", 0)).toBe(1024);
    expect(evaluate("floor(2.7)", 0)).toBe(2);
    expect(evaluate("ceil(2.1)", 0)).toBe(3);
    expect(evaluate("round(2.5)", 0)).toBe(3);
    expect(evaluate("sin(0)", 0)).toBe(0);
    expect(evaluate("cos(0)", 0)).toBe(1);
    expect(evaluate("cos(pi)", 0)).toBeCloseTo(-1);
  });
  it("returns NaN instead of throwing on bad input", () => {
    expect(evaluate("garbage((", 1)).toBeNaN();
    expect(evaluate("sqrt(-1)", 1)).toBeNaN();
    expect(evaluate("pow(2)", 1)).toBeNaN();
    expect(evaluate("1/0", 1)).toBe(Infinity);
  });
  it("compile caches and returns a reusable function", () => {
    const f = compile("x * 2");
    expect(f).not.toBeNull();
    expect(f!(21)).toBe(42);
    expect(compile("x * 2")).toBe(f);
  });
});

describe("expr: formatOutput", () => {
  it("shows an em dash for non-finite", () => {
    expect(formatOutput(NaN, "number")).toBe("—");
    expect(formatOutput(Infinity, "int")).toBe("—");
  });
  it("number / int with separators", () => {
    expect(formatOutput(1234.567, "number")).toBe("1,234.6");
    expect(formatOutput(0.12345, "number")).toBe("0.123");
    expect(formatOutput(1234.567, "int")).toBe("1,235");
    expect(formatOutput(-1234.5, "int")).toBe("-1,235");
    expect(formatOutput(1000000, "int", "/s")).toBe("1,000,000/s");
  });
  it("percent expects percent units and dedupes the unit", () => {
    expect(formatOutput(90, "percent")).toBe("90%");
    expect(formatOutput(90, "percent", "%")).toBe("90%");
    expect(formatOutput(2.5, "percent")).toBe("2.5%");
    expect(formatOutput(12.4, "percent")).toBe("12%");
  });
  it("currency", () => {
    expect(formatOutput(1234.5, "currency")).toBe("$1,234.50");
    expect(formatOutput(1000, "currency")).toBe("$1,000");
    expect(formatOutput(2_500_000, "currency")).toBe("$2.5M");
    expect(formatOutput(-3, "currency")).toBe("-$3");
  });
  it("ms scales into s / min / h", () => {
    expect(formatOutput(0.25, "ms")).toBe("0.25ms");
    expect(formatOutput(12, "ms")).toBe("12ms");
    expect(formatOutput(1500, "ms")).toBe("1.5s");
    expect(formatOutput(90_000, "ms")).toBe("1.5min");
    expect(formatOutput(7_200_000, "ms")).toBe("2h");
  });
  it("compact", () => {
    expect(formatOutput(1234, "compact")).toBe("1.2K");
    expect(formatOutput(3_400_000, "compact")).toBe("3.4M");
    expect(formatOutput(42, "compact")).toBe("42");
    expect(formatOutput(1234, "compact", "req")).toBe("1.2K req");
  });
  it("hugs short units and spaces long ones", () => {
    expect(formatOutput(12, "int", "ms")).toBe("12ms");
    expect(formatOutput(12, "int", "%")).toBe("12%");
    expect(formatOutput(12, "int", "users")).toBe("12 users");
  });
});

describe("expr: sampleCurve", () => {
  it("walks the range and normalises into a unit box", () => {
    const pts = sampleCurve("x", 0, 100, 5)!;
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[4]).toEqual({ x: 1, y: 1 });
    expect(pts[2].x).toBeCloseTo(0.5);
    expect(pts[2].y).toBeCloseTo(0.5);
  });
  it("normalises against the samples, not the raw numbers", () => {
    const pts = sampleCurve("1000 - 10 * x", 0, 100, 3)!;
    expect(pts.map((p) => p.y)).toEqual([1, 0.5, 0]);
  });
  it("puts a flat curve down the middle", () => {
    expect(sampleCurve("7", 0, 10, 4)!.map((p) => p.y)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it("returns null instead of throwing, whatever the writer wrote", () => {
    expect(sampleCurve("y + 1", 0, 10, 8)).toBeNull();          // unparseable
    expect(sampleCurve("window.alert(1)", 0, 10, 8)).toBeNull();
    expect(sampleCurve("1 / x", 0, 10, 8)).toBeNull();          // divide by zero inside the range
    expect(sampleCurve("1 / (x - 5)", 0, 10, 11)).toBeNull();
    expect(sampleCurve("ln(x)", 0, 10, 8)).toBeNull();          // -Infinity at the edge
    expect(sampleCurve("sqrt(x)", -10, 10, 8)).toBeNull();      // NaN inside the range
    expect(sampleCurve("x", 5, 5, 8)).toBeNull();               // no width
    expect(sampleCurve("x", 0, Infinity, 8)).toBeNull();
    expect(sampleCurve("x", Number.NaN, 10, 8)).toBeNull();
    expect(sampleCurve("x", 0, 10, 1)).toBeNull();
    expect(sampleCurve("x", 0, 10, 0)).toBeNull();
    expect(sampleCurve("x", 0, 10, -4)).toBeNull();
    expect(sampleCurve("x", 0, 10, 10_000)).toBeNull();
    expect(sampleCurve("x", 0, 10, Number.NaN)).toBeNull();
  });
  it("handles a descending range and the slider's own formula", () => {
    const down = sampleCurve("x", 100, 0, 3)!;
    expect(down.map((p) => p.y)).toEqual([1, 0.5, 0]);
    const qps = sampleCurve("10000 * (1 - x / 100)", 0, 100, 6)!;
    expect(qps).toHaveLength(6);
    expect(qps[0].y).toBe(1);
    expect(qps[5].y).toBe(0);
    qps.forEach((p) => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1); });
  });
});
