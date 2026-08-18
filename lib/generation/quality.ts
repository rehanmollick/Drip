import { NON_COPY_KEYS } from "@/lib/copy/banned";
import { COMMON_WORDS } from "@/lib/copy/common-words";
import type { Card } from "@/lib/schemas/cards";
import { stem } from "./corpus";

/**
 * The jargon governor.
 *
 * The reader's words: "a lot of the time it sounds like a lot of technical
 * jargon or something." lib/copy/style.ts gates the phrasing; this measures the
 * vocabulary — the words a card uses that the reader was never handed.
 *
 * ONE metric, deliberately. Three others were designed and cut (nominal
 * density, headline echo, specific-to-abstract ratio) because none of them had
 * ground truth: they would have been a model's guess about a model's prose.
 * This one does. The corpus is the domain's dictionary — every unusual word the
 * source actually leans on — and the card's own `terms` array is the record of
 * what has been introduced. A word that is in the first and missing from the
 * second is jargon the reader is expected to already have. That is the
 * complaint, stated as a number.
 *
 * Two halves, like lib/generation/variety.ts:
 *   (a) `qualityDirectives()` — BEFORE the call: lines for `extraDirectives`.
 *       At pressure ≥ 2 it stops being polite and names the words.
 *   (b) `corpusTerms()` + `scoreBatch()` — AFTER validation: measurement only.
 *
 * QUALITY NEVER DROPS A CARD. `enforceVariety` is the only governor allowed to
 * drop, and the hard gate in lib/copy/style.ts is the only thing allowed to
 * reject one. This file influences the NEXT batch and nothing else — an inline
 * gloss ("a ttl — how long before it expires — of 60s") is invisible to it, so
 * every score carries false positives by construction, and a false positive
 * that cost a card would push the writer straight into over-glossing.
 */

/** A word the source uses once is a passing mention; twice is its vocabulary. */
export const MIN_CORPUS_COUNT = 2;
/** Past this many unglossed domain words per card, the batch reads like a wall of jargon. */
export const MAX_UNINTRODUCED_PER_CARD = 1;
/** Enough of the domain's dictionary to judge a batch; the long tail is noise. */
export const MAX_TERMS = 80;
/** How many words a directive is willing to name before it stops being a directive. */
const MAX_NAMED = 6;

const WORD = /[a-z][a-z']*/g;

/** Lowercased word stems, in order, from any prose. Apostrophes trimmed; hyphens split. */
function words(text: string): string[] {
  return (text.toLowerCase().replace(/[-–—_/]+/g, " ").match(WORD) ?? []).map((w) => w.replace(/'s$/, "").replace(/'/g, ""));
}

/** Common in either the form written or its singular — "cows" is as ordinary as "cow". */
const isCommon = (word: string): boolean => COMMON_WORDS.has(word) || COMMON_WORDS.has(stem(word));

// ── the domain's dictionary ──────────────────────────────────────────────────

/**
 * The words this source leans on that a reader would not already have. Stems,
 * so "gluten" in the corpus still recognises "glutens" on a card.
 *
 * The stoplist is what makes this work: without it a fermentation source looks
 * like it is drowning the reader, when half of what it says is "dough",
 * "flour" and "temperature" — words everyone walked in with.
 */
export function corpusTerms(corpus: string, opts: { minCount?: number; max?: number } = {}): Set<string> {
  const minCount = opts.minCount ?? MIN_CORPUS_COUNT;
  const max = opts.max ?? MAX_TERMS;
  const counts = new Map<string, number>();
  for (const w of words(corpus)) {
    if (w.length < 3 || isCommon(w)) continue;
    const s = stem(w);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const ranked = Array.from(counts)
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max);
  return new Set(ranked.map(([w]) => w));
}

// ── the measurement ──────────────────────────────────────────────────────────

export type QualityScore = {
  /** Domain words the batch put on screen with nothing to tap. Surface forms, first-seen order. */
  unintroduced: string[];
  cards: number;
  /** Unintroduced words per card. */
  rate: number;
  /** Over the line — the next batch gets sharper directives. */
  heavy: boolean;
};

/**
 * What did this batch use that it never handed over? `introduced` carries the
 * glossary from earlier cards, so a term explained on slide 4 is not counted
 * again on slide 9.
 */
export function scoreBatch(input: {
  batch: readonly Card[];
  terms: ReadonlySet<string>;
  introduced?: Iterable<string>;
}): QualityScore {
  const { batch, terms } = input;
  const known = new Set<string>();
  for (const t of input.introduced ?? []) for (const w of words(t)) known.add(stem(w));
  // a term glossed anywhere in this batch counts as introduced for the whole batch — the
  // reader can tap it wherever it appears, and cards land seconds apart
  for (const card of batch) {
    for (const t of ("terms" in card ? card.terms : undefined) ?? []) for (const w of words(t.term)) known.add(stem(w));
  }

  const seen = new Set<string>();
  const unintroduced: string[] = [];
  for (const card of batch) {
    for (const text of copyStrings(card)) {
      for (const w of words(text)) {
        if (w.length < 3 || isCommon(w)) continue;
        const s = stem(w);
        if (!terms.has(s) || known.has(s) || seen.has(s)) continue;
        seen.add(s);
        unintroduced.push(w);
      }
    }
  }

  const cards = batch.length;
  const rate = cards ? unintroduced.length / cards : 0;
  return { unintroduced, cards, rate, heavy: rate > MAX_UNINTRODUCED_PER_CARD };
}

/**
 * Every string on a card that reaches the screen. Skips the non-copy keys
 * (ids, anchors, raw code) and the `terms` array itself — a gloss is where a
 * word gets introduced, not another place it goes unexplained.
 */
function copyStrings(card: Card): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (NON_COPY_KEYS.has(k) || k === "terms") continue;
        walk(x);
      }
    }
  };
  walk(card);
  return out;
}

// ── before the call ──────────────────────────────────────────────────────────

/**
 * `pressure` is how many recent batches came back over the line (0 = clean),
 * mirroring lib/generation/variety.ts. At 2 it stops describing the problem and
 * reads the words back.
 */
export function qualityDirectives(input: { unintroduced: readonly string[]; pressure?: number }): string[] {
  const pressure = Math.max(0, input.pressure ?? 0);
  const named = Array.from(new Set(input.unintroduced)).slice(0, MAX_NAMED);
  if (!named.length && pressure === 0) return [];
  if (pressure >= 2 && named.length) {
    return [
      `the last stretch put these on screen with nothing to tap: ${named.map((w) => `"${w}"`).join(", ")}. every one of those either goes in that card's "terms" the first time you use it, or gets replaced with words the reader already has. do not use a single one of them bare again.`,
    ];
  }
  if (named.length) {
    return [`the last stretch used words the reader was never handed. the FIRST time a word a curious outsider wouldn't have appears, it goes in that card's "terms" — it costs zero words on screen.`];
  }
  return [`keep the vocabulary earned: anything a curious outsider wouldn't have goes in "terms" the first time you use it.`];
}

/** One line for the log. Internal only — never shown. */
export function describeQuality(score: QualityScore): string {
  if (!score.unintroduced.length) return "clean";
  return `${score.unintroduced.length} unglossed in ${score.cards} cards: ${score.unintroduced.slice(0, MAX_NAMED).join(", ")}`;
}
