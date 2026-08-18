import { describe, expect, it } from "vitest";
import { calledIt, streakBefore } from "@/lib/feed/progress";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow, Interaction } from "@/lib/schemas/session";

const at = "2026-08-16T10:00:00.000Z";
const uuid = (n: number) => `4d4a5b6c-0000-4000-8000-${String(n).padStart(12, "0")}`;

let seq = 0;
function row(payload: Card, interaction: Interaction | null = null): CardRow {
  seq++;
  return {
    id: payload.id, sessionId: uuid(1), idx: `a${String(seq).padStart(4, "0")}`, type: payload.type,
    payload, detourId: null, batchId: null, viewedAt: at, interaction, createdAt: at,
  };
}
const bet = (n: number, nodeId = "n1"): Card => ({
  id: uuid(n), type: "binary", topicNodeId: nodeId, detourId: null,
  prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1, revealCopy: "nah", difficulty: 2,
});
const open = (n: number): Card => ({
  id: uuid(n), type: "open", topicNodeId: "n1", detourId: null,
  prompt: "in your own words — why does an empty cache hurt the db?", rubric: "r", modelAnswer: "m", difficulty: 3,
});
const concept = (n: number): Card => ({
  id: uuid(n), type: "concept", topicNodeId: "n1", detourId: null, headline: "h", body: "b",
});

describe("progress: the streak", () => {
  it("counts the consecutive hits immediately before a row", () => {
    const cards = [
      row(bet(10), { choice: 1, correct: true, at }),
      row(bet(11), { choice: 0, correct: false, at }),
      row(bet(12), { choice: 1, correct: true, at }),
      row(concept(13)),
      row(bet(14), { choice: 1, correct: true, at }),
      row(concept(15)),
    ];
    expect(streakBefore(cards, cards[5].id)).toBe(2);
    expect(streakBefore(cards, cards[1].id)).toBe(1);
  });
});

describe("progress: called it", () => {
  it("fires when they committed and were right — and never on an unanswered card", () => {
    const answered = row(bet(20), { choice: 1, correct: true, at });
    const wrong = row(bet(21), { choice: 0, correct: false, at });
    const untouched = row(bet(22));
    const cards = [answered, wrong, untouched];
    expect(calledIt(cards, answered.id)).toBe(true);
    expect(calledIt(cards, wrong.id)).toBe(false);
    expect(calledIt(cards, untouched.id)).toBe(false);
    expect(calledIt(cards, "nope")).toBe(false);
  });

  it("never fires on a card there was nothing to call", () => {
    const read = row(concept(23), { dwellMs: 4000, at });
    expect(calledIt([read], read.id)).toBe(false);
  });

  it("a close answer is not a called it — half credit is honest, and a flex that fires on a near miss stops meaning anything", () => {
    const got = row(open(24), { text: "…", correct: true, at, feedback: { verdict: "got_it", feedback: "f", missed: [] } });
    const close = row(open(25), { text: "…", correct: true, at, feedback: { verdict: "close", feedback: "f", missed: ["ttl"] } });
    const shown = row(open(26), { choice: "shown", at });
    const cards = [got, close, shown];
    expect(calledIt(cards, got.id)).toBe(true);
    expect(calledIt(cards, close.id)).toBe(false);
    expect(calledIt(cards, shown.id)).toBe(false);
  });
});
