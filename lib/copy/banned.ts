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

/** Feed-native replacements, used ONLY as a last resort after the LLM retry still contains a banned word. */
const REPLACEMENTS: Record<string, string> = {
  quiz: "bet", test: "check", lesson: "bit", module: "part", objective: "goal",
  curriculum: "path", assessment: "check", exam: "check", chapter: "part", homework: "practice", syllabus: "outline",
};

/** Replace banned words (keeping plurals + capitalisation of the first letter) in a string. */
export function scrubBannedText(text: string): string {
  return text.replace(new RegExp(`\\b(${BANNED_WORDS.join("|")})(s|es)?\\b`, "gi"), (m, w: string, pl: string | undefined) => {
    const base = REPLACEMENTS[w.toLowerCase()] ?? "bit";
    const withPlural = pl ? base + "s" : base;
    return m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? withPlural[0].toUpperCase() + withPlural.slice(1) : withPlural;
  });
}

/** Deep-scrub every user-facing string leaf (same exemptions as findBannedInValue). Returns a new value. */
export function scrubBannedValue<T>(value: T): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return scrubBannedText(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = k === "id" || k === "topicNodeId" || k === "detourId" || k === "reason" || k === "retryKey" || k === "key" || k === "lang" || k === "expression" || k === "highlighted" ? x : walk(x, k);
      }
      return out;
    }
    void key;
    return v;
  };
  return walk(value) as T;
}
