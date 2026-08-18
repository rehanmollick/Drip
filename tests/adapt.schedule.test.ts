import { describe, expect, it } from "vitest";
import {
  anchorMemories, CROSS_NODE_EVERY, dueAnchors, FAR_GAP, FIRST_CALLBACK_ORDINAL, IMMEDIATE_CREDIT,
  MAX_ASKS, NEAR_CREDIT, NEAR_GAP, PULL_FORWARD_GAP, pullForward, RETIRE_AFTER_WINS, spacingCredit,
  type AnchorMemory,
} from "@/lib/adapt/schedule";
import { anchorOf, mergeAnchor, stemAnchor } from "@/lib/adapt/anchors";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow, Interaction } from "@/lib/schemas/session";

const at = "2026-08-16T10:00:00.000Z";
const uuid = (n: number) => `4d4a5b6c-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Rows at fixed ordinals: `plan` is sparse, the gaps get filled with filler cards nobody joins on. */
function rows(plan: Record<number, Card>, length: number, answers: Record<number, Interaction> = {}): CardRow[] {
  const out: CardRow[] = [];
  for (let i = 0; i < length; i++) {
    const payload = plan[i] ?? ({
      id: uuid(900 + i), type: "hook", topicNodeId: "filler", detourId: null,
      anchor: `filler-${i}`, headline: `filler ${i}`,
    } as Card);
    out.push({
      id: payload.id, sessionId: uuid(1), idx: `a${String(i).padStart(4, "0")}`, type: payload.type,
      payload, detourId: null, batchId: null, viewedAt: null, interaction: answers[i] ?? null, createdAt: at,
    });
  }
  return out;
}

const concept = (n: number, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(n), type: "concept", topicNodeId: nodeId, detourId: null, anchor,
  headline: "a cache is a bet on repetition", body: "b",
});
const bet = (n: number, anchor: string, nodeId = "n1"): Card => ({
  id: uuid(n), type: "binary", topicNodeId: nodeId, detourId: null, anchor,
  prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1, revealCopy: "nah", difficulty: 2,
});
const hit: Interaction = { choice: 1, correct: true, at };
const miss: Interaction = { choice: 0, correct: false, at };

const memory = (over: Partial<AnchorMemory> = {}): AnchorMemory => ({
  anchor: "cache-stampede", nodeId: "n1", label: "the stampede", taughtAt: 0, lastTouchedAt: 0,
  lastAskedAt: null, asks: 0, wins: 0, strength: 0, ...over,
});
const due = (over: Partial<Parameters<typeof dueAnchors>[0]> = {}) => dueAnchors({
  memories: [memory()], viewedOrdinal: 40, nodeId: "n1", pace: "normal", chillMode: false, ...over,
});

describe("anchors: the join between teaching an idea and betting on it", () => {
  it("uses the writer's slug, and stems one from the copy when it forgot", () => {
    expect(anchorOf(concept(2, "cache-stampede"))).toBe("cache-stampede");
    const unstamped = { ...concept(2, "cache-stampede"), anchor: undefined } as Card;
    expect(anchorOf(unstamped)).toBe("cache-bet-repetition");
    expect(stemAnchor("why is the TTL so short?!")).toBe("ttl-short");
    expect(stemAnchor("?! …")).toBe("idea");
  });

  it("merges two slugs for one idea, and NEVER across nodes", () => {
    const known = [{ anchor: "cache-stampede", nodeId: "n1" }];
    expect(mergeAnchor(known, { anchor: "stampede-cache-cold", nodeId: "n1" })).toBe("cache-stampede");
    // one shared word is a coincidence, not the same idea
    expect(mergeAnchor(known, { anchor: "cache-key", nodeId: "n1" })).toBe("cache-key");
    // the same slug in another node stays its own idea — collapsing them would erase the pair
    // that interleaving exists to keep apart
    expect(mergeAnchor(known, { anchor: "stampede-cache-cold", nodeId: "n2" })).toBe("stampede-cache-cold");
  });
});

describe("schedule: what a retrieval is worth", () => {
  it("a delayed hit is worth at least 3× an immediate one", () => {
    expect(spacingCredit(0)).toBe(IMMEDIATE_CREDIT);
    expect(spacingCredit(NEAR_GAP - 1)).toBe(IMMEDIATE_CREDIT);
    expect(spacingCredit(NEAR_GAP)).toBe(NEAR_CREDIT);
    expect(spacingCredit(NEAR_GAP)).toBeGreaterThanOrEqual(spacingCredit(0) * 3);
    expect(spacingCredit(FAR_GAP)).toBeGreaterThan(spacingCredit(NEAR_GAP));

    const soon = anchorMemories(rows({ 0: concept(2, "ttl"), 2: bet(3, "ttl") }, 20, { 2: hit }));
    const later = anchorMemories(rows({ 0: concept(2, "ttl"), 12: bet(3, "ttl") }, 20, { 12: hit }));
    const s = soon.find((m) => m.anchor === "ttl")!;
    const l = later.find((m) => m.anchor === "ttl")!;
    expect(l.strength).toBeGreaterThanOrEqual(s.strength * 3);
  });

  it("reading is not retrieval: only being asked builds strength", () => {
    const read = anchorMemories(rows({ 0: concept(2, "ttl"), 12: concept(3, "ttl") }, 20));
    const m = read.find((x) => x.anchor === "ttl")!;
    expect(m.strength).toBe(0);
    expect(m.asks).toBe(0);
    expect(m.taughtAt).toBe(0);
    expect(m.lastTouchedAt).toBe(12);
  });

  it("a failed retrieval takes strength back off", () => {
    const both = anchorMemories(rows({ 0: concept(2, "ttl"), 12: bet(3, "ttl"), 14: bet(4, "ttl") }, 20, { 12: hit, 14: miss }));
    const m = both.find((x) => x.anchor === "ttl")!;
    expect(m.strength).toBe(NEAR_CREDIT / 2);
    expect(m.asks).toBe(2);
    expect(m.wins).toBe(1);
    expect(m.lastAskedAt).toBe(14);
  });

  it("chill mode never builds any strength — there is nothing to answer", () => {
    // chill mode strips every scored type from the deck, so the record is all reading
    const chill = anchorMemories(rows({ 0: concept(2, "ttl"), 8: concept(3, "ttl"), 16: concept(4, "eviction") }, 20));
    expect(chill.every((m) => m.strength === 0 && m.asks === 0)).toBe(true);
    expect(due({ memories: chill, chillMode: true })).toEqual([]);
  });
});

describe("schedule: the four suppressors", () => {
  it("NEVER asks about an anchor taught further down than the reader has got to", () => {
    // the writing frontier runs 4-16 rows ahead of the thumb; those cards are in `memories` and
    // must never come back as a callback, or the feed asks about a card that isn't on screen yet
    const ahead = memory({ anchor: "runway", taughtAt: 41, lastTouchedAt: 41 });
    expect(due({ memories: [ahead], viewedOrdinal: 40 })).toEqual([]);
    expect(due({ memories: [ahead], viewedOrdinal: 41 + NEAR_GAP })).toHaveLength(1);
    for (let v = 0; v < 80; v++) {
      for (const m of dueAnchors({ memories: [ahead, memory()], viewedOrdinal: v, nodeId: "n1", pace: "normal", chillMode: false })) {
        expect(m.taughtAt).toBeLessThanOrEqual(v);
      }
    }
  });

  it("says nothing at all in the first stretch of the session", () => {
    expect(due({ viewedOrdinal: FIRST_CALLBACK_ORDINAL - 1 })).toEqual([]);
    expect(due({ viewedOrdinal: FIRST_CALLBACK_ORDINAL })).toHaveLength(1);
  });

  it("stays quiet while the reader is flicking", () => {
    expect(due({ pace: "compress" })).toEqual([]);
    expect(due({ pace: "normal" })).toHaveLength(1);
  });

  it("hops topic at most once a batch, and not two batches running", () => {
    const other = memory({ anchor: "eviction", nodeId: "n2", label: "eviction" });
    const another = memory({ anchor: "ttl", nodeId: "n3", label: "ttl", taughtAt: 1, lastTouchedAt: 1 });
    const both = due({ memories: [other, another], batchIndex: 9, lastCrossNodeBatch: null });
    expect(both).toHaveLength(1);
    expect(due({ memories: [other, another], batchIndex: 9, lastCrossNodeBatch: 8 })).toEqual([]);
    expect(due({ memories: [other, another], batchIndex: 9, lastCrossNodeBatch: 9 - CROSS_NODE_EVERY })).toHaveLength(1);
    // an in-node callback is never rationed by the cross-node budget
    expect(due({ memories: [memory(), other], batchIndex: 9, lastCrossNodeBatch: 8 })).toHaveLength(1);
  });
});

describe("schedule: the two gaps", () => {
  it("waits the near gap for the first callback and the far gap for the second", () => {
    const fresh = memory({ taughtAt: 20, lastTouchedAt: 20 });
    expect(due({ memories: [fresh], viewedOrdinal: 20 + NEAR_GAP - 1 })).toEqual([]);
    expect(due({ memories: [fresh], viewedOrdinal: 20 + NEAR_GAP })).toHaveLength(1);
    const asked = memory({ taughtAt: 20, lastTouchedAt: 31, lastAskedAt: 31, asks: 1, wins: 1, strength: 3 });
    expect(due({ memories: [asked], viewedOrdinal: 31 + FAR_GAP - 1 })).toEqual([]);
    expect(due({ memories: [asked], viewedOrdinal: 31 + FAR_GAP })).toHaveLength(1);
  });

  it("stops asking once they own it, and stops nagging even when they don't", () => {
    expect(due({ memories: [memory({ asks: 2, wins: RETIRE_AFTER_WINS, lastAskedAt: 1 })] })).toEqual([]);
    expect(due({ memories: [memory({ asks: MAX_ASKS, wins: 0, lastAskedAt: 1 })] })).toEqual([]);
  });

  it("a scroll-back pulls the idea forward past the near gap", () => {
    const fresh = memory({ taughtAt: 20, lastTouchedAt: 20 });
    const soon = 20 + PULL_FORWARD_GAP;
    expect(due({ memories: [fresh], viewedOrdinal: soon })).toEqual([]);
    expect(due({ memories: [fresh], viewedOrdinal: soon, pulled: ["cache-stampede"] })).toHaveLength(1);
  });

  it("pullForward is a two-slot queue, newest last, never a backlog", () => {
    let q = pullForward([], "ttl");
    q = pullForward(q, "eviction");
    expect(q).toEqual(["ttl", "eviction"]);
    q = pullForward(q, "ttl");
    expect(q).toEqual(["eviction", "ttl"]);
    q = pullForward(q, "stampede");
    expect(q).toEqual(["ttl", "stampede"]);
    expect(pullForward(q, "  ")).toEqual(q);
  });

  it("hands back the most overdue first, weakest as the tie-break, two tops", () => {
    const old = memory({ anchor: "a", taughtAt: 0, lastTouchedAt: 0, strength: 3 });
    const older = memory({ anchor: "b", taughtAt: 0, lastTouchedAt: 0, strength: 0 });
    const recent = memory({ anchor: "c", taughtAt: 25, lastTouchedAt: 25 });
    const out = due({ memories: [old, recent, older], viewedOrdinal: 40 });
    expect(out.map((m) => m.anchor)).toEqual(["b", "a"]);
  });
});
