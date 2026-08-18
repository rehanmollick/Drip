import type { Card, CardType } from "@/lib/schemas/cards";
import type { CardSummary } from "@/lib/llm-types";

/**
 * Compact summaries of recent cards for the writer's continuity window
 * (last 6 → zero repetition, no reused metaphors). Pure.
 */

const MAX_GIST = 80;

function trim(s: string, max = MAX_GIST): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function cardGist(card: Card): string {
  switch (card.type) {
    case "hook": return card.headline;
    case "concept": return card.headline;
    case "code": return card.title ?? card.code.split("\n")[0] ?? "code";
    case "diagram": return `${card.variant}: ${card.title}`;
    case "binary": return card.prompt;
    case "predict": return card.prompt;
    case "sequence": return card.prompt;
    case "slider": return card.prompt;
    case "reveal": return card.setup;
    case "checkpoint": return card.headline;
    case "recap": return card.metaphor ? `${card.headline} (${card.metaphor})` : card.headline;
    case "stat": return `${card.value}${card.unit ?? ""} ${card.label}`;
    case "open": return card.prompt;
    case "crossroads": return card.headline;
    case "wrap": return card.headline;
    case "detour_marker": return card.kind === "open" ? `detour: ${card.question ?? card.label}` : card.label;
    case "notice": return card.headline;
    case "clarify": return card.prompt;
    case "fallback": return "fallback";
    default: return (card as { type: string }).type;
  }
}

export function cardSummary(card: Card): CardSummary {
  const s: CardSummary = { type: card.type, gist: trim(cardGist(card)) };
  if (card.type === "recap" && card.metaphor) s.metaphor = card.metaphor;
  // the anchor is how the writer reuses an idea's slug instead of coining a second one, and the
  // glossed terms are what it must not spend screen defining twice. neither survives a gist.
  const anchor = (card as { anchor?: string }).anchor;
  if (anchor) s.anchor = anchor;
  const terms = (card as { terms?: { term: string }[] }).terms;
  if (terms?.length) s.terms = terms.map((t) => t.term);
  return s;
}

/**
 * Cards that carry no teaching content: they never count toward continuity or
 * the variety window, and the writer is never asked to vary against them.
 * A crossroads sits BETWEEN two batches, so the variety rules look through it.
 */
export const NON_CONTENT_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  "notice", "fallback", "detour_marker", "clarify", "crossroads", "wrap",
]);

export const isContentCard = (c: Card): boolean => !NON_CONTENT_TYPES.has(c.type);

/** Last `n` content cards (skips system/marker cards) as summaries, oldest first. */
export function recentSummaries(cards: Card[], n = 6): CardSummary[] {
  return cards.filter(isContentCard).slice(-n).map(cardSummary);
}

/** The SHAPES of the last `n` content cards, oldest first — what the variety governor reads. */
export function recentTypes(cards: Card[], n = 6): CardType[] {
  return cards.filter(isContentCard).slice(-n).map((c) => c.type);
}

/**
 * Every word the session has already glossed, oldest first. The writer gets this so `terms` goes to
 * words the reader hasn't met — re-defining "diction" on card 6 and again on card 19 spends the
 * same screen twice and reads as a feed that isn't paying attention.
 */
export function glossedTerms(cards: Card[]): string[] {
  const out = new Set<string>();
  for (const c of cards) {
    const terms = (c as { terms?: { term: string }[] }).terms;
    for (const t of terms ?? []) if (t.term.trim()) out.add(t.term.trim());
  }
  return Array.from(out);
}

/** Every metaphor already used in the session (recap cards). */
export function usedMetaphors(cards: Card[]): string[] {
  const out = new Set<string>();
  for (const c of cards) if (c.type === "recap" && c.metaphor) out.add(c.metaphor);
  return Array.from(out);
}
