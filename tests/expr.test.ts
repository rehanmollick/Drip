import { describe, expect, it } from "vitest";
import { compile, evaluate, formatOutput, parse, tokenize } from "@/lib/expr";

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
