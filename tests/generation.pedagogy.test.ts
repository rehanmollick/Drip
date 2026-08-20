import { describe, expect, it } from "vitest";
import { CONCRETE_TYPES, orderForLearning } from "@/lib/generation/pedagogy";
import { enforceVariety } from "@/lib/generation/variety";
import type { Card, CardType } from "@/lib/schemas/cards";

const uuid = (n: number) => `4d4a5b6c-0000-4000-8000-${String(n).padStart(12, "0")}`;
let seq = 0;
const next = () => uuid(++seq);

const concept = (anchor: string, nodeId = "n1"): Card => ({
  id: next(), type: "concept", topicNodeId: nodeId, detourId: null, anchor,
  headline: "a cache is a bet on repetition", body: "b",
});
const diagram = (anchor: string, nodeId = "n1"): Card => ({
  id: next(), type: "diagram", topicNodeId: nodeId, detourId: null, anchor,
  variant: "flow", title: "the read path", nodes: [{ id: "a", label: "a" }, { id: "b", label: "b" }], edges: [],
});
const stat = (anchor: string, nodeId = "n1"): Card => ({
  id: next(), type: "stat", topicNodeId: nodeId, detourId: null, anchor,
  value: "10x", label: "fewer db reads", context: "not 10% fewer.",
});
const bet = (anchor: string, nodeId = "n1"): Card => ({
  id: next(), type: "binary", topicNodeId: nodeId, detourId: null, anchor,
  prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1, revealCopy: "nah", difficulty: 2,
});
const recap = (anchor: string, nodeId = "n1"): Card => ({
  id: next(), type: "recap", topicNodeId: nodeId, detourId: null, anchor,
  headline: "the whole thing again", beats: ["a", "b", "c"],
});

const types = (cards: readonly Card[]): CardType[] => cards.map((c) => c.type);

describe("pedagogy: concrete before abstract", () => {
  it("sinks the paragraph below the picture of the same idea", () => {
    const batch = [concept("stampede"), diagram("stampede")];
    expect(types(orderForLearning(batch))).toEqual(["diagram", "concept"]);
  });

  it("does it across cards that sit between them", () => {
    const batch = [concept("stampede"), bet("ttl"), diagram("stampede")];
    expect(types(orderForLearning(batch))).toEqual(["diagram", "binary", "concept"]);
  });

  it("lands one idea as guess → the concrete cards → the concept that names it", () => {
    const batch = [concept("stampede"), diagram("stampede"), stat("stampede"), bet("stampede")];
    expect(types(orderForLearning(batch))).toEqual(["binary", "diagram", "stat", "concept"]);
  });

  it("leaves a batch alone when the ideas don't overlap, or the concept is already last", () => {
    const spread = [concept("stampede"), diagram("eviction"), stat("ttl")];
    expect(orderForLearning(spread)).toEqual(spread);
    const already = [diagram("stampede"), concept("stampede")];
    expect(orderForLearning(already)).toEqual(already);
    // the same slug in two nodes is two ideas — nothing to sink
    const acrossNodes = [concept("cache-key", "n1"), diagram("cache-key", "n2")];
    expect(orderForLearning(acrossNodes)).toEqual(acrossNodes);
  });

  it("every concrete type counts as concrete", () => {
    expect([...CONCRETE_TYPES].sort()).toEqual(["code", "diagram", "scrub", "slider", "stat"]);
  });
});

describe("pedagogy: bet before explain (the pretesting effect)", () => {
  const seqCard = (anchor: string): Card => ({
    id: next(), type: "sequence", topicNodeId: "n1", detourId: null, anchor,
    prompt: "put the read path in order", items: [{ id: "a", label: "a" }, { id: "b", label: "b" }, { id: "c", label: "c" }],
    revealCopy: "the order is the idea", difficulty: 2,
  });
  const predict = (anchor: string): Card => ({
    id: next(), type: "predict", topicNodeId: "n1", detourId: null, anchor,
    prompt: "what happens next?", options: ["it holds", "it dies"], correctIndex: 1,
    revealHeadline: "it dies", revealBody: "every request goes to the db at once.", difficulty: 3,
  });

  it("hoists a same-idea bet above the concept that resolves it, so the next card pays it off", () => {
    expect(types(orderForLearning([concept("stampede"), bet("stampede")]))).toEqual(["binary", "concept"]);
    expect(types(orderForLearning([diagram("stampede"), stat("stampede"), predict("stampede")]))).toEqual(["predict", "diagram", "stat"]);
  });

  it("leaves a bet already in front alone, and never hoists across ideas", () => {
    const already = [bet("stampede"), diagram("stampede")];
    expect(orderForLearning(already)).toEqual(already);
    const acrossIdeas = [concept("eviction"), bet("stampede")];
    expect(orderForLearning(acrossIdeas)).toEqual(acrossIdeas);
  });

  it("a sequence is doing, not guessing — it does not hoist", () => {
    const batch = [concept("stampede"), seqCard("stampede")];
    expect(orderForLearning(batch)).toEqual(batch);
  });

  it("reverts rather than cost the batch a card — same guard as the concrete-first rule", () => {
    // hoisting the bet would park the idea's concept next to another concept: two prose cards
    // back to back, which the governor answers by dropping one. the writer's own order wins.
    const batch = [concept("a"), bet("a"), concept("b")];
    expect(enforceVariety([], batch).dropped).toHaveLength(0);
    expect(enforceVariety([], [batch[1], batch[0], batch[2]]).dropped).toHaveLength(1);
    expect(orderForLearning(batch)).toEqual(batch);
  });
});

describe("pedagogy: it reorders and only reorders", () => {
  it("never drops, never adds, never invents a card", () => {
    const batch = [concept("stampede"), bet("stampede"), diagram("stampede"), concept("eviction"), stat("eviction")];
    const out = orderForLearning(batch);
    expect(out).toHaveLength(batch.length);
    expect([...out].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...batch].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("hands the order back untouched rather than cost the batch a card", () => {
    // sinking the concept would park it right in front of a recap — two prose cards back to back,
    // which the variety governor answers by DROPPING one. A tidier order is not worth a lost card.
    const batch = [concept("stampede"), diagram("stampede"), recap("stampede")];
    expect(enforceVariety([], batch).dropped).toHaveLength(0);
    expect(enforceVariety([], [batch[1], batch[0], batch[2]]).dropped).toHaveLength(1);
    expect(orderForLearning(batch)).toEqual(batch);
  });

  it("never makes the governor drop more than the writer's own order would have", () => {
    const shapes: Card[][] = [
      [concept("a"), diagram("a"), recap("a")],
      [concept("a"), stat("a"), concept("a"), diagram("a")],
      [recap("a"), concept("a"), diagram("a"), bet("a")],
      [concept("a"), diagram("a"), concept("a"), stat("a"), bet("a")],
      [concept("a"), bet("b"), diagram("a"), recap("b"), stat("b")],
    ];
    const windows: CardType[][] = [[], ["concept"], ["recap"], ["concept", "concept"], ["diagram", "concept"]];
    for (const batch of shapes) {
      for (const recent of windows) {
        const out = orderForLearning(batch, recent);
        expect(out).toHaveLength(batch.length);
        expect(enforceVariety(recent, out).dropped.length).toBeLessThanOrEqual(enforceVariety(recent, batch).dropped.length);
      }
    }
  });
});
