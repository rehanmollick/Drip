import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { detourMarkers } from "@/lib/generation/system-cards";
import { nowIso } from "@/lib/id";

/**
 * Detour splicing (spec §7). A detour is open marker + N cards + close marker,
 * inserted immediately after the current card with fractional-index keys
 * strictly between the current card and the NEXT card in feed order (any
 * thread). Nesting falls out naturally: asking inside a detour splices between
 * the current detour card and the next detour card, and the child's
 * parentDetourId points at the parent. No existing row is ever rewritten.
 */

/** n keys strictly between `after` and `before` (either may be null = open end). */
export function keysBetween(after: string | null, before: string | null, n: number): string[] {
  if (n <= 0) return [];
  return generateNKeysBetween(after, before, n);
}

/** One key after `after` and before `before`. */
export function keyBetween(after: string | null, before: string | null): string {
  return generateKeyBetween(after, before);
}

export type SpliceInput = {
  sessionId: string;
  detourId: string;
  question: string;
  /** the card the user asked from */
  current: Pick<CardRow, "idx" | "detourId"> & { payload: Pick<Card, "topicNodeId"> };
  /** the card right after `current` in feed order (any thread), or null at the end */
  next: Pick<CardRow, "idx"> | null;
  /** validated detour cards from the writer (ids may be re-issued by the caller) */
  cards: Card[];
  batchId?: string | null;
};

/** Build the rows for open marker + cards + close marker, in order, with fresh keys. */
export function buildDetourRows(input: SpliceInput): CardRow[] {
  const topicNodeId = input.current.payload.topicNodeId;
  const { open, close } = detourMarkers(input.detourId, topicNodeId, input.question);
  const payloads: Card[] = [
    open,
    ...input.cards.map((c) => ({ ...c, detourId: input.detourId, topicNodeId })),
    close,
  ];
  const keys = keysBetween(input.current.idx, input.next?.idx ?? null, payloads.length);
  const createdAt = nowIso();
  return payloads.map((payload, i) => ({
    id: payload.id,
    sessionId: input.sessionId,
    idx: keys[i],
    type: payload.type,
    payload,
    detourId: input.detourId,
    batchId: input.batchId ?? null,
    viewedAt: null,
    interaction: null,
    createdAt,
  }));
}
