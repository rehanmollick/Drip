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

const re = new RegExp(`\\b(${BANNED_WORDS.join("|")})(s|es)?\\b`, "i");

/** Returns the first banned word found in `text`, or null. Word-boundary match, case-insensitive. */
export function findBannedWord(text: string): string | null {
  const m = re.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Deep-scan any JSON value's string leaves. */
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
      // internal/non-visible fields are exempt
      if (k === "id" || k === "topicNodeId" || k === "detourId" || k === "reason" || k === "retryKey" || k === "key" || k === "lang" || k === "expression" || k === "highlighted") continue;
      const r = findBannedInValue(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}
