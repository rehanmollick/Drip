/**
 * Last-mile copy hygiene for AI output (server side, after Zod): the writer is
 * told "no markup inside strings", but models slip in *emphasis*, **bold**,
 * `ticks`. Strip the markers, keep the words. Raw code fields, ids and ascii
 * art are exempt (NON_COPY_KEYS + `lines`) — punctuation IS the content there.
 *
 * Every rule requires a letter/digit right inside the delimiters, so
 * `__init__`, `____`, `*~~~*`, `2 * 3 * 4` and `# of retries` survive.
 * Stripping only ever shortens a string, so it can never push validated copy
 * past a schema cap.
 */
import { NON_COPY_KEYS } from "./banned";

const EXEMPT_KEYS: ReadonlySet<string> = new Set([...NON_COPY_KEYS, "lines"]);

export function stripInlineMarkup(text: string): string {
  let out = text
    .replace(/\*\*([A-Za-z0-9](?:[^*\n]*[^*\s\n])?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([A-Za-z0-9](?:[^*\n]*[^*\s\n])?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([A-Za-z0-9](?:[^_\n]*[^_\s\n])?)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1");
  // markdown headings only make sense in a multi-line body; "# of retries matters" is copy.
  if (out.includes("\n")) out = out.replace(/^#{1,4}\s+(?=[A-Za-z0-9])/gm, "");
  return out;
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
