import { PROSE_CARD_TYPES, VISUAL_CARD_TYPES, type Card, type CardType } from "@/lib/schemas/cards";

/**
 * The variety governor.
 *
 * The reader's words: "70% of the cards generated are literally the same, it's
 * just title screen + a verbose paragraph." The prompt asks for variety; this
 * file is what happens when the model asks anyway. Pure, no I/O.
 *
 * Two halves:
 *   (a) `varietyDirectives()` — BEFORE the call: reads the shapes already on
 *       screen and returns lines for `extraDirectives` plus a narrowed
 *       `allowedTypes` (the writer literally cannot emit a concept when the
 *       last stretch was all concepts).
 *   (b) `enforceVariety()` — AFTER validation: drops the cards that still break
 *       the rules. It never retries and never throws the batch away; a short
 *       batch is better than four paragraphs in a row.
 *
 * Rules:
 *   R1 adjacency  — never two prose cards (concept/recap) back to back, and the
 *                   comparison crosses the batch boundary (the last card already
 *                   on screen counts).
 *   R2 concept cap— at most 2 concept cards in any window of 4 consecutive cards.
 *   R3 visual     — every batch of 3+ carries at least one VISUAL_CARD_TYPES
 *                   card. Not fixable by dropping, so it only escalates the
 *                   directives for the next batch.
 *   A concept card with no `visual` is "prose-heavy" — the exact shape the
 *   reader complained about — and weighs double when measuring a stretch.
 */

export const VARIETY_WINDOW = 4;
export const MAX_CONCEPTS_PER_WINDOW = 2;
/** A batch this size or larger must carry a visual card. */
export const MIN_BATCH_FOR_VISUAL = 3;
/** How many recent shapes the directives look back over. */
export const LOOKBACK = 6;

const PROSE = new Set<CardType>(PROSE_CARD_TYPES);
const VISUAL = new Set<CardType>(VISUAL_CARD_TYPES);

export const isProseType = (t: CardType): boolean => PROSE.has(t);
export const isVisualType = (t: CardType): boolean => VISUAL.has(t);

/** "title screen + a verbose paragraph": a concept with nothing to look at, or a recap. */
export function isProseHeavy(card: Card): boolean {
  if (card.type === "recap") return true;
  if (card.type !== "concept") return false;
  return !card.visual || card.visual.kind === "none";
}

// ── (a) before the call ──────────────────────────────────────────────────────

export type VarietyDirectives = {
  /** Appended to WriteContext.extraDirectives. */
  lines: string[];
  /** Types removed from WriteContext.allowedTypes for this call. */
  forbidden: CardType[];
  /** Visual types this batch should reach for (already intersected with what's allowed). */
  wanted: CardType[];
};

/**
 * `pressure` is how many recent batches had to be trimmed (0 = clean). It only
 * sharpens the language and widens what gets forbidden; it never blocks a call.
 */
export function varietyDirectives(input: {
  recentTypes: readonly CardType[];
  batchSize: number;
  allowedTypes: readonly CardType[];
  pressure?: number;
}): VarietyDirectives {
  const { batchSize, allowedTypes } = input;
  const pressure = Math.max(0, input.pressure ?? 0);
  const recent = input.recentTypes.slice(-LOOKBACK);
  const wanted = VISUAL_CARD_TYPES.filter((t) => allowedTypes.includes(t));
  const lines: string[] = [];
  const forbidden: CardType[] = [];

  const last = recent[recent.length - 1];
  // the same window the post-hoc cap uses, applied forward: enough concepts in the last four cards
  // and the shape comes off the table rather than being asked about politely one more time
  const concepts = recent.slice(-VARIETY_WINDOW).filter((t) => t === "concept").length;
  const visuals = recent.filter(isVisualType).length;

  if (last !== undefined && isProseType(last)) {
    lines.push(`the card right before this batch is a "${last}" — the first card of this batch is not a concept and not a recap.`);
  }
  if (visuals === 0 && wanted.length && recent.length >= 2) {
    lines.push(`the last ${recent.length} cards had zero ${wanted.join("/")} cards. this batch opens with one of those, not with a paragraph.`);
  }
  if (concepts >= MAX_CONCEPTS_PER_WINDOW || pressure > 0) {
    // enough concepts already: take the shape off the table rather than asking nicely again
    if (wanted.length >= 2) forbidden.push("concept");
    else lines.push(`no more concept cards for now — the recent stretch is already concept-heavy.`);
  }
  if (last === "recap") forbidden.push("recap");
  if (batchSize >= MIN_BATCH_FOR_VISUAL && wanted.length) {
    lines.push(`at least one of these carries its idea as a shape, not a paragraph: ${wanted.join(", ")}.`);
  }
  if (pressure > 0) {
    lines.push(
      pressure > 1
        ? `the last ${pressure} batches had cards dropped for repeating the same shape. every card in this batch is a different type. no exceptions.`
        : `the last batch had a card dropped for repeating the same shape. vary every card in this one.`,
    );
  }
  return { lines, forbidden: dedupe(forbidden), wanted };
}

