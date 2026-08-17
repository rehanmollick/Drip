/**
 * Shared text helpers for ingestion. Pure, no I/O.
 */

/** Collapse whitespace but keep paragraph breaks (max one blank line). */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Hard cap with an explicit marker so the planner knows text was cut. */
export function capText(s: string, max: number, marker = "\n\n[… truncated]"): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - marker.length)).trimEnd() + marker;
}
