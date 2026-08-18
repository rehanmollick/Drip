import { describe, expect, it } from "vitest";
import {
  addReinforce, applyDial, applyInteraction, clearRecap, conceptOf, learnerStateHash, LEVEL_DRIFT, median,
  missedConcepts, noteMissedConcepts, withPrefs,
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
    expect(s.perNode.n1.lastMissConcepts).toEqual(["kill redis and the site dies"]);
    expect(s.rolling.last10Interactive).toEqual([true, false]);
    expect(s.directives.recapDue).toBeNull();
  });

  it("uses the card's own content (not the generic eyebrow) as the concept label", () => {
    // eyebrows are decorative labels the writer fills with "hot take"/"the footgun" — never the concept
    expect(conceptOf(binary())).toBe("kill redis and the site dies");
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
    expect(s.directives.recapDue).toBe("kill redis and the site dies");
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

describe("learner reducer: the notch the writer is handed", () => {
  it("will not move on the first few answers, however lucky they were", () => {
    const s = answers(defaultLearnerState(), [true, true, true]);
    expect(s.level).toBe(3);
    expect(s.levelSetAt).toBe(0);
    // …the finer reading underneath has already started to move, it just isn't a notch yet
    expect(s.abilityItems).toBe(3);
    expect(s.ability).toBeGreaterThan(3);
  });

  it("eight straight hits on a coin-flip bet buy at most one notch, and it stays put after", () => {
    // the ratchet this replaced saturated to globalLevel + LEVEL_DRIFT on two lucky taps: a
    // two-option bet is half a coin, and the estimate now prices it that way
    const s8 = answers(defaultLearnerState(), Array(8).fill(true));
    expect(s8.level).toBeGreaterThanOrEqual(3);
    expect(s8.level).toBeLessThanOrEqual(4);
    const s12 = answers(s8, Array(4).fill(true));
    expect(s12.level).toBe(s8.level);
    expect(s12.globalLevel).toBe(3); // the dial is untouched — only the reading moved
  });

  it("reads the card's own difficulty — the field nothing used to look at", () => {
    const easy = answers(defaultLearnerState(), [true], binary({ difficulty: 1 }));
    const hard = answers(defaultLearnerState(), [true], binary({ difficulty: 5 }));
    expect(hard.ability).toBeGreaterThan(easy.ability);
    const missedEasy = answers(defaultLearnerState(), [false], binary({ difficulty: 1 }));
    const missedHard = answers(defaultLearnerState(), [false], binary({ difficulty: 5 }));
    expect(missedEasy.ability).toBeLessThan(missedHard.ability);
  });

  it("misses walk the notch down to the dial's floor, and scaffoldNext names what wobbled", () => {
    // misses on a coin-flip bet are the unambiguous half of the evidence — you cannot accidentally
    // miss what you knew — so the read drops fast where a hit streak crawls
    const misses = [false, false, false, true, false, false, true, false];
    const s = answers(defaultLearnerState(), misses);
    expect(s.level).toBe(3 - LEVEL_DRIFT); // the dial is a statement: the reading never runs past it
    expect(s.directives.scaffoldNext).toEqual(["kill redis and the site dies"]);
    const s2 = answers(s, [false, false, false]);
    expect(s2.level).toBe(3 - LEVEL_DRIFT);
    // a different missed concept shows up too, most recent last
    const s3 = answers(s2, [false], binary({ prompt: "the stampede", topicNodeId: "n2" }));
    expect(s3.directives.scaffoldNext).toEqual(["kill redis and the site dies", "the stampede"]);
    expect(missedConcepts(s3)).toEqual(["kill redis and the site dies", "the stampede"]);
  });

  it("chill mode is for reading, not for being measured — the reading freezes", () => {
    const chill = withPrefs(defaultLearnerState(), { chillMode: true });
    const s = answers(chill, Array(12).fill(true));
    expect(s.ability).toBe(3);
    expect(s.abilityItems).toBe(0);
    expect(s.level).toBe(3);
    expect(s.levelSetAt).toBe(0);
  });

  it("the dial carries the earned drift with it — dialling simpler doesn't throw the measurement away", () => {
    const hot = answers(defaultLearnerState(), Array(12).fill(true));
    const simpler = applyDial(hot, "simpler");
    expect(simpler.globalLevel).toBe(2);
    expect(simpler.level).toBe(hot.level - 1);
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

  it("a long dwell on a teaching card still reads as stuck", () => {
    // the doorbell objection does not survive contact with lib/dwell.ts: the clock pauses on
    // visibilitychange/pagehide and caps at 60s, so 26s here is 26s of ACTIVE reading on one card.
    const s = dwells(defaultLearnerState(), [26_000]);
    expect(s.directives.recapDue).toBe("a cache is a bet on repetition");
    expect(s.rolling.dwellMs).toEqual([26_000]);

    // …and only on cards where being stuck means something. a checkpoint is a flex, not a wall.
    const flex = applyInteraction(defaultLearnerState(), {
      card: { id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a20", type: "checkpoint", topicNodeId: "n1", detourId: null, headline: "you know more than most" },
      interaction: { dwellMs: 40_000, at },
    });
    expect(flex.directives.recapDue).toBeNull();
  });

  it("scroll-back → recapDue for the current concept, and the idea gets asked about sooner", () => {
    const s = applyInteraction(defaultLearnerState(), { card: concept({ eyebrow: "the idea" }), interaction: { at }, scrollBack: true });
    expect(s.directives.recapDue).toBe("a cache is a bet on repetition");
    // nobody scrolls UP in a feed by accident: the retrieval schedule stops waiting on this one
    expect(s.directives.due).toEqual(["cache-bet-repetition"]);
    // …and that queue is deliberately outside the frontier key, so it never re-keys the runway
    expect(learnerStateHash(s)).toBe(learnerStateHash(applyInteraction(defaultLearnerState(), { card: concept(), interaction: { at }, scrollBack: true })));
  });

  it("counts dwell on a stat card, and never on an open one", () => {
    // `stat` arrived with schema v2 and was never added to DWELL_TYPES — so the type that replaced
    // the prose slabs contributed nothing to the pace signal.
    const statCard: Card = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a09", type: "stat", topicNodeId: "n1", detourId: null,
      value: "10x", label: "fewer db reads", context: "not 10% fewer.",
    };
    const s = applyInteraction(defaultLearnerState(), { card: statCard, interaction: { dwellMs: 2200, at } });
    expect(s.rolling.dwellMs).toEqual([2200]);

    // `open` stays out on purpose: its dwell is typing time, not reading time, so counting it would
    // read a thoughtful answer as a slow reader and compress the deck under someone doing the work.
    const openCard: Card = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a0a", type: "open", topicNodeId: "n1", detourId: null,
      prompt: "in your own words — why does an empty cache hurt the db?", rubric: "r", modelAnswer: "m", difficulty: 2,
    };
    const typed = applyInteraction(defaultLearnerState(), { card: openCard, interaction: { dwellMs: 41_000, at } });
    expect(typed.rolling.dwellMs).toEqual([]);
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

  it("addReinforce dedupes and keeps only the freshest few (they expire; they don't pile up all session)", () => {
    let s = defaultLearnerState();
    for (const f of ["a", "b", "a", "c", "d", "e", "f", "g"]) s = addReinforce(s, f);
    expect(s.directives.reinforce).toEqual(["e", "f", "g"]);
    // re-asking about something already queued moves it to the front of the queue rather than duplicating
    s = addReinforce(s, "e");
    expect(s.directives.reinforce).toEqual(["f", "g", "e"]);
  });

  it("an open answer graded close is half a hit to the reading, not a whole one", () => {
    const openCard: Card = {
      id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a0a", type: "open", topicNodeId: "n1", detourId: null,
      prompt: "in your own words — why does an empty cache hurt the db?", rubric: "r", modelAnswer: "m", difficulty: 4,
    };
    const s0 = defaultLearnerState();
    const clean = applyInteraction(s0, { card: openCard, interaction: { correct: true, at, text: "…" } });
    const close = applyInteraction(s0, {
      card: openCard,
      interaction: { correct: true, at, text: "…", feedback: { verdict: "close", feedback: "f", missed: ["ttl"] } },
    });
    expect(close.ability).toBeLessThan(clean.ability);
    expect(close.ability).toBeGreaterThan(3);
    // it still counts as a hit in the node ledger — they did say the idea back
    expect(close.perNode.n1.hits).toBe(1);
  });

  it("noteMissedConcepts records what an open answer half-missed without touching the ledger", () => {
    const s0 = defaultLearnerState();
    // an unknown node is created rather than lost
    const s1 = noteMissedConcepts(s0, "n1", ["eviction", " ttl ", ""]);
    expect(s1).not.toBe(s0);
    expect(s0.perNode.n1).toBeUndefined();
    expect(s1.perNode.n1.lastMissConcepts).toEqual(["eviction", "ttl"]);
    expect(s1.perNode.n1.attempts).toBe(0);   // a "close" answer is still a hit: no attempt is invented
    expect(s1.perNode.n1.hits).toBe(0);
    expect(s1.perNode.n1.consecutiveMisses).toBe(0);
    expect(missedConcepts(s1)).toContain("eviction");
    // re-missing moves it to the front of the queue, and the list stays bounded
    const s2 = noteMissedConcepts(s1, "n1", ["eviction"]);
    expect(s2.perNode.n1.lastMissConcepts).toEqual(["ttl", "eviction"]);
    const s3 = noteMissedConcepts(s2, "n1", ["a", "b", "c", "d", "e", "f"]);
    expect(s3.perNode.n1.lastMissConcepts).toHaveLength(5);
    // nothing worth recording → the same state back
    expect(noteMissedConcepts(s3, "n1", ["  "])).toBe(s3);
    // long labels are trimmed so they stay readable in a prompt
    const long = noteMissedConcepts(s0, "n1", ["x".repeat(90)]);
    expect(long.perNode.n1.lastMissConcepts[0].length).toBeLessThanOrEqual(48);
    // …but recording it does NOT re-key the generation frontier. `perNode` is a ledger, not a
    // directive: the writer never reads it (lib/prompts/shared.ts reads level/prefs/directives
    // only), and its influence reaches the writer as `directives.scaffoldNext`, which IS hashed.
    // Keeping the raw counters in the key meant every scored tap split the frontier and paid the
    // model twice for the same runway slot.
    expect(learnerStateHash(s1)).toBe(learnerStateHash(s0));
  });

  it("learnerStateHash moves only on directives — never on ordinary reading or answering", () => {
    const s0 = defaultLearnerState();
    const h0 = learnerStateHash(s0);
    expect(h0).toMatch(/^[0-9a-f]{10}$/);
    expect(learnerStateHash(defaultLearnerState())).toBe(h0);

    // This hash is half of the generation frontier key (engine.frontierKeyFor). Anything in it
    // that moves on an ordinary tap splits the frontier: the in-flight batch and the next request
    // claim different keys for the same slot, and the runway gets written twice.
    expect(learnerStateHash(dwells(s0, [3000])), "a dwell report re-keyed the frontier").toBe(h0);
    expect(learnerStateHash(answers(s0, [true])), "a correct answer re-keyed the frontier").toBe(h0);
    expect(learnerStateHash(answers(s0, [true, true, true])), "a hit streak re-keyed the frontier").toBe(h0);

    // …while the things that genuinely change what the writer is told still move it
    expect(learnerStateHash(applyDial(s0, "deeper"))).not.toBe(h0);
    expect(learnerStateHash(addReinforce(s0, "eviction"))).not.toBe(h0);
  });
});