/** Remove `forbidden` from `allowed`, unless that would leave the writer with almost nothing. */
export function narrowAllowed(allowed: readonly CardType[], forbidden: readonly CardType[]): readonly CardType[] {
  if (forbidden.length === 0) return allowed;
  const next = allowed.filter((t) => !forbidden.includes(t));
  return next.length >= 4 ? next : allowed;
}

// ── (b) after validation ─────────────────────────────────────────────────────

export type VarietyRule = "adjacent_prose" | "concept_cap" | "no_visual";
export type VarietyViolation = { rule: VarietyRule; index: number; type: CardType };
export type VarietyResult = {
  kept: Card[];
  dropped: Card[];
  violations: VarietyViolation[];
};

/**
 * Walk the batch against the shapes already on screen and drop what repeats.
 * Never returns an empty batch for a non-empty input — a salvaged single card
 * still beats a hole in the feed.
 */
export function enforceVariety(recentTypes: readonly CardType[], batch: readonly Card[]): VarietyResult {
  const history: CardType[] = [...recentTypes];
  const kept: Card[] = [];
  const dropped: Card[] = [];
  const violations: VarietyViolation[] = [];

  batch.forEach((card, index) => {
    const type = card.type;
    const prev = history[history.length - 1];
    if (isProseType(type) && prev !== undefined && isProseType(prev)) {
      violations.push({ rule: "adjacent_prose", index, type });
      dropped.push(card);
      return;
    }
    if (type === "concept") {
      const window = history.slice(-(VARIETY_WINDOW - 1));
      if (window.filter((t) => t === "concept").length >= MAX_CONCEPTS_PER_WINDOW) {
        violations.push({ rule: "concept_cap", index, type });
        dropped.push(card);
        return;
      }
    }
    kept.push(card);
    history.push(type);
  });

  if (kept.length === 0 && batch.length > 0) {
    const rescue = batch.find((c) => !isProseType(c.type)) ?? batch[0];
    kept.push(rescue);
    const at = dropped.indexOf(rescue);
    if (at >= 0) dropped.splice(at, 1);
  }
  if (kept.length >= MIN_BATCH_FOR_VISUAL && !kept.some((c) => isVisualType(c.type))) {
    violations.push({ rule: "no_visual", index: -1, type: kept[0].type });
  }
  return { kept, dropped, violations };
}

/** One line for the log when cards are dropped. Internal only — never shown. */
export function describeViolations(v: readonly VarietyViolation[]): string {
  if (v.length === 0) return "clean";
  const counts = new Map<VarietyRule, number>();
  for (const x of v) counts.set(x.rule, (counts.get(x.rule) ?? 0) + 1);
  return Array.from(counts.entries()).map(([rule, n]) => `${rule}×${n}`).join(", ");
}

/** Share of a stretch that was the "headline + paragraph" shape. 0..1. */
export function proseHeavyRatio(cards: readonly Card[]): number {
  if (cards.length === 0) return 0;
  return cards.filter(isProseHeavy).length / cards.length;
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
