import { describe, expect, it } from "vitest";
import {
  abilityAfter, abilityStep, creditFor, DEADBAND_LOGITS, difficultyOf, expected, kFor, levelFor,
  MAX_STEP, MIN_ABILITY_ITEMS, PARTIAL_CREDIT, toLogits,
} from "@/lib/adapt/ability";
import { evidenceWeight, guessRate } from "@/lib/adapt/anchors";
import type { Card } from "@/lib/schemas/cards";

const at = "2026-08-16T10:00:00.000Z";
const binary = (difficulty: number): Card => ({
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a03", type: "binary", topicNodeId: "n1", detourId: null,
  prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1, revealCopy: "nah", difficulty,
});
const open = (difficulty: number): Card => ({
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a0a", type: "open", topicNodeId: "n1", detourId: null,
  prompt: "in your own words — why does an empty cache hurt the db?", rubric: "r", modelAnswer: "m", difficulty,
});
const start = { ability: 3, abilityItems: 0, level: 3 };

describe("ability: the guessing floor", () => {
  it("prices a two-option bet as half a coin flip and an open answer as unguessable", () => {
    expect(guessRate(binary(3))).toBe(0.5);
    expect(guessRate(open(3))).toBe(0);
    // at θ = b a bet is already 75% likely to come out right — the coin did most of that
    expect(expected(0, 3, 0.5)).toBeCloseTo(0.75, 5);
    expect(expected(0, 3, 0)).toBeCloseTo(0.5, 5);
  });

  it("a miss on a guessable bet says far more than a hit on it", () => {
    const hit = abilityStep({ theta: 0, difficulty: 3, guess: 0.5, weight: 1, credit: 1, items: 0 });
    const miss = abilityStep({ theta: 0, difficulty: 3, guess: 0.5, weight: 1, credit: 0, items: 0 });
    expect(hit).toBeGreaterThan(0);
    expect(miss).toBeLessThan(0);
    // you cannot accidentally miss something you knew, but you can accidentally hit something you didn't
    expect(Math.abs(miss)).toBeGreaterThan(Math.abs(hit) * 2);
  });

  it("a hit on a hard open answer moves ability strictly more than a hit on an easy bet", () => {
    const hard = abilityAfter(start, open(4), 1).ability;
    const easy = abilityAfter(start, binary(1), 1).ability;
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBeGreaterThan(3);
    expect(evidenceWeight(open(4))).toBeGreaterThan(evidenceWeight(binary(1)));
  });

  it("no single answer may relocate the reader", () => {
    const big = abilityStep({ theta: 0, difficulty: 5, guess: 0, weight: 4, credit: 1, items: 0 });
    expect(big).toBeLessThanOrEqual(MAX_STEP);
    expect(abilityAfter(start, open(5), 1).ability).toBeLessThanOrEqual(3 + MAX_STEP + 1e-9);
  });
});

describe("ability: K-decay", () => {
  it("the first answers move it hard and the fortieth barely at all", () => {
    expect(kFor(0)).toBeGreaterThan(kFor(6));
    expect(kFor(6)).toBeGreaterThan(kFor(40));
    expect(kFor(40)).toBeGreaterThan(0);
    const first = abilityAfter({ ...start, abilityItems: 0 }, binary(3), 1).ability - 3;
    const fortieth = abilityAfter({ ...start, abilityItems: 40 }, binary(3), 1).ability - 3;
    expect(first).toBeGreaterThan(fortieth * 3);
  });
});

describe("ability: the notch the writer is handed", () => {
  it("holds still until the reading has genuinely left the notch", () => {
    expect(levelFor(3.4, 3)).toBe(3);
    expect(levelFor(3 + DEADBAND_LOGITS, 3)).toBe(3);
    expect(levelFor(3.6, 3)).toBe(4);
    expect(levelFor(2.4, 3)).toBe(2);
  });

  it("moves one notch at a time, however far the reading has run", () => {
    expect(levelFor(5, 3)).toBe(4);
    expect(levelFor(1, 5)).toBe(4);
  });

  it("costs a full deadband to come back — the register cannot flicker", () => {
    // just over the line going up, and the same reading is comfortably inside the new notch
    const moved = levelFor(3.6, 3);
    expect(moved).toBe(4);
    expect(levelFor(3.6, moved)).toBe(4);
  });

  it("will not move on a lucky first tap", () => {
    for (let items = 0; items < MIN_ABILITY_ITEMS; items++) expect(levelFor(5, 3, items)).toBe(3);
    expect(levelFor(5, 3, MIN_ABILITY_ITEMS)).toBe(4);
  });
});

describe("ability: what an answer is worth", () => {
  it("an open answer graded close is half a hit, not a whole one", () => {
    expect(creditFor({ correct: true, at })).toBe(1);
    expect(creditFor({ correct: true, at, feedback: { verdict: "got_it", feedback: "f", missed: [] } })).toBe(1);
    expect(creditFor({ correct: true, at, feedback: { verdict: "close", feedback: "f", missed: ["ttl"] } })).toBe(PARTIAL_CREDIT);
    expect(creditFor({ correct: false, at })).toBe(0);
    expect(creditFor({ at })).toBe(0);
  });

  it("half credit moves ability less than a clean hit on the same card", () => {
    const clean = abilityAfter(start, open(4), 1).ability;
    const close = abilityAfter(start, open(4), PARTIAL_CREDIT).ability;
    expect(close).toBeLessThan(clean);
    expect(close).toBeGreaterThan(3);
  });

  it("reads the card's own difficulty, and falls back to where they are rather than to a guess", () => {
    expect(difficultyOf(binary(4), 2)).toBe(4);
    const noDifficulty: Card = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a02", type: "concept", topicNodeId: "n1", detourId: null,
      headline: "h", body: "b",
    };
    expect(difficultyOf(noDifficulty, 2)).toBe(2);
    expect(toLogits(3)).toBe(0);
  });
});
