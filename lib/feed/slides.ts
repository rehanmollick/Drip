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

/**
 * Drop every UNVIEWED card with idx > after, on every thread (main + detours) — exactly what the
 * server's Store.deleteUnviewedAfter does after a dial / chill toggle. `after === null` means
 * "the whole unviewed runway" (a re-plan). Viewed rows are history and always stay.
 */
export function dropUnviewedAfter(cards: readonly CardRow[], after: string | null): CardRow[] {
  return cards.filter((c) => !(c.viewedAt === null && (after === null || compareIdx(c.idx, after) > 0)));
}

/**
 * THE ORDER INVARIANT: the feed's `cards` state is always sorted by idx — useFeedCards only ever
 * writes through sortCards/mergeCards, and patches/filters preserve order. Consumers on the hot
 * path (toSlides, railModel, sessionMap) therefore do NOT re-sort on every recompute; outside
 * production this checks the invariant and repairs (loudly) instead of rendering a shuffled deck.
 */
export function devSorted(cards: readonly CardRow[], who: string): readonly CardRow[] {
  if (process.env.NODE_ENV === "production") return cards;
  for (let i = 1; i < cards.length; i++) {
    if (compareIdx(cards[i - 1].idx, cards[i].idx) > 0) {
      console.warn(`[feed] ${who} was handed unsorted cards — the order invariant is broken upstream`);
      return sortCards(cards);
    }
  }
  return cards;
}

/** One card → one slide, except `predict` which expands into [question, reveal]. */
export function toSlides(cards: readonly CardRow[]): Slide[] {
  const out: Slide[] = [];
  for (const row of devSorted(cards, "toSlides")) {
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

/** True when the ISO timestamp falls on today's UTC date (the daily budget resets at UTC midnight). */
export function isTodayUtc(iso: string, now = Date.now()): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
}

/** Ordinal of a row among the session's cards (position semantics for PATCH position). */
export function ordinalOf(cards: readonly CardRow[], rowId: string): number {
  const i = cards.findIndex((c) => c.id === rowId);
  return i < 0 ? 0 : i;
}
