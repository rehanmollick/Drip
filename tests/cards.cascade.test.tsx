import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font only exists inside the Next compiler; the theme this renders under is not the point here
vi.mock("@/components/theme/ThemeRoot", () => ({
  useTheme: () => ({ theme: null, spring: { type: "spring" }, reduced: false, staggerMs: 60 }),
}));

import { Glossed } from "@/components/cards/Glossed";
import { claimTerms, ledeAndRest, sentenceRuns, splitGlossed } from "@/components/cards/helpers";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import { WORST_CARDS } from "@/lib/feed/worst";

/**
 * The cascade is allowed to change WHEN a sentence appears and nothing else.
 * The moment it changes what the card says — a dropped space, a term
 * underlined twice, a word cut in half — it stops being motion and becomes a
 * content bug, on a surface that can't scroll to reveal what it lost.
 */

const TERMS = [
  { term: "TTL", gloss: "time to live" },
  { term: "stampede", gloss: "everyone missing at once" },
];

/** Every string in the deck that actually renders through <Glossed>. */
const COPY: string[] = [];
for (const c of [...SAMPLE_CARDS, ...WORST_CARDS]) {
  if (c.type === "concept") COPY.push(c.body);
  if (c.type === "stat") COPY.push(c.context);
  if (c.type === "recap") COPY.push(...c.beats);
  if (c.type === "wrap") COPY.push(...c.beats);
  if (c.type === "hook" && c.sub) COPY.push(c.sub);
  if (c.type === "checkpoint" && c.sub) COPY.push(c.sub);
  if (c.type === "slider" && c.insight) COPY.push(c.insight);
  if (c.type === "binary") COPY.push(c.revealCopy);
  if (c.type === "sequence") COPY.push(c.revealCopy);
  if (c.type === "predict") COPY.push(c.revealBody);
}

/** Text as the reader sees it, out of server markup. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const countTerms = (html: string) => (html.match(/data-gloss-term=/g) ?? []).length;

describe("sentenceRuns", () => {
  it("is lossless for every piece of copy in the deck", () => {
    for (const text of COPY) {
      const segs = splitGlossed(text, TERMS);
      expect(sentenceRuns(segs).flat().map((s) => s.text).join("")).toBe(text);
    }
  });

  it("never cuts a glossed term across two runs", () => {
    for (const text of COPY) {
      const segs = splitGlossed(text, TERMS);
      const runs = sentenceRuns(segs);
      const glossed = runs.flat().filter((s) => s.gloss);
      expect(glossed.map((s) => s.text)).toEqual(segs.filter((s) => s.gloss).map((s) => s.text));
    }
  });

  it("breaks a paragraph on its sentences, not on its glossed words", () => {
    const text = "A cached answer is stale. A TTL shrinks the window. Nothing closes it.";
    const runs = sentenceRuns(splitGlossed(text, TERMS));
    expect(runs.length).toBe(3);
    expect(runs[1].map((s) => s.text).join("")).toBe("A TTL shrinks the window. ");
  });

  it("keeps a decimal or an abbreviation inside one run", () => {
    const runs = sentenceRuns(splitGlossed("it costs 0.2ms, i.e. nothing at all.", null));
    expect(runs.length).toBe(1);
  });
});

describe("<Glossed cascade>", () => {
  it("renders byte-identical text and the same underlines as the plain copy", () => {
    for (const text of COPY) {
      const plain = renderToStaticMarkup(<Glossed text={text} terms={TERMS} />);
      const beats = renderToStaticMarkup(<Glossed text={text} terms={TERMS} cascade />);
      expect(textOf(beats)).toBe(textOf(plain));
      expect(countTerms(beats)).toBe(countTerms(plain));
    }
  });

  it("wraps each sentence in its own piece", () => {
    const text = "one thing is true. another thing is also true.";
    const beats = renderToStaticMarkup(<Glossed text={text} cascade />);
    expect((beats.match(/data-beat=/g) ?? []).length).toBe(2);
    expect(renderToStaticMarkup(<Glossed text={text} />)).not.toContain("data-beat");
  });
});

describe("splitting copy between two blocks", () => {
  it("ledeAndRest rejoins to the body it came from", () => {
    for (const text of COPY) {
      const { lede, rest } = ledeAndRest(text);
      expect(lede + rest).toBe(text);
    }
  });

  it("claimTerms hands each term to exactly one block", () => {
    const body = "a TTL is a countdown. a stampede is everyone missing at once.";
    const { lede, rest } = ledeAndRest(body);
    const { claimed, left } = claimTerms(lede, TERMS);
    expect(claimed.map((t) => t.term)).toEqual(["TTL"]);
    expect(left.map((t) => t.term)).toEqual(["stampede"]);
    // and the elaboration still underlines the one it was handed
    expect(splitGlossed(rest, left).some((s) => s.gloss)).toBe(true);
  });
});
