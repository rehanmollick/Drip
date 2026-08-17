import { describe, expect, it } from "vitest";
import { CardSchema, CARD_TYPES } from "@/lib/schemas/cards";
import { WORST_CARDS } from "@/lib/feed/worst";

describe("worst-case fixtures", () => {
  it("every card validates and every card type is covered", () => {
    for (const c of WORST_CARDS) {
      const r = CardSchema.safeParse(c);
      expect(r.success, `${c.type}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`).toBe(true);
    }
    const types = new Set(WORST_CARDS.map((c) => c.type));
    for (const t of CARD_TYPES) expect(types.has(t), t).toBe(true);
  });
});
