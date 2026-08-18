import { beforeAll, describe, expect, it } from "vitest";
import { DEAD_PHRASES_HARD, findDeadPhraseInValue, findStyleProblem, isLabelEyebrow } from "@/lib/copy/style";
import { DEV_CARDS } from "@/lib/feed/dev";
import { WORST_CARDS } from "@/lib/feed/worst";
import { corpusTerms, qualityDirectives, scoreBatch } from "@/lib/generation/quality";
import { cardsSchemaFor, salvageCards } from "@/lib/llm";
import { buildWriteSystem } from "@/lib/prompts/write";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import { WRITER_CARD_TYPES, type Card } from "@/lib/schemas/cards";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { CORPUS, PERSONA, detourCtx, planInput, wrapCtx, writeCtx } from "./llm.fixtures.test";

process.env.LLM_MOCK_LATENCY_MS = "0";

const schema = cardsSchemaFor(WRITER_CARD_TYPES);
const concept = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), type: "concept", topicNodeId: "n1", detourId: null,
  headline: "a cache is a bet on repetition", body: "ask the fast thing first. on a miss, pay the slow thing once.", ...over,
});

describe("the hard gate", () => {
  it("rejects a card carrying a dead phrase, and says which phrase and where", () => {
    const r = schema.safeParse({ cards: [concept({ body: "the ttl plays a key role in how stale an answer gets." })] });
    expect(r.success).toBe(false);
    if (r.success) return;
    const message = r.error.issues.map((i) => i.message).join("\n");
    expect(message).toContain("plays a key role");
    expect(message).toContain("$.body");
    expect(r.error.issues.some((i) => i.path.join(".") === "cards.0.body")).toBe(true);
  });

  it("rejects every phrase on the hard list, wherever it sits on the card", () => {
    for (const phrase of DEAD_PHRASES_HARD) {
      expect(schema.safeParse({ cards: [concept({ headline: `the buffer ${phrase} it` })] }).success).toBe(false);
    }
  });

  it("rejects an eyebrow that files the card, keeps one that names it", () => {
    expect(schema.safeParse({ cards: [concept({ eyebrow: "overview" })] }).success).toBe(false);
    expect(schema.safeParse({ cards: [concept({ eyebrow: "part 2" })] }).success).toBe(false);
    expect(schema.safeParse({ cards: [concept({ eyebrow: "the footgun" })] }).success).toBe(true);
    expect(schema.safeParse({ cards: [concept()] }).success).toBe(true); // no eyebrow at all is fine
  });

  it("a binary with no eyebrow still passes", () => {
    const binary = {
      id: crypto.randomUUID(), type: "binary", topicNodeId: "n1", detourId: null,
      prompt: "an empty cache is a quiet morning for the database", options: ["nope", "yep"],
      correctIndex: 0, revealCopy: "every ask misses at once. the database gets all of it in one breath.", difficulty: 2,
    };
    expect(schema.safeParse({ cards: [binary] }).success).toBe(true);
  });

  it("leaves the reader's own words alone: an eyebrow like 'the part everyone skips' is not a label", () => {
    expect(isLabelEyebrow("the part everyone skips")).toBe(false);
    expect(isLabelEyebrow("field notes")).toBe(false);
    expect(isLabelEyebrow("0x00")).toBe(false);
    expect(isLabelEyebrow("Overview:")).toBe(true);
    expect(isLabelEyebrow("step one")).toBe(true);
    expect(isLabelEyebrow("3 of 5")).toBe(true);
  });

  it("never reads a non-copy key — a code body may say whatever it says", () => {
    const code = {
      id: crypto.randomUUID(), type: "code", topicNodeId: "n1", detourId: null, lang: "ts",
      code: "// this function is responsible for the ttl\nconst ttl = 60;", annotations: [],
    };
    expect(schema.safeParse({ cards: [code] }).success).toBe(true);
    expect(findDeadPhraseInValue({ anchor: "is responsible for" })).toBeNull();
  });

  it("switches off with DRIP_STYLE_GATE=off, without a deploy", () => {
    const card = concept({ body: "the ttl plays a key role here." });
    process.env.DRIP_STYLE_GATE = "off";
    try {
      expect(schema.safeParse({ cards: [card] }).success).toBe(true);
    } finally {
      delete process.env.DRIP_STYLE_GATE;
    }
    expect(schema.safeParse({ cards: [card] }).success).toBe(false);
  });
});

describe("salvage absorbs a hit", () => {
  it("keeps 3 of 4 when exactly one card trips the gate", () => {
    const parsed = { cards: [concept(), concept({ body: "the buffer serves as a mechanism for writes." }), concept(), concept()] };
    const r = salvageCards(parsed, schema, 4);
    expect(r).not.toBeNull();
    expect(r!.dropped).toBe(1);
    expect(r!.value.cards).toHaveLength(3);
  });
});

describe("corpusTerms", () => {
  const FERMENT = `
    Bread flour is mostly starch, but the part that matters is the gluten. Gluten is two proteins that
    only become gluten once water shows up and you start mixing the dough.

    The autolyse is a rest before the salt goes in. During the autolyse the flour hydrates on its own
    and the dough comes together with far less work.

    Temperature runs the whole thing. A dough at a warm temperature ferments fast; the same dough at a
    cold temperature takes all night. Bakers talk about the desired dough temperature for exactly this.
  `;
  const terms = corpusTerms(FERMENT, { minCount: 2 });

  it("finds the words the source has to teach", () => {
    expect(terms.has("gluten")).toBe(true);
    expect(terms.has("autolyse")).toBe(true);
  });

  it("does not flag the words everyone walked in with", () => {
    expect(terms.has("dough")).toBe(false);
    expect(terms.has("flour")).toBe(false);
    expect(terms.has("temperature")).toBe(false);
  });
});

