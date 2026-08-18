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
