import { describe, expect, it } from "vitest";
import { generateNKeysBetween } from "fractional-indexing";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sessionMap } from "@/lib/feed/map";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const OUTLINE = [
  { id: "a", title: "why pods get evicted", estCards: 4 },
  { id: "b", title: "what the scheduler sees", estCards: 4 },
  { id: "c", title: "when it all goes wrong", estCards: 4 },
];

type Spec = { node: string; detourId?: string | null; type?: Card["type"]; question?: string; viewed?: boolean };

function deck(spec: Spec[]): CardRow[] {
  const keys = generateNKeysBetween(null, null, spec.length);
  return spec.map((s, i) => {
    const type = s.type ?? "concept";
    const payload = {
      id: uuid(i + 1),
      type,
      topicNodeId: s.node,
      detourId: s.detourId ?? null,
      headline: "h",
      body: "b",
      kind: "open",
      label: "detour: your question",
      question: s.question,
    } as unknown as Card;
    return {
      id: uuid(i + 1),
      sessionId: uuid(999),
      idx: keys[i],
      type,
      payload,
      detourId: s.detourId ?? null,
      batchId: null,
      viewedAt: s.viewed ? "2026-01-01T00:00:00.000Z" : null,
      interaction: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  });
}

describe("sessionMap", () => {
  it("lists every topic in order and marks where you are", () => {
    const cards = deck([
      { node: "a", viewed: true },
      { node: "a", viewed: true },
      { node: "b" },
    ]);
    const map = sessionMap(cards, OUTLINE, uuid(3));
    expect(map.map((t) => t.title)).toEqual(OUTLINE.map((n) => n.title));
    expect(map.map((t) => t.state)).toEqual(["done", "current", "ahead"]);
    expect(map[0].firstRowId).toBe(uuid(1));
  });

  it("a topic you have been through is tappable; one still ahead is inert", () => {
    const cards = deck([{ node: "a", viewed: true }, { node: "b" }, { node: "c" }]);
    const map = sessionMap(cards, OUTLINE, uuid(2));
    expect(map[0].reachable).toBe(true);   // viewed
    expect(map[1].reachable).toBe(true);   // where you are
    expect(map[2].reachable).toBe(false);  // written, but never reached — never jump ahead
  });

  it("a topic with no cards yet is never tappable", () => {
    const map = sessionMap(deck([{ node: "a", viewed: true }]), OUTLINE, uuid(1));
    expect(map[1].firstRowId).toBeNull();
    expect(map[1].reachable).toBe(false);
  });

  it("hangs detours off the topic they branched from, labelled with the question", () => {
    const cards = deck([
      { node: "a", viewed: true },
      { node: "a", detourId: "d1", type: "detour_marker", question: "why does the kubelet care?", viewed: true },
      { node: "a", detourId: "d1", viewed: true },
      { node: "a", detourId: "d1", type: "detour_marker", viewed: true },
      { node: "a", viewed: true },
      { node: "b" },
    ]);
    const map = sessionMap(cards, OUTLINE, uuid(5));
    expect(map[0].detours).toHaveLength(1);
    expect(map[1].detours).toHaveLength(0);
    expect(map[0].detours[0].label).toBe("why does the kubelet care?");
    expect(map[0].detours[0].firstRowId).toBe(uuid(2));
    expect(map[0].detours[0].state).toBe("done");
    expect(map[0].detours[0].reachable).toBe(true);
  });

  it("marks the detour you are standing in as where you are", () => {
    const cards = deck([
      { node: "a", viewed: true },
      { node: "a", detourId: "d1", type: "detour_marker", question: "wait, why?", viewed: true },
      { node: "a", detourId: "d1" },
    ]);
    const map = sessionMap(cards, OUTLINE, uuid(3));
    expect(map[0].state).toBe("current");
    expect(map[0].detours[0].state).toBe("current");
    expect(map[0].detours[0].reachable).toBe(true);
  });

  it("is empty while there is no outline", () => {
    expect(sessionMap(deck([{ node: "a" }]), [], uuid(1))).toEqual([]);
    expect(sessionMap([], OUTLINE, null).every((t) => !t.reachable)).toBe(true);
  });
});
