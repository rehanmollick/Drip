import { describe, expect, it } from "vitest";
import type { Card, CardType, CrossroadsCard } from "@/lib/schemas/cards";
import { CardSchema, VISUAL_CARD_TYPES, WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import type { OutlineNode } from "@/lib/schemas/plan";
import type { Storyline } from "@/lib/schemas/session";
import { uuid } from "@/lib/id";
import { findBannedInValue } from "@/lib/copy/banned";
import {
  describeViolations, enforceVariety, isProseHeavy, narrowAllowed, proseHeavyRatio, varietyDirectives,
} from "@/lib/generation/variety";
import { buildCrossroadsCard, buildWrapCard, clampText, crossroadsHeadline } from "@/lib/generation/crossroads";
import { advanceStoryline, initialStoryline, mergeStoryline, reanchorDirective } from "@/lib/generation/storyline";

// ── card builders ───────────────────────────────────────────────────────────
const concept = (i = "a", visual = false): Card => ({
  id: uuid(), type: "concept", topicNodeId: "n1", detourId: null, headline: `c${i}`, body: `body ${i}`,
  ...(visual ? { visual: { kind: "icon" as const, icon: "bolt" as const } } : {}),
});
const recap = (i = "a"): Card => ({ id: uuid(), type: "recap", topicNodeId: "n1", detourId: null, headline: `r${i}`, beats: ["a", "b", "c"] });
const stat = (i = "a"): Card => ({ id: uuid(), type: "stat", topicNodeId: "n1", detourId: null, value: "80%", label: `l${i}`, context: "c" });
const binary = (i = "a"): Card => ({ id: uuid(), type: "binary", topicNodeId: "n1", detourId: null, prompt: `p${i}`, options: ["a", "b"], correctIndex: 1, revealCopy: "x", difficulty: 2 });
const hook = (i = "a"): Card => ({ id: uuid(), type: "hook", topicNodeId: "n1", detourId: null, headline: `h${i}` });
const types = (cards: Card[]) => cards.map((c) => c.type);

const node = (id: string, title: string, estCards = 4): OutlineNode => ({ id, title, estCards, dependsOn: [] });

describe("variety governor", () => {
  it("drops the second of two prose cards, across the batch boundary too", () => {
    // the last card already on screen is a concept → the batch may not open with another one
    const r = enforceVariety(["concept"], [concept("1"), stat(), concept("2"), binary()]);
    expect(types(r.kept)).toEqual(["stat", "concept", "binary"]);
    expect(r.dropped).toHaveLength(1);
    expect(r.violations[0].rule).toBe("adjacent_prose");
    expect(describeViolations(r.violations)).toBe("adjacent_prose×1");
  });

  it("recap counts as prose: concept → recap back to back is not allowed", () => {
    const r = enforceVariety([], [concept("1"), recap("1"), stat()]);
    expect(types(r.kept)).toEqual(["concept", "stat"]);
    expect(r.violations.map((v) => v.rule)).toEqual(["adjacent_prose"]);
  });

  it("at most 2 concepts in any window of 4", () => {
    // the plan's opening (hook + 2 concepts) already spent the budget: a third inside the window goes
    const r = enforceVariety(["concept", "concept"], [stat(), concept("3"), binary(), hook()]);
    expect(types(r.kept)).toEqual(["stat", "binary", "hook"]);
    expect(r.violations.map((v) => v.rule)).toEqual(["concept_cap"]);
    // far enough apart, the same three concepts are fine
    const ok = enforceVariety(["concept", "concept"], [stat(), binary(), hook(), concept("3")]);
    expect(ok.violations).toEqual([]);
  });

  it("flags a batch of 3+ with nothing to look at, without dropping it", () => {
    const r = enforceVariety([], [concept("1"), hook(), binary()]);
    expect(r.kept).toHaveLength(3);
    expect(r.dropped).toEqual([]);
    expect(r.violations.map((v) => v.rule)).toEqual(["no_visual"]);
  });

  it("a batch of 3+ carrying any visual type is clean", () => {
    for (const t of VISUAL_CARD_TYPES) {
      const card = { ...stat(), type: t } as Card;
      const r = enforceVariety([], [hook(), card, binary()]);
      expect(r.violations).toEqual([]);
    }
  });

  it("never returns an empty batch, and never drops the whole thing", () => {
    const r = enforceVariety(["concept"], [concept("1"), concept("2"), recap("1")]);
    expect(r.kept.length).toBeGreaterThanOrEqual(1);
    expect(r.kept.length + r.dropped.length).toBe(3);
    const all = enforceVariety(["recap"], [recap("1")]);
    expect(all.kept).toHaveLength(1);
  });

  it("a concept with no visual is the shape the reader complained about", () => {
    expect(isProseHeavy(concept("1"))).toBe(true);
    expect(isProseHeavy(concept("1", true))).toBe(false);
    expect(isProseHeavy(recap())).toBe(true);
    expect(isProseHeavy(stat())).toBe(false);
    expect(proseHeavyRatio([concept("1"), stat(), concept("2"), binary()])).toBe(0.5);
    expect(proseHeavyRatio([])).toBe(0);
  });

  it("directives take `concept` off the table when the recent stretch is concept-heavy", () => {
    const d = varietyDirectives({ recentTypes: ["hook", "concept", "concept"], batchSize: 4, allowedTypes: WRITER_CARD_TYPES });
    expect(d.forbidden).toContain("concept");
    expect(d.lines.join(" ")).toMatch(/not a concept and not a recap/);
    const allowed = narrowAllowed(WRITER_CARD_TYPES, d.forbidden);
    expect(allowed).not.toContain("concept");
    expect(allowed).toContain("stat");
  });

  it("directives ask for a shape when the last stretch had none, and get sharper under pressure", () => {
    const d = varietyDirectives({ recentTypes: ["concept", "hook", "reveal"], batchSize: 4, allowedTypes: WRITER_CARD_TYPES });
    expect(d.wanted).toEqual([...VISUAL_CARD_TYPES]);
    expect(d.lines.join(" ")).toMatch(/zero .*cards/);
    const hot = varietyDirectives({ recentTypes: ["stat", "code"], batchSize: 4, allowedTypes: WRITER_CARD_TYPES, pressure: 2 });
    expect(hot.lines.join(" ")).toMatch(/every card in this batch is a different type/);
  });

  it("narrowing never strips the writer down to nothing", () => {
    const tiny: CardType[] = ["concept", "hook", "reveal"];
    expect(narrowAllowed(tiny, ["concept", "hook"])).toEqual(tiny);
    expect(narrowAllowed(tiny, [])).toEqual(tiny);
  });

  it("chill mode: `wanted` only ever names shapes that are actually allowed", () => {
    const chill: CardType[] = ["hook", "concept", "code", "diagram", "reveal", "checkpoint", "recap", "stat"];
    const d = varietyDirectives({ recentTypes: ["concept", "concept"], batchSize: 4, allowedTypes: chill });
    expect(d.wanted).toEqual(["diagram", "code", "stat"]);
  });
});

describe("crossroads card", () => {
  const long = "a really quite long topic title that keeps going and going past sixty";

  it("names both sides of the boundary and offers every direction", () => {
    const c = buildCrossroadsCard({ finished: "what a cache is", upNext: "stampedes", nodeId: "n1", seed: 0 });
    expect(c.type).toBe("crossroads");
    expect(c.finished).toBe("what a cache is");
    expect(c.upNext).toBe("stampedes");
    expect(c.headline).toBe("that's what a cache is. where to?");
    expect(c.choices.map((x) => x.kind)).toEqual(["continue", "deeper", "ask", "wrap"]);
    expect(c.choices[0].label).toBe("keep going: stampedes");
    expect(CardSchema.safeParse(c).success).toBe(true);
    expect(findBannedInValue(c)).toBeNull();
  });

  it("drops 'keep going' at the end of the outline", () => {
    const c = buildCrossroadsCard({ finished: "ttl and invalidation", upNext: null, nodeId: "n3", seed: 2 });
    expect(c.upNext).toBeNull();
    expect(c.choices.map((x) => x.kind)).toEqual(["deeper", "ask", "wrap"]);
    expect(CardSchema.safeParse(c).success).toBe(true);
  });

  it("won't wear a whole sentence as a noun — a planner's clause title gets a headline of its own", () => {
    // planners write story-shaped titles, and "that's sound is pressure, and pressure c…" reads like
    // a glitch. The card names the finished topic in its own badge, so the headline can stand alone.
    const clause = buildCrossroadsCard({ finished: "sound is pressure, and pressure can be undone", upNext: "phase", nodeId: "n1", seed: 0 });
    expect(clause.headline).not.toContain("sound is pressure");
    expect(clause.headline).toBe("that's the stretch. where to?");
    expect(clause.finished).toContain("sound is pressure"); // still named, just not inside the sentence
    expect(CardSchema.safeParse(clause).success).toBe(true);

    // …while a title that ends on its verb is a noun clause, and belongs in the sentence
    expect(crossroadsHeadline("what a cache is", 0)).toBe("that's what a cache is. where to?");
    expect(crossroadsHeadline("why evictions happen", 0)).toBe("that's why evictions happen. where to?");
    // a bare claim is not
    expect(crossroadsHeadline("caches are hard", 0)).toBe("that's the stretch. where to?");
  });

  it("fits the schema caps with the longest titles a planner can write, and rotates its wording", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 5; seed++) {
      const c = buildCrossroadsCard({ finished: long, upNext: long, nodeId: "n1", seed });
      expect(CardSchema.safeParse(c).success).toBe(true);
      expect(c.headline.length).toBeLessThanOrEqual(80);
      expect(c.finished.length).toBeLessThanOrEqual(60);
      expect(c.choices.every((x) => x.label.length <= 40)).toBe(true);
      seen.add(c.headline);
    }
    expect(seen.size).toBe(5);
    expect(crossroadsHeadline("x", 5)).toBe(crossroadsHeadline("x", 0)); // rotation wraps
    expect(crossroadsHeadline("x", -1)).toBeTruthy();
  });

  it("shows no counters anywhere — orientation, not grading", () => {
    const c = buildCrossroadsCard({ finished: "what a cache is", upNext: "stampedes", nodeId: "n1", seed: 1 });
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(text).not.toMatch(/\d+%/);
  });

  it("clampText trims to the cap with an ellipsis and collapses whitespace", () => {
    expect(clampText("  a   b  ", 10)).toBe("a b");
    expect(clampText("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("wrap card", () => {
  const outline = [node("n1", "what a cache is"), node("n2", "stampedes"), node("n3", "ttl")];

  it("builds from the through-line when the model can't", () => {
    const storyline: Storyline = { spine: "caches", covered: ["what a cache is", "stampedes"], next: "ttl", updatedAtIdx: null };
    const w = buildWrapCard({ title: "cache stampedes", storyline, outline, nodeIdx: 1 });
    expect(w.type).toBe("wrap");
    expect(w.headline).toBe("that's cache stampedes, wrapped.");
    expect(w.beats).toEqual(["what a cache is", "stampedes"].concat([expect.any(String)] as never));
    expect(w.beats.length).toBeGreaterThanOrEqual(3);
    expect(w.openThread).toContain("ttl"); // the topic they stopped short of
    expect(w.stat).toBeUndefined(); // no scores, ever
    expect(CardSchema.safeParse(w).success).toBe(true);
    expect(findBannedInValue(w)).toBeNull();
  });

  it("still lands 3 beats with no storyline at all", () => {
    const w = buildWrapCard({ title: "x".repeat(80), storyline: null, outline: [], nodeIdx: 0 });
    expect(w.beats.length).toBeGreaterThanOrEqual(3);
    expect(w.headline.length).toBeLessThanOrEqual(80);
    expect(CardSchema.safeParse(w).success).toBe(true);
  });

  it("caps at 5 beats however much landed", () => {
    const storyline: Storyline = { spine: "s", covered: ["a", "b", "c", "d", "e", "f", "g"], next: "h", updatedAtIdx: null };
    const w = buildWrapCard({ title: "t", storyline, outline, nodeIdx: 2 });
    expect(w.beats).toHaveLength(5);
    expect(CardSchema.safeParse(w).success).toBe(true);
  });
});

describe("storyline", () => {
  const outline = [node("n1", "what a cache is"), node("n2", "stampedes"), node("n3", "ttl")];

  it("starts from the plan: the spine is the title plus the outline", () => {
    const s = initialStoryline("cache stampedes", outline, "a0");
    expect(s.spine).toBe("cache stampedes: what a cache is → stampedes → ttl");
    expect(s.covered).toEqual([]);
    expect(s.next).toBe("what a cache is");
    expect(s.updatedAtIdx).toBe("a0");
  });

  it("advances deterministically when a topic closes, without repeating itself", () => {
    let s = initialStoryline("cache stampedes", outline, null);
    s = advanceStoryline(s, { title: "cache stampedes", outline, finishedIdx: 0, lastIdx: "a1" });
    expect(s.covered).toEqual(["what a cache is"]);
    expect(s.next).toBe("stampedes");
    expect(s.updatedAtIdx).toBe("a1");
    s = advanceStoryline(s, { title: "cache stampedes", outline, finishedIdx: 1, lastIdx: "a2" });
    expect(s.covered).toEqual(["what a cache is", "stampedes"]);
    // re-closing a topic moves it to the end rather than duplicating it
    s = advanceStoryline(s, { title: "cache stampedes", outline, finishedIdx: 0, lastIdx: "a3" });
    expect(s.covered).toEqual(["stampedes", "what a cache is"]);
    // and the end of the outline reads as an invitation, not a full stop
    const end = advanceStoryline(s, { title: "cache stampedes", outline, finishedIdx: 2, lastIdx: "a4" });
    expect(end.next).toMatch(/wherever you want/);
  });

  it("advances from nothing (a session planned before storylines existed)", () => {
    const s = advanceStoryline(null, { title: "t", outline, finishedIdx: 0, lastIdx: "a1" });
    expect(s.spine).toContain("t");
    expect(s.covered).toEqual(["what a cache is"]);
  });

  it("a bad model refresh can only ever be a no-op", () => {
    const prev = initialStoryline("t", outline, "a0");
    expect(mergeStoryline(prev, { nope: true }, "a1")).toBe(prev);
    const empty = mergeStoryline(prev, { spine: "", covered: [], next: "", updatedAtIdx: null }, "a1")!;
    expect(empty.spine).toBe(prev.spine);
    expect(empty.next).toBe(prev.next);
    const merged = mergeStoryline(prev, { spine: "sharper", covered: [], next: "onward", updatedAtIdx: null }, "a1")!;
    expect(merged.spine).toBe("sharper");
    expect(merged.covered).toEqual(prev.covered); // missing pieces fall back
    expect(merged.updatedAtIdx).toBe("a1");
  });

  it("caps every field so a long session can't outgrow the schema", () => {
    let s = initialStoryline("x".repeat(400), Array.from({ length: 20 }, (_, i) => node(`n${i}`, "y".repeat(60))), null);
    expect(s.spine.length).toBeLessThanOrEqual(280);
    for (let i = 0; i < 20; i++) s = advanceStoryline(s, { title: "t", outline: Array.from({ length: 20 }, (_, k) => node(`n${k}`, `topic ${k}`)), finishedIdx: i, lastIdx: `a${i}` });
    expect(s.covered.length).toBeLessThanOrEqual(12);
  });

  it("re-anchors after a detour in the reader's own thread, not a course voice", () => {
    const line = reanchorDirective(initialStoryline("t", outline, null), "stampedes");
    expect(line).toContain("we were on stampedes");
    expect(findBannedInValue(line)).toBeNull();
    expect(reanchorDirective(null, null)).toContain("the main thread");
  });
});

describe("crossroads copy is feed-native", () => {
  it("no school vocabulary in any generated boundary card", () => {
    const cards: Card[] = [
      buildCrossroadsCard({ finished: "the ones that wobbled", upNext: null, nodeId: "system", seed: 3 }),
      buildCrossroadsCard({ finished: "the extra layer", upNext: "ttl", nodeId: "system", seed: 4 }),
      buildWrapCard({ title: "cache stampedes", storyline: null, outline: [node("n1", "one")], nodeIdx: 0 }),
    ];
    for (const c of cards) {
      expect(findBannedInValue(c)).toBeNull();
      expect(CardSchema.safeParse(c).success).toBe(true);
      const copy = c as CrossroadsCard;
      if (copy.type === "crossroads") expect(copy.headline).toBe(copy.headline.toLowerCase());
    }
  });
});