describe("the jargon governor", () => {
  const terms = new Set(["gluten", "autolyse"]);
  const card = (over: Record<string, unknown>) => concept(over) as unknown as Card;

  it("counts a domain word used with nothing to tap", () => {
    const s = scoreBatch({ batch: [card({ body: "the autolyse is a rest before the salt." })], terms });
    expect(s.unintroduced).toEqual(["autolyse"]);
  });

  it("counts nothing once the card glosses it", () => {
    const s = scoreBatch({
      batch: [card({ body: "the autolyse is a rest before the salt.", terms: [{ term: "autolyse", gloss: "a rest with just flour and water, before the salt" }] })],
      terms,
    });
    expect(s.unintroduced).toEqual([]);
  });

  it("does not count a word introduced earlier in the session", () => {
    const s = scoreBatch({ batch: [card({ body: "gluten again." })], terms, introduced: ["gluten"] });
    expect(s.unintroduced).toEqual([]);
  });

  it("names the words verbatim once the pressure is on, and never before", () => {
    const soft = qualityDirectives({ unintroduced: ["gluten", "autolyse"], pressure: 1 }).join(" ");
    const hard = qualityDirectives({ unintroduced: ["gluten", "autolyse"], pressure: 2 }).join(" ");
    expect(soft).not.toContain("autolyse");
    expect(hard).toContain(`"gluten"`);
    expect(hard).toContain(`"autolyse"`);
  });

  it("never drops a card — it only measures", () => {
    const batch = [card({ body: "autolyse and gluten and autolyse." }), card({ body: "more gluten." })];
    const s = scoreBatch({ batch, terms });
    expect(s.cards).toBe(2);
    expect(batch).toHaveLength(2);
  });
});

// ── the sweep that protects the e2e suite ────────────────────────────────────

type Mock = typeof import("@/lib/llm-mock");
let m: Mock;
beforeAll(async () => {
  m = await import("@/lib/llm-mock");
});

const clean = (cards: readonly unknown[], where: string) => {
  const hits = cards.map((c) => findStyleProblem(c)).filter(Boolean);
  expect(hits, `${where}: ${JSON.stringify(hits)}`).toEqual([]);
};

describe("the fixtures the feed actually ships", () => {
  it("sample cards, dev cards and the schema-max fixtures are clean", () => {
    clean(SAMPLE_CARDS, "sample");
    clean(DEV_CARDS, "dev");
    clean(WORST_CARDS, "worst");
  });

  it("every card the mock can produce is clean — this is what keeps the e2e suite green", async () => {
    const plan = await m.mockPlan(planInput());
    expect(plan.ok).toBe(true);
    if (plan.ok) clean(plan.value.firstCards, "mock plan");

    for (const mode of ["normal", "teaser", "resurface", "adjacent", "recap", "scaffold"] as const) {
      const r = await m.mockWriteBatch(writeCtx({ mode, node: mode === "resurface" || mode === "adjacent" ? null : writeCtx().node, missedConcepts: ["stampedes"] }));
      expect(r.ok, mode).toBe(true);
      if (r.ok) clean(r.value, `mock write ${mode}`);
    }

    const detour = await m.mockWriteDetour(detourCtx());
    expect(detour.ok).toBe(true);
    if (detour.ok) clean(detour.value, "mock detour");

    // the mock stitches the subject into its copy, so a clean caching fixture proves nothing on its own
    for (const subject of ["tide pools and kelp", "orbital mechanics", "sourdough starters", "the fed", "compilers"]) {
      const p = await m.mockPlan(planInput({ sourceKind: "sentence", sourceText: subject }));
      expect(p.ok, subject).toBe(true);
      if (p.ok) clean(p.value.firstCards, `mock plan "${subject}"`);
      const w = await m.mockWriteBatch(writeCtx({ corpusSlice: subject, node: { id: "n1", title: subject, estCards: 4, dependsOn: [], brief: `land what ${subject} is`, corpusHint: "opening" } }));
      expect(w.ok, subject).toBe(true);
      if (w.ok) clean(w.value, `mock write "${subject}"`);
    }

    const wrap = await m.mockWriteWrap(wrapCtx());
    expect(wrap.ok).toBe(true);
    if (wrap.ok) clean([wrap.value], "mock wrap");
  });

  it("the writer's own system prompt does not model the thing it forbids", () => {
    const system = buildWriteSystem(PERSONA, SAMPLE_THEME_TERMINAL_NOIR, WRITER_CARD_TYPES);
    expect(findDeadPhraseInValue({ system })).toBeNull();
    for (const [, eyebrow] of system.matchAll(/"eyebrow"\s*:\s*"([^"]*)"/g)) {
      expect(isLabelEyebrow(eyebrow), `system prompt eyebrow "${eyebrow}"`).toBe(false);
    }
  });

  it("the corpus the fixtures teach from is not itself dead prose", () => {
    expect(findDeadPhraseInValue({ corpus: CORPUS })).toBeNull();
  });
});
