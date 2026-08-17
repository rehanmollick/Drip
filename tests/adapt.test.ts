import { describe, expect, it } from "vitest";
import {
  addReinforce, applyDial, applyInteraction, clearRecap, conceptOf, learnerStateHash, median, missedConcepts,
} from "@/lib/adapt/learner";
import { defaultLearnerState, type LearnerState } from "@/lib/schemas/learner";
import type { Card } from "@/lib/schemas/cards";

const at = "2026-08-16T10:00:00.000Z";
const binary = (over: Partial<Extract<Card, { type: "binary" }>> = {}): Card => ({
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a03", type: "binary", topicNodeId: "n1", detourId: null, eyebrow: "ttl",
  prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1, revealCopy: "nah", difficulty: 2, ...over,
});
const concept = (over: Partial<Extract<Card, { type: "concept" }>> = {}): Card => ({
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a02", type: "concept", topicNodeId: "n1", detourId: null,
  headline: "a cache is a bet on repetition", body: "b", ...over,
});
const slider: Card = {
  id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a08", type: "slider", topicNodeId: "n1", detourId: null, prompt: "p", label: "l",
  min: 0, max: 10, step: 1, defaultValue: 1, expression: "x", outputLabel: "o", outputFormat: "number",
};

function answers(state: LearnerState, results: boolean[], card = binary()): LearnerState {
  return results.reduce((s, correct) => applyInteraction(s, { card, interaction: { correct, at } }), state);
}
function dwells(state: LearnerState, ms: number[]): LearnerState {
  return ms.reduce((s, dwellMs) => applyInteraction(s, { card: concept(), interaction: { dwellMs, at } }), state);
}

describe("learner reducer: purity", () => {
  it("never mutates the input state", () => {
    const s0 = defaultLearnerState();
    const frozen = JSON.stringify(s0);
    const s1 = applyInteraction(s0, { card: binary(), interaction: { correct: false, at } });
    const s2 = applyDial(s1, "simpler");
    const s3 = addReinforce(s2, "ttl");
    clearRecap(s3);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(s1).not.toBe(s0);
    expect(s1.perNode).not.toBe(s0.perNode);
    expect(s2.prefs).not.toBe(s1.prefs);
  });
});

describe("learner reducer: scored cards", () => {
  it("updates perNode attempts/hits/consecutiveMisses/lastMissConcepts", () => {
    const s = answers(defaultLearnerState(), [true, false]);
    expect(s.perNode.n1.attempts).toBe(2);
    expect(s.perNode.n1.hits).toBe(1);
    expect(s.perNode.n1.consecutiveMisses).toBe(1);
    expect(s.perNode.n1.lastMissConcepts).toEqual(["ttl"]);
    expect(s.rolling.last10Interactive).toEqual([true, false]);
    expect(s.directives.recapDue).toBeNull();
  });

  it("uses eyebrow, else headline/prompt gist, as the concept label", () => {
    expect(conceptOf(binary())).toBe("ttl");
    expect(conceptOf(binary({ eyebrow: undefined }))).toBe("kill redis and the site dies");
    expect(conceptOf(concept({ headline: "x".repeat(80) }))).toHaveLength(48);
  });

  it("keeps only the last 10 interactive results", () => {
    const s = answers(defaultLearnerState(), Array(14).fill(true));
    expect(s.rolling.last10Interactive).toHaveLength(10);
  });

  it("two consecutive misses on one concept → recapDue = that concept", () => {
    const s = answers(defaultLearnerState(), [true, false, false]);
    expect(s.perNode.n1.consecutiveMisses).toBe(2);
    expect(s.directives.recapDue).toBe("ttl");
    // cleared explicitly once the recap is inserted, and a hit resets the streak
    const cleared = clearRecap(s);
    expect(cleared.directives.recapDue).toBeNull();
    const hit = answers(cleared, [true]);
    expect(hit.perNode.n1.consecutiveMisses).toBe(0);
    expect(hit.directives.recapDue).toBeNull();
  });

  it("does not double count when firstAnswer is false", () => {
    const s0 = answers(defaultLearnerState(), [true]);
    const s1 = applyInteraction(s0, { card: binary(), interaction: { correct: true, at }, firstAnswer: false });
    expect(s1.perNode.n1.attempts).toBe(1);
  });
});

