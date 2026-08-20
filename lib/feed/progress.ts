import { isScored, type Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { sortCards } from "./slides";

/**
 * The two things the feed reads off its own rows: the streak behind a card, and whether the reader
 * called one. Both are nods, never scores.
 *
 * Where a topic stands — how much of it exists, how much is read — lives in lib/feed/rail.ts
 * and is counted against the server's frontier, not against `estCards`. There used to be a third
 * estCards-floored fraction here; it disagreed with the bar it was meant to feed, so it is gone.
 */

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

/**
 * "called it" — two words on a reveal, and the entire on-screen footprint of the pedagogy layer
 * (lib/adapt/schedule.ts). True when the reader committed to an answer and it was right: they
 * picked, or they typed it and the grader said they had the whole move. A "close" is not a called
 * it — half credit is honest, and a flex that fires on a near miss stops meaning anything.
 *
 * Deliberately says nothing about how many, how often, or out of what. It is a nod, not a score.
 */
export function calledIt(cards: readonly CardRow[], rowId: string): boolean {
  const row = cards.find((c) => c.id === rowId);
  if (!row) return false;
  const card = row.payload as Card;
  if (!isScored(card) || row.interaction?.correct !== true) return false;
  if (card.type === "open") return row.interaction.feedback?.verdict === "got_it";
  return row.interaction.choice !== undefined;
}
