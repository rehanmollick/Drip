import { describe, expect, it } from "vitest";
import { buildDetourRows, keyBetween, keysBetween } from "@/lib/detour/splice";
import type { Card } from "@/lib/schemas/cards";
import { CardSchema } from "@/lib/schemas/cards";
import { findBannedInValue } from "@/lib/copy/banned";
import { uuid } from "@/lib/id";

const sessionId = "9c1c7c1a-2f7f-4d5f-9d4a-9a5c1a2b3c4d";
const concept = (i: number): Card => ({ id: uuid(), type: "concept", topicNodeId: "n1", detourId: null, headline: `c${i}`, body: "b" });
const isSorted = (xs: string[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

describe("fractional keys", () => {
  it("keysBetween returns n strictly increasing keys inside (after, before)", () => {
    const ks = keysBetween("a0", "a1", 5);
    expect(ks).toHaveLength(5);
    expect(isSorted(ks)).toBe(true);
    for (const k of ks) {
      expect(k > "a0").toBe(true);
      expect(k < "a1").toBe(true);
    }
    expect(keysBetween("a0", null, 2).every((k) => k > "a0")).toBe(true);
    expect(keysBetween(null, "a0", 2).every((k) => k < "a0")).toBe(true);
    expect(keysBetween("a0", "a1", 0)).toEqual([]);
    const k = keyBetween("a0", "a1");
    expect(k > "a0" && k < "a1").toBe(true);
  });

  it("repeated splices at the same spot never collide and keep order", () => {
    // splice between the same two neighbours again and again (nested detours at the same point)
    let lo = "a0";
    let hi = "a1";
    const seen = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const ks = keysBetween(lo, hi, 3);
      for (const k of ks) {
        expect(seen.has(k)).toBe(false);
        expect(k > lo && k < hi).toBe(true);
        seen.add(k);
      }
      // next round splices right after the middle card, before its immediate neighbour
      lo = ks[1];
      hi = ks[2];
    }
    expect(isSorted(Array.from(seen).sort())).toBe(true);
  });
});

describe("buildDetourRows", () => {
  const current = { idx: "a1", detourId: null, payload: { topicNodeId: "n2" } };

  it("wraps cards in open/close markers with keys between current and next", () => {
    const rows = buildDetourRows({ sessionId, detourId: "d1", question: "wait, what is a TTL?", current, next: { idx: "a2" }, cards: [concept(1), concept(2)] });
    expect(rows.map((r) => r.type)).toEqual(["detour_marker", "concept", "concept", "detour_marker"]);
    expect(isSorted(rows.map((r) => r.idx))).toBe(true);
    for (const r of rows) {
      expect(r.idx > "a1" && r.idx < "a2").toBe(true);
      expect(r.detourId).toBe("d1");
      expect(r.payload.detourId).toBe("d1");
      expect(r.payload.topicNodeId).toBe("n2");
      expect(r.sessionId).toBe(sessionId);
      expect(r.viewedAt).toBeNull();
      expect(r.id).toBe(r.payload.id);
      expect(CardSchema.safeParse(r.payload).success).toBe(true);
      expect(findBannedInValue(r.payload)).toBeNull();
    }
    const open = rows[0].payload as { kind: string; question?: string; label: string };
    const close = rows[3].payload as { kind: string; label: string };
    expect(open.kind).toBe("open");
    expect(open.question).toBe("wait, what is a TTL?");
    expect(open.label).toBe("detour: your question");
    expect(close.kind).toBe("close");
    expect(close.label).toBe("back to the main thread");
  });

  it("appends after the last card when there is no next card", () => {
    const rows = buildDetourRows({ sessionId, detourId: "d1", question: "q", current, next: null, cards: [concept(1)] });
    expect(rows.every((r) => r.idx > "a1")).toBe(true);
    expect(isSorted(rows.map((r) => r.idx))).toBe(true);
  });

  it("nested detour: splicing between two detour cards keeps the whole feed sorted", () => {
    const outer = buildDetourRows({ sessionId, detourId: "d1", question: "outer", current, next: { idx: "a2" }, cards: [concept(1), concept(2), concept(3)] });
    const innerCurrent = { idx: outer[2].idx, detourId: "d1", payload: { topicNodeId: "n2" } };
    const inner = buildDetourRows({ sessionId, detourId: "d2", question: "inner", current: innerCurrent, next: { idx: outer[3].idx }, cards: [concept(4), concept(5)] });
    const feed = [{ idx: "a1" }, ...outer, ...inner, { idx: "a2" }].map((r) => r.idx).sort();
    expect(isSorted(feed)).toBe(true);
    // in sorted order the inner rows sit between outer[2] and outer[3]
    const order = [...outer, ...inner].sort((a, b) => (a.idx < b.idx ? -1 : 1)).map((r) => r.detourId);
    expect(order).toEqual(["d1", "d1", "d1", "d2", "d2", "d2", "d2", "d1", "d1"]);
    expect(inner.every((r) => r.detourId === "d2")).toBe(true);
  });

  it("truncates a long question to the marker limit", () => {
    const rows = buildDetourRows({ sessionId, detourId: "d1", question: "x".repeat(300), current, next: null, cards: [concept(1)] });
    expect(CardSchema.safeParse(rows[0].payload).success).toBe(true);
  });
});
