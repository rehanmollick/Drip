/**
 * Prime Directive rule 1: never use school vocabulary on screen. These words are
 * fine in code; they must never appear in a user-facing string. Enforced by
 * tests (tests/banned-words.test.ts) over UI copy and sample cards, and stated
 * in every writer prompt.
 */
export const BANNED_WORDS = [
  "quiz", "test", "lesson", "module", "objective", "curriculum",
  "assessment", "exam", "chapter", "homework", "syllabus",
] as const;

/**
 * Object keys whose values are NEVER rendered as copy — ids, references, raw
 * code, formulas, highlighter output. Shared by the banned-word scan/scrub and
 * the markup stripper (lib/copy/sanitize.ts) so a `module.exports` in a code
 * card or an edge pointing at node id "test" is left exactly as written.
 */
export const NON_COPY_KEYS: ReadonlySet<string> = new Set([
  "id", "topicNodeId", "detourId", "reason", "retryKey", "key", "lang", "expression", "highlighted",
  "code",       // code cards: raw source (spec §0.1 "in code these words are fine")
  "from", "to", // diagram edges reference node ids
  "idx",
]);

const re = new RegExp(`\\b(${BANNED_WORDS.join("|")})(s|es)?\\b`, "i");

/** Returns the first banned word found in `text`, or null. Word-boundary match, case-insensitive. */
export function findBannedWord(text: string): string | null {
  const m = re.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Deep-scan any JSON value's string leaves (non-copy keys exempt). */
export function findBannedInValue(value: unknown, path = "$"): { path: string; word: string } | null {
  if (typeof value === "string") {
    const w = findBannedWord(value);
    return w ? { path, word: w } : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findBannedInValue(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NON_COPY_KEYS.has(k)) continue;
      const r = findBannedInValue(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Feed-native replacements, used ONLY as a last resort after the LLM retry still
 * contains a banned word. Every replacement is no longer than the word it
 * replaces (plural included) so a scrubbed string can never outgrow a schema cap
 * — scrubbing runs AFTER Zod. Enforced by tests/sanitize.test.ts.
 */
export const REPLACEMENTS: Record<(typeof BANNED_WORDS)[number], string> = {
  quiz: "bet", test: "try", lesson: "bit", module: "part", objective: "goal",
  curriculum: "path", assessment: "check", exam: "bet", chapter: "part", homework: "practice", syllabus: "outline",
};

function pluralize(base: string): string {
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + "ies"; // try → tries
  if (/(s|x|z|ch|sh)$/.test(base)) return base + "es";
  return base + "s";
}

/** Replace banned words (keeping plurals + capitalisation of the first letter) in a string. */
export function scrubBannedText(text: string): string {
  return text.replace(new RegExp(`\\b(${BANNED_WORDS.join("|")})(s|es)?\\b`, "gi"), (m, w: string, pl: string | undefined) => {
    const base = REPLACEMENTS[w.toLowerCase() as (typeof BANNED_WORDS)[number]] ?? "bit";
    const withPlural = pl ? pluralize(base) : base;
    return m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? withPlural[0].toUpperCase() + withPlural.slice(1) : withPlural;
  });
}

/** Deep-scrub every user-facing string leaf (same exemptions as findBannedInValue). Returns a new value. */
export function scrubBannedValue<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubBannedText(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = NON_COPY_KEYS.has(k) ? x : walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
