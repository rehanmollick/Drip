import { describe, expect, it } from "vitest";
import { splitGlossed } from "@/components/cards/helpers";
import { CARD_SCHEMA_VERSION, CardSchema, WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import { SAMPLE_CARDS_V2 } from "@/lib/feed/dev";
import { WORST_CARDS } from "@/lib/feed/worst";

const T = (term: string, gloss = `what ${term} means`) => ({ term, gloss });
const joined = (text: string, terms: Parameters<typeof splitGlossed>[1]) =>
  splitGlossed(text, terms).map((s) => s.text).join("");
const glossed = (text: string, terms: Parameters<typeof splitGlossed>[1]) =>
  splitGlossed(text, terms).filter((s) => s.gloss).map((s) => s.text);

describe("inline glossary: splitGlossed", () => {
  it("returns the text untouched when there are no terms", () => {
    expect(splitGlossed("a cache is a bet", [])).toEqual([{ text: "a cache is a bet" }]);
    expect(splitGlossed("a cache is a bet")).toEqual([{ text: "a cache is a bet" }]);
    expect(splitGlossed("")).toEqual([]);
  });

  it("never loses or reorders a character", () => {
    const text = "A cache is a bet on repetition. The TTL is the countdown, and the cache expires.";
    for (const terms of [[T("cache")], [T("TTL")], [T("cache"), T("TTL")], [T("bet"), T("countdown")]]) {
      expect(joined(text, terms)).toBe(text);
    }
  });

  it("matches whole words only", () => {
    expect(glossed("the cached answer", [T("cached")])).toEqual(["cached"]);
    expect(glossed("the cached answer", [T("cache")])).toEqual([]);   // inflections aren't guessed
    expect(glossed("precache the row", [T("cache")])).toEqual([]);    // inside a longer word
    expect(glossed("business as usual", [T("bus")])).toEqual([]);
  });

  it("is case-insensitive but keeps the original casing", () => {
    expect(glossed("Redis holds it in Memory", [T("memory")])).toEqual(["Memory"]);
    expect(glossed("TTL expires", [T("ttl")])).toEqual(["TTL"]);
  });

  it("catches the plural the writer didn't", () => {
    expect(glossed("short TTLs shrink the window", [T("TTL")])).toEqual(["TTLs"]);
    expect(glossed("both caches disagree", [T("cache")])).toEqual(["caches"]);
    expect(glossed("the box's lid", [T("box")])).toEqual(["box's"]);
  });

  it("underlines the FIRST occurrence only", () => {
    const segs = splitGlossed("a cache is a cache is a cache", [T("cache")]);
    expect(segs.filter((s) => s.gloss)).toHaveLength(1);
    expect(segs[0]).toEqual({ text: "a " });
    expect(segs[1].text).toBe("cache");
  });

  it("never matches inside a code span", () => {
    expect(glossed("call `cache.get(key)` first", [T("cache")])).toEqual([]);
    expect(glossed("call `cache.get()` then the cache answers", [T("cache")])).toEqual(["cache"]);
  });

  it("resolves overlaps in favour of the earlier match", () => {
    const segs = splitGlossed("a cache miss is expensive", [T("cache miss"), T("cache")]);
    expect(segs.filter((s) => s.gloss).map((s) => s.text)).toEqual(["cache miss"]);
    expect(joined("a cache miss is expensive", [T("cache miss"), T("cache")])).toBe("a cache miss is expensive");
  });

  it("handles terms the writer wrote with punctuation or regex characters", () => {
    expect(glossed("an O(1) lookup", [T("O(1)")])).toEqual(["O(1)"]);
    expect(glossed("use cache-aside here", [T("cache-aside")])).toEqual(["cache-aside"]);
    expect(glossed("  spaced  ", [T("  spaced  ")])).toEqual(["spaced"]);
  });

  it("drops empty terms instead of matching everything", () => {
    expect(splitGlossed("some copy", [{ term: "   ", gloss: "x" }])).toEqual([{ text: "some copy" }]);
  });

  it("every fixture term actually lands in the copy it was attached to", () => {
    const copyOf = (c: { type: string } & Record<string, unknown>): string =>
      c.type === "concept" ? String(c.body)
      : c.type === "reveal" ? String(c.payoff)
      : c.type === "stat" ? String(c.context)
      : c.type === "open" ? `${String(c.prompt)} ${String(c.modelAnswer)}`
      // scrub underlines inside the frame captions, spot inside the payoff — those are the
      // strings the views actually run through <Glossed>, so those are the ones a term must land in
      : c.type === "scrub" ? (c.frames as { caption: string }[]).map((f) => f.caption).join(" ")
      : c.type === "spot" ? String(c.revealCopy)
      : "";
    const carriers = [...SAMPLE_CARDS_V2, ...WORST_CARDS].filter(
      (c) => "terms" in c && Array.isArray((c as { terms?: unknown[] }).terms) && (c as { terms: unknown[] }).terms.length > 0,
    );
    expect(carriers.length).toBeGreaterThan(3);
    for (const c of carriers) {
      const terms = (c as unknown as { terms: { term: string; gloss: string }[] }).terms;
      const text = copyOf(c as never);
      const hit = splitGlossed(text, terms).filter((s) => s.gloss).length;
      expect(hit, `${c.type} ${c.id}: no term matched its copy`).toBe(terms.length);
    }
  });
});

describe("inline glossary: the schema actually keeps terms", () => {
  const id = "00000000-0000-4000-8000-0000000000";
  const terms = [{ term: "eviction", gloss: "throwing something out to make room" }];

  /**
   * The prompt has always told the writer to fill "terms" on any card that uses a word a newcomer
   * wouldn't have. Zod only kept it on four types and silently dropped it everywhere else, so most
   * of the glossary the model wrote never reached a screen. These are the two that hurt most.
   */
  it("a diagram card round-trips with its terms intact", () => {
    const card = CardSchema.parse({
      id: `${id}01`, type: "diagram", topicNodeId: "n1", detourId: null,
      variant: "flow", title: "what a write does",
      nodes: [{ id: "a", label: "write" }, { id: "b", label: "store" }],
      edges: [{ from: "a", to: "b" }],
      terms,
    });
    expect(card.type === "diagram" && card.terms).toEqual(terms);
  });

  it("a binary card round-trips with its terms intact", () => {
    const card = CardSchema.parse({
      id: `${id}02`, type: "binary", topicNodeId: "n1", detourId: null,
      prompt: "eviction and expiry are the same thing", options: ["nah", "yeah"],
      correctIndex: 0, revealCopy: "one is the clock, one is the landlord.", difficulty: 3,
      terms,
    });
    expect(card.type === "binary" && card.terms).toEqual(terms);
  });

  it("every type the writer can produce accepts terms", () => {
    for (const t of WRITER_CARD_TYPES) {
      const shape = CardSchema.options.find((o) => o.shape.type.value === t);
      expect(shape, `${t} is not in CardSchema`).toBeTruthy();
      expect("terms" in shape!.shape, `${t} would silently drop the glossary`).toBe(true);
    }
  });

  it("the schema version was bumped so no stale batch can be replayed", () => {
    expect(CARD_SCHEMA_VERSION).toBe(3);
  });
});
