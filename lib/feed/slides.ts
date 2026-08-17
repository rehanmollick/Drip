import type { Card, PredictCard } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import type { Slide } from "@/components/cards/types";

/**
 * Feed ordering + slide expansion (pure; unit-tested in tests/feed.slides.test.ts).
 *
 * Cards are ordered by `idx` — fractional-indexing string keys compared as
 * plain strings (lexicographic). Ties (never expected) fall back to id so the
 * order is total and stable.
 */
export function compareIdx(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortCards(cards: readonly CardRow[]): CardRow[] {
  return [...cards].sort((a, b) => compareIdx(a.idx, b.idx) || compareIdx(a.id, b.id));
}

/** Merge by id (incoming wins), then sort by idx. Never mutates inputs. */
export function mergeCards(existing: readonly CardRow[], incoming: readonly CardRow[]): CardRow[] {
  if (incoming.length === 0) return sortCards(existing);
  const byId = new Map<string, CardRow>();
  for (const c of existing) byId.set(c.id, c);
  for (const c of incoming) byId.set(c.id, c);
  return sortCards([...byId.values()]);
}

/** Drop UNVIEWED main-thread cards with idx > after (mirrors the server after a dial). */
export function dropUnviewedAfter(cards: readonly CardRow[], after: string | null): CardRow[] {
  if (after === null) return [...cards];
  return cards.filter((c) => !(c.detourId === null && c.viewedAt === null && compareIdx(c.idx, after) > 0));
}

/** One card → one slide, except `predict` which expands into [question, reveal]. */
export function toSlides(cards: readonly CardRow[]): Slide[] {
  const out: Slide[] = [];
  for (const row of sortCards(cards)) {
    const card = row.payload as Card;
    out.push({ kind: "card", key: row.id, card, rowId: row.id, idx: row.idx });
    if (card.type === "predict") {
      out.push({ kind: "predict_reveal", key: `${row.id}:reveal`, card: card as PredictCard, rowId: row.id, idx: row.idx });
    }
  }
  return out;
}

/** Slides that belong to a real card row (not client-side pseudo notices). */
export function isRowSlide(s: Slide): s is Extract<Slide, { kind: "card" | "predict_reveal" }> {
  return s.kind === "card" || s.kind === "predict_reveal";
}

/** Ordinal of a row among the session's cards (position semantics for PATCH position). */
export function ordinalOf(cards: readonly CardRow[], rowId: string): number {
  const i = cards.findIndex((c) => c.id === rowId);
  return i < 0 ? 0 : i;
}
