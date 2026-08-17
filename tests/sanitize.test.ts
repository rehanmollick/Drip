import { describe, expect, it } from "vitest";
import { stripInlineMarkup, stripMarkupValue } from "@/lib/copy/sanitize";
import { scrubBannedText, scrubBannedValue, findBannedInValue } from "@/lib/copy/banned";

describe("copy sanitize", () => {
  it("strips emphasis/bold/ticks but keeps words", () => {
    expect(stripInlineMarkup("eviction reads your *request*, not your **meter**. run `kubectl top`.")).toBe("eviction reads your request, not your meter. run kubectl top.");
    expect(stripInlineMarkup("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24"); // bare asterisks in math stay
  });
  it("leaves code fields alone", () => {
    const v = stripMarkupValue({ type: "code", code: "const a = `x`; // *keep*", title: "*title*" });
    expect(v.code).toBe("const a = `x`; // *keep*");
    expect(v.title).toBe("title");
  });
  it("scrubs banned words with feed-native synonyms", () => {
    expect(scrubBannedText("test the model")).toBe("try the model");
    expect(scrubBannedText("Quiz time: two lessons")).toBe("Bet time: two bits");
    const v = scrubBannedValue({ cards: [{ eyebrow: "pop quiz", topicNodeId: "test-node" }] });
    expect(findBannedInValue(v)).toBeNull();
    expect(v.cards[0].topicNodeId).toBe("test-node");
  });
});
