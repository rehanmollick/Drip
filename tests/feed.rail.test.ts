import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { ENDOWED_MIN, railModel } from "@/lib/feed/rail";

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

const many = (node: string, n: number) => Array.from({ length: n }, () => [node, null] as [string, null]);

/** length of a span, as its slice of the whole rail. */
const spanLen = (m: ReturnType<typeof railModel>, i: number) => m.spans[i].to - m.spans[i].from;

describe("railModel: one vertical geometry", () => {
  it("is one span per outline node, in order, and the reader's span is marked current", () => {
    const cards = deck([["a", null], ["a", null], ["b", null]]);
    const m = railModel(cards, OUTLINE, uuid(3));
    expect(m.spans.map((s) => s.nodeId)).toEqual(["a", "b", "c"]);
    expect(m.spans.map((s) => s.state)).toEqual(["done", "current", "ahead"]);
    expect(m.title).toBe("what the scheduler sees");
    // spans tile the whole rail in order — and a topic with no cards yet has zero width, so only
    // boundaries that exist among written cards become ticks
    expect(m.spans[0].from).toBe(0);
    expect(m.spans[2].to).toBeCloseTo(1);
    expect(spanLen(m, 2)).toBe(0);
    expect(m.ticks).toHaveLength(1);
    expect(m.ticks[0]).toBeCloseTo(m.spans[0].to);
  });

  it("sizes spans PROPORTIONALLY to their WRITTEN card counts — a big topic takes more rail than a small one", () => {
    const cards = deck([...many("a", 8), ...many("b", 1)]);
    const m = railModel(cards, OUTLINE, uuid(9), { written: { a: 8, b: 1 }, closed: ["a"] });
    expect(spanLen(m, 0) / spanLen(m, 1)).toBeCloseTo(8);
    // the unwritten topic's 4-card estimate buys it nothing at all
    expect(spanLen(m, 2)).toBe(0);
  });

  it("never reports a fraction outside 0..1, wherever the reader stands", () => {
    const cards = deck(many("a", 6));
    for (const c of cards) {
      const m = railModel(cards, OUTLINE, c.id);
      expect(m.thumb).toBeGreaterThanOrEqual(0);
      expect(m.thumb).toBeLessThanOrEqual(1);
      expect(m.written).toBeGreaterThanOrEqual(0);
      expect(m.written).toBeLessThanOrEqual(1);
      for (const s of m.spans) {
        expect(s.from).toBeGreaterThanOrEqual(0);
        expect(s.writtenTo).toBeGreaterThanOrEqual(s.from);
        expect(s.writtenTo).toBeLessThanOrEqual(s.to);
        expect(s.to).toBeLessThanOrEqual(1);
      }
    }
  });

  it("falls back to a single span while there is no outline yet", () => {
    const cards = deck([["a", null], ["a", null]]);
    const m = railModel(cards, [], uuid(1));
    expect(m.spans).toHaveLength(1);
    expect(m.nodeId).toBeNull();
    expect(m.thumb).toBeCloseTo(0.5);
    expect(railModel([], undefined, null).thumb).toBe(0);
  });

  it("system cards (notices, clarify, cards written past the outline) inherit the topic behind them", () => {
    const cards = deck([["a", null], ["b", null], ["system", null, "notice"], ["zz", null]]);
    expect(railModel(cards, OUTLINE, uuid(3)).nodeId).toBe("b");
    expect(railModel(cards, OUTLINE, uuid(4)).nodeId).toBe("b");
    // nothing behind it → the first real topic ahead
    const early = deck([["clarify", null, "clarify"], ["a", null]]);
    expect(railModel(early, OUTLINE, uuid(1)).nodeId).toBe("a");
  });
});

