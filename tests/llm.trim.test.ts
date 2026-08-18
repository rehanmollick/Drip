import { describe, expect, it } from "vitest";
import { trimToSentence, trimTooBig, cardsSchemaFor } from "@/lib/llm";
import { WRITER_CARD_TYPES } from "@/lib/schemas/cards";

describe("trimToSentence", () => {
  it("cuts at the last sentence that fits and keeps the punctuation", () => {
    const t = "a cache is a bet on repetition. it keeps the last answer in memory. the disk never wakes up twice.";
    const out = trimToSentence(t, 70)!;
    expect(out).toBe("a cache is a bet on repetition. it keeps the last answer in memory.");
    expect(out.length).toBeLessThanOrEqual(70);
  });

  it("handles ! ? … and a terminator sitting exactly on the cap", () => {
    expect(trimToSentence("real or nah? the db still answers, just slower.", 12)).toBe("real or nah?");
    expect(trimToSentence("stop! then go on forever and ever and ever", 5)).toBe("stop!");
    expect(trimToSentence("wait for it… the payoff lands here.", 13)).toBe("wait for it…");
  });

  it("refuses rather than publishing a stump", () => {
    // one long sentence: no boundary to cut at
    expect(trimToSentence("x".repeat(400), 240)).toBeNull();
    // a boundary exists but keeping it would throw away most of the cap
    expect(trimToSentence("ok. " + "x".repeat(300), 240)).toBeNull();
  });

  it("passes short text through untouched", () => {
    expect(trimToSentence("short.", 240)).toBe("short.");
  });
});

describe("trimTooBig", () => {
  const schema = cardsSchemaFor(WRITER_CARD_TYPES);
  const card = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), type: "binary", topicNodeId: "n1", detourId: null,
    prompt: "kill redis and the site dies", options: ["real", "nah"], correctIndex: 1,
    revealCopy: "nah — the db still answers, just slower.", difficulty: 2, ...over,
  });

  it("trims exactly the flagged field and the batch then validates", () => {
    const long =
      "nah — the db still answers, just slower. what kills you is the traffic that used to hit the cache now hitting the db at once. " +
      "that is a stampede, not an outage. it is why warmups exist, and why the first monday morning after a restart is the one that takes the site down.";
    const parsed = { cards: [card(), card({ revealCopy: long })] };
    const err = schema.safeParse(parsed).error!;
    const t = trimTooBig(parsed, err)!;
    expect(t.trimmed).toEqual(["cards.1.revealCopy"]);
    const after = schema.safeParse(t.value);
    expect(after.success).toBe(true);
    const trimmedCard = after.data!.cards[1] as { revealCopy: string };
    expect(trimmedCard.revealCopy.length).toBeLessThanOrEqual(240);
    expect(trimmedCard.revealCopy.endsWith(".")).toBe(true);
    // untouched card is byte-identical, and the input was not mutated
    expect(after.data!.cards[0]).toEqual(parsed.cards[0]);
    expect((parsed.cards[1] as { revealCopy: string }).revealCopy).toBe(long);
  });

  it("returns null when nothing is trimmable (wrong type, unsplittable text)", () => {
    const parsed = { cards: [card({ revealCopy: "x".repeat(400) })] };
    expect(trimTooBig(parsed, schema.safeParse(parsed).error!)).toBeNull();
    const badType = { cards: [card({ correctIndex: 5 })] };
    expect(trimTooBig(badType, schema.safeParse(badType).error!)).toBeNull();
  });

  it("reaches into arrays (recap beats)", () => {
    const beats = [
      "a cache is the sticky note on your fridge: the answer you keep reaching for.",
      "a miss means the note isn't there yet, so you dig through the drawer. that drawer is the database, and it is slow, and everyone is waiting on it right now.",
      "ttl is the note yellowing and falling off, on purpose.",
    ];
    const parsed = { cards: [{ id: crypto.randomUUID(), type: "recap", topicNodeId: "n1", detourId: null, headline: "same idea, new angle", beats }] };
    const t = trimTooBig(parsed, schema.safeParse(parsed).error!)!;
    expect(t.trimmed).toEqual(["cards.0.beats.1"]);
    expect(schema.safeParse(t.value).success).toBe(true);
  });
});
