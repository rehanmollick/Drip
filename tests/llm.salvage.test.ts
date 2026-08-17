import { describe, expect, it } from "vitest";
import { salvageCards, cardsSchemaFor } from "@/lib/llm";
import { WRITER_CARD_TYPES, type Card } from "@/lib/schemas/cards";

const schema = cardsSchemaFor(WRITER_CARD_TYPES);
const concept = (over: Partial<Extract<Card, { type: "concept" }>> = {}) => ({
  id: crypto.randomUUID(), type: "concept", topicNodeId: "n1", detourId: null,
  headline: "a cache is a bet on repetition", body: "short body", ...over,
});

describe("salvageCards", () => {
  it("keeps the good cards when one overshoots a cap (a 320-char body is not worth 3 lost cards)", () => {
    const parsed = { cards: [concept(), concept({ body: "x".repeat(400) }), concept(), concept()] };
    const r = salvageCards(parsed, schema, 4);
    expect(r).not.toBeNull();
    expect(r!.dropped).toBe(1);
    expect(r!.value.cards).toHaveLength(3);
    expect(schema.safeParse(r!.value).success).toBe(true);
  });

  it("returns null when nothing is wrong (the caller uses the normal path)", () => {
    expect(salvageCards({ cards: [concept(), concept()] }, schema, 2)).toBeNull();
  });

  it("returns null when most of the batch is broken — that is a retry, not a salvage", () => {
    const bad = concept({ body: "x".repeat(400) });
    expect(salvageCards({ cards: [concept(), bad, bad, bad] }, schema, 4)).toBeNull();
    expect(salvageCards({ cards: [bad] }, schema, 1)).toBeNull();
  });

  it("ignores non-batch shapes", () => {
    expect(salvageCards(null, schema, 4)).toBeNull();
    expect(salvageCards({ nope: 1 }, schema, 4)).toBeNull();
  });
});