describe("railModel: the rail is exactly what exists (the honesty rules)", () => {
  it("estimates never buy a single pixel of rail — the whole span is cards in hand or counted", () => {
    // 2 cards against three 4-card estimates: the rail IS those 2 cards, nothing else
    const cards = deck(many("a", 2));
    const m = railModel(cards, OUTLINE, uuid(2));
    expect(m.spans[0].to).toBeCloseTo(1);
    expect(spanLen(m, 1)).toBe(0);
    expect(spanLen(m, 2)).toBe(0);
    // …and everything drawn exists, so the writing frontier is the bottom edge
    expect(m.written).toBe(1);
  });

  it("never claims the thread is finished while a topic is still open — the honesty lives at the bottom edge now", () => {
    // 9 cards written into a 4-card estimate: everything drawn exists, and the rail still says
    // "it keeps going" — open, uncapped — because nothing closed the topic (its crossroads is unwritten)
    const cards = deck(many("a", 9));
    const m = railModel(cards, OUTLINE, uuid(9), { written: { a: 9 } });
    expect(m.spans[0].writtenTo).toBeCloseTo(m.spans[0].to);
    expect(m.open).toBe(true);
    expect(m.wrapped).toBe(false);
    // …and closing every node is the ONLY thing that seals the edge
    const closed = railModel(cards, OUTLINE, uuid(9), { written: { a: 9 }, closed: ["a", "b", "c"] });
    expect(closed.open).toBe(false);
  });

  it("a topic ahead with cards already written takes rail; one that is only a heading takes none", () => {
    const cards = deck([["a", null]]);
    const m = railModel(cards, OUTLINE, uuid(1), { written: { a: 1, c: 3 } });
    expect(m.spans[2].state).toBe("ahead");
    expect(spanLen(m, 2)).toBeCloseTo(0.75); // 3 of the 4 existing cards
    expect(spanLen(m, 1)).toBe(0); // a heading is not a promise
    // the reader is still at the end of the first topic, not inside the one ahead
    expect(m.thumb).toBeLessThanOrEqual(m.spans[2].from);
  });

  it("counts whichever of the census and our own rows saw more, and the thumb never overtakes the written edge of its span", () => {
    const cards = deck(many("a", 6));
    // the server is behind: it counted 2, we are holding 6
    const m = railModel(cards, OUTLINE, uuid(6), { written: { a: 2, b: 1 } });
    expect(spanLen(m, 0) / spanLen(m, 1)).toBeCloseTo(6);
    expect(m.thumb).toBeLessThanOrEqual(m.spans[0].writtenTo);
  });

  it("without a census it still draws the rows in hand as existing — the deck is exact knowledge", () => {
    const cards = deck([["a", null], ["a", null], ["b", null]]);
    const m = railModel(cards, OUTLINE, uuid(3));
    expect(spanLen(m, 0)).toBeCloseTo(2 / 3);
    expect(spanLen(m, 1)).toBeCloseTo(1 / 3);
    expect(spanLen(m, 2)).toBe(0);
    expect(m.live).toBe(false);
    expect(m.gate).toBeNull();
  });

  it("pulses only while a batch is truly in flight, at the bottom edge of what exists", () => {
    const cards = deck([["a", null]]);
    const m = railModel(cards, OUTLINE, uuid(1), { live: { nodeIdx: 2 } });
    expect(m.live).toBe(true);
    expect(m.written).toBe(1); // the pulse rides the bottom edge — growth is the signal, not a path
    const idle = railModel(cards, OUTLINE, uuid(1));
    expect(idle.live).toBe(false);
  });

  it("a fork stops the rail on the topic it is asking about and silences the pulse", () => {
    const cards = deck([["a", null], ["b", null], ["b", null, "crossroads"], ["c", null]]);
    const m = railModel(cards, OUTLINE, uuid(2), { gate: "crossroads", live: { nodeIdx: 2 } });
    expect(m.gate?.kind).toBe("crossroads");
    expect(m.live).toBe(false); // a pulse at a gate would be a promise nobody is keeping
    expect(m.wrapped).toBe(false);
    // the gate is its own crisp mark — no soft "keeps going" edge while the thread is parked
    expect(m.open).toBe(false);
    // the gate sits at the written edge of the fork's own span
    expect(m.gate!.at).toBeCloseTo(m.spans[1].writtenTo);
  });

  it("a fork with nothing written past it gates at the bottom edge of the rail", () => {
    const cards = deck([["a", null], ["b", null], ["b", null, "crossroads"]]);
    const m = railModel(cards, OUTLINE, uuid(3), { gate: "crossroads" });
    expect(m.gate!.at).toBeCloseTo(1);
  });

  it("a wrap is a hard end: the rail is exactly what was written, capped, nothing below", () => {
    const cards = deck([...many("a", 4), ...many("b", 3)]);
    const m = railModel(cards, OUTLINE, uuid(7), { written: { a: 4, b: 3 }, closed: ["a", "b"], gate: "wrap" });
    expect(m.wrapped).toBe(true);
    expect(m.written).toBe(1);
    expect(m.open).toBe(false);
    // the never-written topic takes no rail at all
    expect(spanLen(m, 2)).toBe(0);
  });

  it("while the outline is open, the rail is open — the bottom edge stays soft", () => {
    const cards = deck(many("a", 2));
    expect(railModel(cards, OUTLINE, uuid(2)).open).toBe(true);
  });
});

describe("railModel: the reader", () => {
  it("endowed progress: the thumb is visibly past zero the moment anything exists", () => {
    const cards = deck([["a", null], ["a", null], ["a", null]]);
    const m = railModel(cards, OUTLINE, null); // hasn't even swiped once
    expect(m.thumb).toBeGreaterThanOrEqual(ENDOWED_MIN);
    // …but an empty session promises nothing
    expect(railModel([], OUTLINE, null).thumb).toBe(0);
  });

  it("a detour doubles the rail beside the branch point and freezes the thumb where they left the thread", () => {
    const cards = deck([["a", null], ["a", null], ["a", "d1", "detour_marker"], ["a", "d1"], ["a", null]]);
    const onMain = railModel(cards, OUTLINE, uuid(2));
    const onDetour = railModel(cards, OUTLINE, uuid(4));
    expect(onMain.onDetour).toBe(false);
    expect(onMain.detour).toBeNull();
    expect(onDetour.onDetour).toBe(true);
    expect(onDetour.detour).not.toBeNull();
    expect(onDetour.detour!.at).toBeCloseTo(onMain.thumb); // asking didn't advance the story
    expect(onDetour.detour!.span).toBeGreaterThan(0);
  });

  it("goal gradient: the last quarter of the current topic lights the remaining sliver — and only then", () => {
    const cards = deck(many("a", 8));
    const early = railModel(cards, OUTLINE, uuid(2), { written: { a: 8 }, closed: ["a"] });
    expect(early.goal).toBeNull();
    const late = railModel(cards, OUTLINE, uuid(7), { written: { a: 8 }, closed: ["a"] });
    expect(late.goal).not.toBeNull();
    expect(late.goal!.from).toBeCloseTo(late.thumb);
    expect(late.goal!.to).toBeCloseTo(late.spans[0].to);
  });

  it("unitsAhead is the map sheet's effort math: written cards below the thumb plus what open topics still owe", () => {
    const cards = deck(many("a", 2));
    const m = railModel(cards, OUTLINE, uuid(1));
    // 1 written card below + (4-2) + 4 + 4 still estimated across the open outline
    expect(m.unitsAhead).toBe(11);
    const done = railModel(deck(many("a", 4)), [OUTLINE[0]], uuid(4), { written: { a: 4 }, closed: ["a"] });
    expect(done.unitsAhead).toBe(0);
  });
});
