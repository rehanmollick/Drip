import { NON_COPY_KEYS } from "./banned";

/**
 * The dead-prose gate.
 *
 * The reader's words: "a lot of the time it sounds like a lot of technical
 * jargon or something." The writer is a small model, and the moment the leash
 * is off it regresses to encyclopedia voice — the register of a page nobody
 * chose to read. Asking it not to in the prompt works for about one batch.
 *
 * So this is shaped exactly like lib/copy/banned.ts, which already works: a
 * literal list, a word-boundary scan, and a gate that says no. Two rules, both
 * mechanical, both cheap to be wrong about:
 *
 *   1. DEAD_PHRASES_HARD — seven institutional tells. Every one is deletable
 *      without losing a single fact: the sentence around it is always better
 *      with it cut. Rejecting one costs a card, never a meaning.
 *   2. LABEL_EYEBROW — an eyebrow reading "overview" or "part 2" is a course
 *      wearing a feed's clothes. The eyebrow is four words of prime real estate
 *      above the headline; spending it on a filing label is the giveaway.
 *
 * DEAD_PHRASES_SOFT is the tell-tale register we DON'T gate on: too easy to
 * write one of these in a genuinely good sentence. It only feeds the next
 * batch's directives.
 */

/**
 * Rejected outright. Each is a phrase that announces a definition is coming and
 * then delivers less than the words it spent — the exact texture of "sounds
 * like technical jargon". Say the thing instead.
 */
export const DEAD_PHRASES_HARD = [
  "it is important to note",
  "plays a key role",
  "refers to the process of",
  "can be thought of as",
  "is responsible for",
  "serves as a mechanism",
  "is a technique used to",
] as const;

/**
 * Never gated — the governor reads these and sharpens the NEXT batch's
 * directives. They are the same register, but each one has an honest use, and a
 * gate that drops a good card is worse than a card that says "in order to".
 */
export const DEAD_PHRASES_SOFT = [
  "in order to",
  "it is worth noting",
  "keep in mind",
  "in other words",
  "at the end of the day",
  "when it comes to",
  "a wide range of",
  "a variety of",
  "one of the most",
  "due to the fact",
  "in essence",
  "generally speaking",
  "plays an important",
  "is known as",
  "allows you to",
  "makes it possible to",
  "in the world of",
  "the fact that",
] as const;

/**
 * Eyebrows that file the card instead of naming it. Matched against the WHOLE
 * eyebrow (a leading "the" aside) so "the footgun nobody mentions" and "the
 * part everyone skips" survive — only a bare label is a label.
 */
export const LABEL_EYEBROW = [
  "overview", "introduction", "intro", "summary", "background", "basics", "fundamentals",
  "recap", "conclusion", "takeaways", "key takeaways", "key points", "definition", "definitions",
  "terminology", "glossary", "review", "agenda", "outline", "contents", "prerequisites",
  "section", "part", "step", "unit", "stage", "phase", "week", "continued",
  "getting started", "in this section", "what you will learn", "learning goals",
] as const;

const LABELS: ReadonlySet<string> = new Set(LABEL_EYEBROW);