describe("learner reducer: difficulty directives", () => {
  it("needs ≥5 samples before moving difficulty", () => {
    const s = answers(defaultLearnerState(), [true, true, true, true]);
    expect(s.directives.difficultyDelta).toBe(0);
  });

  it("hit rate > 0.9 → +1 per scored card, capped at +2", () => {
    const s5 = answers(defaultLearnerState(), Array(5).fill(true));
    expect(s5.directives.difficultyDelta).toBe(1);
    const s9 = answers(s5, Array(4).fill(true));
    expect(s9.directives.difficultyDelta).toBe(2);
  });

  it("hit rate < 0.65 → −1 (cap −2) and scaffoldNext = missed concepts", () => {
    const misses = [false, false, false, true, false];
    const s = answers(defaultLearnerState(), misses);
    expect(s.directives.difficultyDelta).toBe(-1);
    expect(s.directives.scaffoldNext).toEqual(["ttl"]);
    const s2 = answers(s, [false, false, false]);
    expect(s2.directives.difficultyDelta).toBe(-2);
    // a different missed concept shows up too, most recent last
    const s3 = answers(s2, [false], binary({ eyebrow: "stampede", topicNodeId: "n2" }));
    expect(s3.directives.scaffoldNext).toEqual(["ttl", "stampede"]);
    expect(missedConcepts(s3)).toEqual(["ttl", "stampede"]);
  });

  it("flow zone relaxes the delta one step toward zero and clears scaffolds", () => {
    const hot = answers(defaultLearnerState(), Array(10).fill(true)); // +2
    // 8/10 → in zone
    const cooled = answers(hot, [false, false]);
    expect(cooled.directives.difficultyDelta).toBe(0);
    expect(cooled.directives.scaffoldNext).toEqual([]);
  });
});

describe("learner reducer: dwell + pace", () => {
  it("records non-interactive dwell (keep 8) and average", () => {
    const s = dwells(defaultLearnerState(), [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
    expect(s.rolling.dwellMs).toEqual([2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
    expect(s.rolling.avgDwellMs).toBe(5500);
    expect(s.directives.pace).toBe("normal");
  });

  it("clamps any single dwell at 60s (server-side too)", () => {
    const s = dwells(defaultLearnerState(), [40 * 60_000]);
    expect(s.rolling.dwellMs).toEqual([60_000]);
    expect(s.rolling.avgDwellMs).toBe(60_000);
  });

  it("median dwell < 1.8s over ≥5 consecutive non-interactive → compress", () => {
    const four = dwells(defaultLearnerState(), [900, 1000, 1200, 1500]);
    expect(four.directives.pace).toBe("normal");
    const five = dwells(four, [1100]);
    expect(five.directives.pace).toBe("compress");
    // an interactive card breaks the streak
    const broken = applyInteraction(five, { card: slider, interaction: { value: 3, at } });
    expect(broken.rolling.dwellMs).toEqual([]);
    expect(broken.directives.pace).toBe("normal");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("dwell > 25s → recapDue for the current concept", () => {
    const s = dwells(defaultLearnerState(), [26_000]);
    expect(s.directives.recapDue).toBe("a cache is a bet on repetition");
  });

  it("scroll-back → recapDue for the current concept", () => {
    const s = applyInteraction(defaultLearnerState(), { card: concept({ eyebrow: "the idea" }), interaction: { at }, scrollBack: true });
    expect(s.directives.recapDue).toBe("the idea");
  });

  it("ignores dwell on non-content cards", () => {
    const notice: Card = { id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a16", type: "notice", topicNodeId: "system", detourId: null, kind: "budget", headline: "h" };
    const s = applyInteraction(defaultLearnerState(), { card: notice, interaction: { dwellMs: 30_000, at } });
    expect(s.rolling.dwellMs).toEqual([]);
    expect(s.directives.recapDue).toBeNull();
  });
});

describe("learner reducer: dial + reinforce + hash", () => {
  it("applyDial moves globalLevel within 1..5 and counts taps", () => {
    let s = defaultLearnerState();
    s = applyDial(s, "deeper");
    s = applyDial(s, "deeper");
    s = applyDial(s, "deeper");
    expect(s.globalLevel).toBe(5);
    expect(s.prefs.deeperTaps).toBe(3);
    for (let i = 0; i < 6; i++) s = applyDial(s, "simpler");
    expect(s.globalLevel).toBe(1);
    expect(s.prefs.simplerTaps).toBe(6);
  });

  it("addReinforce dedupes and caps", () => {
    let s = defaultLearnerState();
    for (const f of ["a", "b", "a", "c", "d", "e", "f", "g"]) s = addReinforce(s, f);
    expect(s.directives.reinforce).toEqual(["a", "c", "d", "e", "f", "g"]);
  });

  it("learnerStateHash is stable, short, and ignores rolling dwell noise", () => {
    const s0 = defaultLearnerState();
    const h0 = learnerStateHash(s0);
    expect(h0).toMatch(/^[0-9a-f]{10}$/);
    expect(learnerStateHash(defaultLearnerState())).toBe(h0);
    expect(learnerStateHash(dwells(s0, [3000]))).toBe(h0);
    expect(learnerStateHash(applyDial(s0, "deeper"))).not.toBe(h0);
    expect(learnerStateHash(answers(s0, [false]))).not.toBe(h0);
  });
});
