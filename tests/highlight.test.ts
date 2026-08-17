import { describe, expect, it } from "vitest";
import { highlightCard, highlightCards, plainLines, resolveLang } from "@/lib/highlight";
import type { CodeCard } from "@/lib/schemas/cards";
import { CardSchema } from "@/lib/schemas/cards";

const base = (over: Partial<CodeCard>): CodeCard => ({
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a04",
  type: "code",
  topicNodeId: "n1",
  detourId: null,
  lang: "ts",
  code: `const x = 1; // one\nfunction f() {\n  return "hi";\n}`,
  annotations: [],
  ...over,
});

describe("highlight", () => {
  it("resolves aliases and unknown langs", () => {
    expect(resolveLang("TypeScript")).toBe("ts");
    expect(resolveLang("py")).toBe("python");
    expect(resolveLang("c++")).toBe("cpp");
    expect(resolveLang("klingon")).toBeNull();
    expect(resolveLang("text")).toBeNull();
  });

  it("emits css-variable colors per token, one array per line", async () => {
    const out = await highlightCard(base({}));
    expect(out.highlighted).toBeDefined();
    expect(out.highlighted!.length).toBe(4);
    // text round-trips exactly
    expect(out.highlighted!.map((l) => l.map((t) => t.t).join("")).join("\n")).toBe(out.code);
    const colors = out.highlighted!.flat().map((t) => t.c).filter(Boolean) as string[];
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(c).toMatch(/^var\(--shiki-/);
    // still a valid card
    expect(CardSchema.safeParse(out).success).toBe(true);
    // input not mutated
    expect(base({}).highlighted).toBeUndefined();
  });

  it("falls back to plain tokens for unknown languages and never throws", async () => {
    const out = await highlightCard(base({ lang: "klingon", code: "a\n\nb" }));
    expect(out.highlighted).toEqual([[{ t: "a" }], [{ t: "" }], [{ t: "b" }]]);
    expect(plainLines("x")).toEqual([[{ t: "x" }]]);
  });

  it("handles a few bundled languages", async () => {
    for (const [lang, code] of [["python", "def f():\n    return 1"], ["sql", "select 1 from t;"], ["bash", "echo hi | grep h"], ["json", '{"a": 1}']] as const) {
      const out = await highlightCard(base({ lang, code }));
      expect(out.highlighted!.length).toBe(code.split("\n").length);
    }
  });

  it("highlightCards touches only code cards", async () => {
    const cards = [base({}), { id: "x", type: "hook", topicNodeId: "n1", detourId: null, headline: "h" }];
    const out = await highlightCards(cards);
    expect((out[0] as CodeCard).highlighted).toBeDefined();
    expect(out[1]).toBe(cards[1]);
  });
});
