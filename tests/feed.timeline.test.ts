import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { timelineModel } from "@/lib/feed/timeline";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const OUTLINE = [
  { id: "a", title: "why pods get evicted", estCards: 4 },
  { id: "b", title: "what the scheduler sees", estCards: 4 },
  { id: "c", title: "when it all goes wrong", estCards: 4 },
];

/** rows in feed order: [nodeId, detourId?, type?] */
function deck(spec: Array<[string, string | null] | [string, string | null, Card["type"]]>): CardRow[] {
  const keys = generateNKeysBetween(null, null, spec.length);
  return spec.map(([node, detourId, type], i) => {
    const t = type ?? "concept";
    const payload = { id: uuid(i + 1), type: t, topicNodeId: node, detourId, headline: "h", body: "b", kind: "planning" } as unknown as Card;
    return {
      id: uuid(i + 1),
      sessionId: uuid(999),
      idx: keys[i],
      type: t,
      payload,
      detourId,
      batchId: null,
      viewedAt: null,
      interaction: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  });
}

describe("timelineModel", () => {
  it("is one segment per outline node, in order", () => {
    const cards = deck([["a", null], ["a", null], ["b", null]]);
    const m = timelineModel(cards, OUTLINE, uuid(3));
    expect(m.segments.map((s) => s.nodeId)).toEqual(["a", "b", "c"]);
    expect(m.segments.map((s) => s.state)).toEqual(["done", "current", "ahead"]);
    expect(m.segments[0].fill).toBe(1);
    expect(m.segments[2].fill).toBe(0);
    expect(m.title).toBe("what the scheduler sees");
  });

  it("fills the current segment against the outline estimate, so a landing batch can't retract it", () => {
    const two = deck([["a", null], ["a", null]]);
    expect(timelineModel(two, OUTLINE, uuid(2)).segments[0].fill).toBeCloseTo(0.5); // 2 of an estimated 4
    const six = deck([["a", null], ["a", null], ["a", null], ["a", null], ["a", null], ["a", null]]);
    expect(timelineModel(six, OUTLINE, uuid(6)).segments[0].fill).toBe(1);
    expect(timelineModel(six, OUTLINE, uuid(3)).segments[0].fill).toBeCloseTo(0.5);
  });

  it("marks a detour on the current segment and freezes the fill where it branched off", () => {
    const cards = deck([["a", null], ["a", null], ["a", "d1", "detour_marker"], ["a", "d1"], ["a", null]]);
    const onMain = timelineModel(cards, OUTLINE, uuid(2));
    const onDetour = timelineModel(cards, OUTLINE, uuid(4));
    expect(onMain.detour).toBe(false);
    expect(onDetour.detour).toBe(true);
    expect(onDetour.segments[0].detour).toBe(true);
    expect(onDetour.segments[1].detour).toBe(false);
    expect(onDetour.segments[0].fill).toBeCloseTo(onMain.segments[0].fill); // asking didn't advance the story
  });

  it("system cards (notices, clarify, cards written past the outline) inherit the topic behind them", () => {
    const cards = deck([["a", null], ["b", null], ["system", null, "notice"], ["zz", null]]);
    expect(timelineModel(cards, OUTLINE, uuid(3)).nodeId).toBe("b");
    expect(timelineModel(cards, OUTLINE, uuid(4)).nodeId).toBe("b");
    // nothing behind it → the first real topic ahead
    const early = deck([["clarify", null, "clarify"], ["a", null]]);
    expect(timelineModel(early, OUTLINE, uuid(1)).nodeId).toBe("a");
  });

  it("falls back to a single segment while there is no outline yet", () => {
    const cards = deck([["a", null], ["a", null]]);
    const m = timelineModel(cards, [], uuid(1));
    expect(m.segments).toHaveLength(1);
    expect(m.nodeId).toBeNull();
    expect(m.segments[0].fill).toBeCloseTo(0.5);
    expect(timelineModel([], undefined, null).segments[0].fill).toBe(0);
  });

  it("never reports a fraction outside 0..1", () => {
    const cards = deck([["a", null], ["a", null], ["a", null], ["a", null], ["a", null], ["a", null]]);
    for (const c of cards) {
      const m = timelineModel(cards, OUTLINE, c.id);
      for (const s of m.segments) expect(s.fill).toBeGreaterThanOrEqual(0);
      for (const s of m.segments) expect(s.fill).toBeLessThanOrEqual(1);
    }
  });
});

describe("timelineModel: what is written vs what was merely planned", () => {
  it("never draws an OPEN topic as finished, however far past its estimate the writer has run", () => {
    // 9 cards written into a 4-card estimate. the denominator is written+1, so the ghost band
    // stops short — "there is more of this coming" is the one thing an open topic must still say.
    const cards = deck(Array.from({ length: 9 }, () => ["a", null] as [string, null]));
    const m = timelineModel(cards, OUTLINE, uuid(9), { written: { a: 9 } });
    expect(m.segments[0].buffered).toBeCloseTo(0.9);
    expect(m.segments[0].buffered).toBeLessThan(1);
    // …and closing it is the ONLY thing that fills it
    const closed = timelineModel(cards, OUTLINE, uuid(9), { written: { a: 9 }, closed: ["a"] });
    expect(closed.segments[0].buffered).toBe(1);
  });

  it("says how much of a topic ahead of you already exists, without claiming you have read any of it", () => {
    const outline = [OUTLINE[0], OUTLINE[1], { ...OUTLINE[2], estCards: 6 }];
    const cards = deck([["a", null]]);
    const m = timelineModel(cards, outline, uuid(1), { written: { a: 1, c: 3 } });
    expect(m.segments[2].state).toBe("ahead");
    expect(m.segments[2].read).toBe(0);
    expect(m.segments[2].buffered).toBeCloseTo(0.5); // 3 written into a 6-card estimate
    // a topic with nothing written is a bare track, not a faint promise
    expect(m.segments[1].buffered).toBe(0);
  });

  it("counts whichever of the census and our own rows saw more, and the read band never overtakes the ghost", () => {
    const cards = deck([["a", null], ["a", null], ["a", null], ["a", null], ["a", null], ["a", null]]);
    // the server is behind: it counted 2, we are holding 6
    const m = timelineModel(cards, OUTLINE, uuid(6), { written: { a: 2 } });
    expect(m.segments[0].buffered).toBeCloseTo(6 / 7);
    for (const s of m.segments) expect(s.read).toBeLessThanOrEqual(s.buffered);
  });

  it("without a census it says exactly what it always said: buffered collapses onto read", () => {
    const cards = deck([["a", null], ["a", null], ["b", null]]);
    const m = timelineModel(cards, OUTLINE, uuid(3));
    for (const s of m.segments) {
      expect(s.buffered).toBe(s.fill);
      expect(s.read).toBe(s.fill);
      expect(s.live).toBe(false);
      expect(s.gate).toBeNull();
    }
    expect(m.gate).toBeNull();
  });

  it("marks the ONE topic being written right now", () => {
    const cards = deck([["a", null]]);
    const m = timelineModel(cards, OUTLINE, uuid(1), { live: { nodeIdx: 2 } });
    expect(m.segments.map((s) => s.live)).toEqual([false, false, true]);
    // a nodeIdx past the end of the outline still lands on a real segment
    const past = timelineModel(cards, OUTLINE, uuid(1), { live: { nodeIdx: 9 } });
    expect(past.segments.map((s) => s.live)).toEqual([false, false, true]);
  });

  it("a fork marks the topic it is asking about and stops anything from claiming to be in flight", () => {
    const cards = deck([["a", null], ["b", null], ["b", null, "crossroads"], ["c", null]]);
    const m = timelineModel(cards, OUTLINE, uuid(2), { gate: "crossroads", live: { nodeIdx: 2 } });
    expect(m.gate).toBe("crossroads");
    expect(m.segments.map((s) => s.gate)).toEqual([null, "crossroads", null]);
    expect(m.segments.some((s) => s.live)).toBe(false);
  });

  it("falls back to where the reader is when the fork's own row isn't in hand", () => {
    const cards = deck([["a", null], ["b", null]]);
    const m = timelineModel(cards, OUTLINE, uuid(2), { gate: "crossroads" });
    expect(m.segments.map((s) => s.gate)).toEqual([null, "crossroads", null]);
  });
});
