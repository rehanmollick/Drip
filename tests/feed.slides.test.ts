import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import type { CardRow } from "@/lib/schemas/session";
import type { Card } from "@/lib/schemas/cards";
import { compareIdx, dropUnviewedAfter, isTodayUtc, mergeCards, ordinalOf, sortCards, toSlides } from "@/lib/feed/slides";
import { streakBefore } from "@/lib/feed/progress";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, idx: string, card: Partial<Card> & { type: Card["type"] }, extra: Partial<CardRow> = {}): CardRow {
  const payload = { id: uuid(n), topicNodeId: "n1", detourId: null, ...card } as Card;
  return {
    id: uuid(n),
    sessionId: uuid(999),
    idx,
    type: card.type,
    payload,
    detourId: payload.detourId ?? null,
    batchId: null,
    viewedAt: null,
    interaction: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const concept = (n: number, idx: string, extra: Partial<CardRow> = {}) =>
  row(n, idx, { type: "concept", headline: "h", body: "b" }, extra);
const predict = (n: number, idx: string) =>
  row(n, idx, { type: "predict", prompt: "p", options: ["a", "b"], correctIndex: 0, revealHeadline: "r", revealBody: "rb", difficulty: 2 });
const binary = (n: number, idx: string, correct: boolean | null) =>
  row(n, idx, { type: "binary", prompt: "p", options: ["real", "nah"], correctIndex: 0, revealCopy: "r", difficulty: 2 },
    correct === null ? {} : { interaction: { choice: correct ? 0 : 1, correct, at: "2026-01-01T00:00:00.000Z" } });

describe("idx ordering", () => {
  it("compares fractional-indexing keys as plain strings", () => {
    const keys = generateNKeysBetween(null, null, 5);
    for (let i = 1; i < keys.length; i++) expect(compareIdx(keys[i - 1], keys[i])).toBe(-1);
    // a spliced key between a0 and a1 sorts between them lexicographically
    expect(compareIdx("a0", "a0V")).toBe(-1);
    expect(compareIdx("a0V", "a1")).toBe(-1);
  });

  it("sortCards orders by idx and never mutates the input", () => {
    const input = [concept(3, "a2"), concept(1, "a0"), concept(2, "a1")];
    const copy = [...input];
    const sorted = sortCards(input);
    expect(sorted.map((c) => c.idx)).toEqual(["a0", "a1", "a2"]);
    expect(input).toEqual(copy);
  });

  it("mergeCards dedupes by id (incoming wins) and re-sorts, so detour splices land in place", () => {
    const base = [concept(1, "a0"), concept(2, "a1"), concept(3, "a2")];
    const spliced = [concept(4, "a0V"), concept(5, "a0l"), concept(2, "a1", { viewedAt: "2026-01-01T00:00:01.000Z" })];
    const merged = mergeCards(base, spliced);
    expect(merged.map((c) => c.idx)).toEqual(["a0", "a0V", "a0l", "a1", "a2"]);
    expect(merged.find((c) => c.id === uuid(2))?.viewedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(merged).toHaveLength(5);
  });
});

describe("toSlides", () => {
  it("emits one slide per card, in idx order, keyed by row id", () => {
    const slides = toSlides([concept(2, "a1"), concept(1, "a0")]);
    expect(slides.map((s) => s.kind)).toEqual(["card", "card"]);
    expect(slides.map((s) => (s.kind === "card" ? s.rowId : ""))).toEqual([uuid(1), uuid(2)]);
    expect(slides[0].key).toBe(uuid(1));
  });

  it("expands predict into [question, predict_reveal] sharing the same rowId", () => {
    const slides = toSlides([concept(1, "a0"), predict(2, "a1"), concept(3, "a2")]);
    expect(slides.map((s) => s.kind)).toEqual(["card", "card", "predict_reveal", "card"]);
    const q = slides[1], r = slides[2];
    expect(q.kind === "card" && q.rowId).toBe(uuid(2));
    expect(r.kind === "predict_reveal" && r.rowId).toBe(uuid(2));
    expect(r.key).toBe(`${uuid(2)}:reveal`);
    expect(new Set(slides.map((s) => s.key)).size).toBe(slides.length);
  });

  it("returns [] for no cards", () => {
    expect(toSlides([])).toEqual([]);
  });
});

describe("dropUnviewedAfter (mirrors Store.deleteUnviewedAfter exactly)", () => {
  it("drops unviewed cards after the idx on EVERY thread; keeps viewed rows and rows at/before the idx", () => {
    const viewed = concept(2, "a1", { viewedAt: "2026-01-01T00:00:01.000Z" });
    const detour = concept(4, "a3", { detourId: "d1", payload: { id: uuid(4), type: "concept", topicNodeId: "n1", detourId: "d1", headline: "h", body: "b" } });
    const viewedDetour = concept(6, "a3V", { detourId: "d1", viewedAt: "2026-01-01T00:00:02.000Z", payload: { id: uuid(6), type: "concept", topicNodeId: "n1", detourId: "d1", headline: "h", body: "b" } });
    const cards = [concept(1, "a0"), viewed, concept(3, "a2"), detour, viewedDetour, concept(5, "a4")];
    const kept = dropUnviewedAfter(cards, "a0");
    expect(kept.map((c) => c.idx)).toEqual(["a0", "a1", "a3V"]);
    // never mutates the input
    expect(cards).toHaveLength(6);
  });

  it("after === null drops the whole unviewed runway (a re-plan), viewed history stays", () => {
    const viewed = concept(2, "a1", { viewedAt: "2026-01-01T00:00:01.000Z" });
    const cards = [concept(1, "a0"), viewed, concept(3, "a2")];
    expect(dropUnviewedAfter(cards, null).map((c) => c.idx)).toEqual(["a1"]);
  });
});

describe("progress + streak", () => {
  it("isTodayUtc compares UTC dates", () => {
    const now = Date.parse("2026-08-17T23:30:00.000Z");
    expect(isTodayUtc("2026-08-17T00:10:00.000Z", now)).toBe(true);
    expect(isTodayUtc("2026-08-16T23:59:59.000Z", now)).toBe(false);
    expect(isTodayUtc("garbage", now)).toBe(false);
  });

  it("streakBefore counts trailing consecutive correct scored interactions", () => {
    const cards = [binary(1, "a0", true), binary(2, "a1", false), binary(3, "a2", true), concept(4, "a3"), binary(5, "a4", true), binary(6, "a5", null), concept(7, "a6")];
    expect(streakBefore(cards, uuid(7))).toBe(2);
    expect(streakBefore(cards, uuid(3))).toBe(0);
    expect(streakBefore(cards, uuid(2))).toBe(1);
  });

  it("ordinalOf finds the row's position", () => {
    const cards = sortCards([concept(2, "a1"), concept(1, "a0")]);
    expect(ordinalOf(cards, uuid(2))).toBe(1);
    expect(ordinalOf(cards, "missing")).toBe(0);
  });
});
