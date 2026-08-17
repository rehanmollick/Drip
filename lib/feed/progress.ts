import { isScored, type Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sortCards } from "./slides";

/**
 * Progress + streak, computed client-side from the card rows (pure).
 * Progress is a fraction within the CURRENT topic node — it feeds a hairline,
 * never a number on screen.
 */

export type OutlineEst = ReadonlyArray<{ id: string; estCards: number }>;

/** The outline's estimated card count for a node (0 when unknown). */
export function estCardsFor(outline: OutlineEst | undefined, nodeId: string): number {
  return outline?.find((n) => n.id === nodeId)?.estCards ?? 0;
}

/**
 * 0..1 — how far into its topic node the given card is. The denominator is the larger of the
 * cards loaded so far in the node and the outline's estimate for it, so the hairline doesn't
 * read "full" on the last loaded card and then retract when the next batch lands.
 */
export function topicProgress(cards: readonly CardRow[], rowId: string, outline?: OutlineEst): number {
  const sorted = sortCards(cards);
  const row = sorted.find((c) => c.id === rowId);
  if (!row) return 0;
  const node = (row.payload as Card).topicNodeId;
  const inNode = sorted.filter((c) => (c.payload as Card).topicNodeId === node && c.detourId === row.detourId);
  if (inNode.length === 0) return 0;
  const i = inNode.findIndex((c) => c.id === rowId);
  const denom = Math.max(inNode.length, estCardsFor(outline, node));
  return Math.min(1, Math.max(0, (i + 1) / denom));
}

/**
 * Consecutive correct scored interactions immediately before `rowId`
 * (binary / predict / sequence with a recorded `correct`). Unanswered scored
 * cards are skipped; a miss resets.
 */
export function streakBefore(cards: readonly CardRow[], rowId: string): number {
  const sorted = sortCards(cards);
  const end = sorted.findIndex((c) => c.id === rowId);
  const upTo = end < 0 ? sorted : sorted.slice(0, end);
  let streak = 0;
  for (let i = upTo.length - 1; i >= 0; i--) {
    const c = upTo[i];
    if (!isScored(c.payload as Card)) continue;
    const correct = c.interaction?.correct;
    if (correct === undefined) continue;
    if (correct) streak++;
    else break;
  }
  return streak;
}