/** "part 2", "step one", "section 3", "week 4" — a filing number, whatever it is filing. */
const NUMBERED_LABEL = /^(part|step|section|unit|stage|phase|week|round|level|day)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|last|final)$/;
/** "3 of 5", "3/5", "#4", "no. 2" — a counter, which the Prime Directive forbids on screen anywhere. */
const COUNTER_LABEL = /^(#\s*\d+|no\.?\s*\d+|\d+\s*(of|\/)\s*\d+)$/;

/** Whitespace-insensitive so "it is  important\nto note" reads the same as the literal. */
const phrasePattern = (phrase: string) => new RegExp(`\\b${phrase.split(/\s+/).join("\\s+")}\\b`, "i");
const HARD = DEAD_PHRASES_HARD.map((p) => ({ phrase: p, re: phrasePattern(p) }));
const SOFT = DEAD_PHRASES_SOFT.map((p) => ({ phrase: p, re: phrasePattern(p) }));

/** The first hard dead phrase in `text`, or null. Returns the phrase as written in the list. */
export function findDeadPhrase(text: string): string | null {
  for (const { phrase, re } of HARD) if (re.test(text)) return phrase;
  return null;
}

/** Every soft tell in `text`, deduped. Governor input only — nothing is ever rejected for these. */
export function findSoftDeadPhrases(text: string): string[] {
  return SOFT.filter(({ re }) => re.test(text)).map(({ phrase }) => phrase);
}

/** Is this eyebrow a filing label rather than a name for what the card is about? */
export function isLabelEyebrow(eyebrow: string): boolean {
  const norm = eyebrow
    .toLowerCase()
    .replace(/[.:;,!?—–-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "");
  if (!norm) return false;
  return LABELS.has(norm) || NUMBERED_LABEL.test(norm) || COUNTER_LABEL.test(norm);
}

export type StyleProblem = {
  kind: "dead_phrase" | "label_eyebrow";
  /** JSON path from the scanned root, e.g. "$.body" or "$.terms[0].gloss". */
  path: string;
  /** Path as keys, for a Zod issue. */
  keys: (string | number)[];
  /** The literal phrase (or eyebrow) that tripped it. */
  phrase: string;
};

function scan(value: unknown, keys: (string | number)[], key: string | null, eyebrows: boolean): StyleProblem | null {
  if (typeof value === "string") {
    if (eyebrows && key === "eyebrow" && isLabelEyebrow(value)) {
      return { kind: "label_eyebrow", path: pathOf(keys), keys, phrase: value.trim().toLowerCase() };
    }
    const phrase = findDeadPhrase(value);
    return phrase ? { kind: "dead_phrase", path: pathOf(keys), keys, phrase } : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = scan(value[i], [...keys, i], key, eyebrows);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NON_COPY_KEYS.has(k)) continue; // an anchor, an id, a code body — never read as copy
      const r = scan(v, [...keys, k], k, eyebrows);
      if (r) return r;
    }
  }
  return null;
}

function pathOf(keys: readonly (string | number)[]): string {
  return keys.reduce<string>((acc, k) => (typeof k === "number" ? `${acc}[${k}]` : `${acc}.${k}`), "$");
}

/** Deep-scan any JSON value's string leaves for a hard dead phrase (non-copy keys exempt). */
export function findDeadPhraseInValue(value: unknown): { path: string; keys: (string | number)[]; phrase: string } | null {
  const r = scan(value, [], null, false);
  return r ? { path: r.path, keys: r.keys, phrase: r.phrase } : null;
}

/** Everything the hard gate rejects: a dead phrase anywhere, or an eyebrow that is a filing label. */
export function findStyleProblem(value: unknown): StyleProblem | null {
  return scan(value, [], null, true);
}

/** What the writer is told when a card is rejected. Names the literal phrase and where it sits. */
export function styleProblemMessage(p: StyleProblem): string {
  return p.kind === "label_eyebrow"
    ? `eyebrow "${p.phrase}" at ${p.path} is a filing label, not a card. name the specific thing this card is about ("the footgun", "the math nobody does") or drop the eyebrow.`
    : `dead phrase "${p.phrase}" at ${p.path}. cut it and say the thing directly — the sentence is shorter and truer without it.`;
}

/** One directive naming the soft tells a recent stretch leaned on. Empty when the stretch was clean. */
export function softDeadPhraseDirective(hits: readonly string[]): string[] {
  const uniq = Array.from(new Set(hits));
  if (!uniq.length) return [];
  return [`the last stretch leaned on encyclopedia phrasing — ${uniq.map((p) => `"${p}"`).join(", ")}. none of those in this batch; say the thing straight.`];
}
