/**
 * Last-mile copy hygiene for AI output (server side, after Zod): the writer is
 * told "no markup inside strings", but models slip in *emphasis*, **bold**,
 * `ticks`. Strip the markers, keep the words. Raw code fields are exempt.
 */
const EXEMPT_KEYS = new Set(["id", "topicNodeId", "detourId", "reason", "retryKey", "key", "lang", "expression", "highlighted", "code", "idx"]);

export function stripInlineMarkup(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "");
}

export function stripMarkupValue<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return stripInlineMarkup(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = EXEMPT_KEYS.has(k) ? x : walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
