import { type Card, type CardType } from "@/lib/schemas/cards";
import { anchorOf } from "@/lib/adapt/anchors";
import { enforceVariety } from "./variety";

/**
 * Two reorder rules, applied after the writer returns and before the batch is persisted,
 * both within a single idea:
 *
 *   1. the GUESS comes FIRST — a scored bet (binary/predict) sorts before the concept/diagram
 *      that resolves it, so the reader commits to an answer and the very next card pays it off.
 *      Guessing before being told measurably improves what sticks even when the guess is wrong
 *      (the pretesting effect, Kornell et al. 2009), and an unanswered question is what makes a
 *      curiosity gap pull (Loewenstein 1994). This is NOT the cut "pretest card type" — no card
 *      here is designed to be missed; it only orders what the writer already wrote.
 *   2. the paragraph comes LAST — concrete cases before the abstract statement of them beats the
 *      reverse, and beats the abstraction alone (Gick & Holyoak 1983 on analogical transfer; the
 *      concreteness-fading line, Fyfe et al. 2014). A diagram of the stampede followed by the
 *      sentence that names it lands; the sentence followed by the diagram makes the diagram
 *      redundant. Contested, honestly: the effect is strongest for novices and can reverse for
 *      experts (the expertise-reversal effect, Kalyuga 2007), which is exactly why these are two
 *      narrow reorders and not a curriculum.
 *
 * Together they land one idea as: guess → the thing you can look at → the sentence that names it.
 *
 * It REORDERS AND ONLY REORDERS. The returned array is always a permutation of the input —
 * `enforceVariety` is the one governor allowed to drop a card, and if this reordering would make
 * IT drop more than the writer's own order would have, the original order wins. A pedagogically
 * tidier batch that costs the reader a card is not tidier.
 */

/** Cards that carry the idea as a thing you can look at — the "concrete" half of the rule. */
export const CONCRETE_TYPES = ["stat", "diagram", "code", "slider", "scrub"] as const;
const CONCRETE = new Set<CardType>(CONCRETE_TYPES);

/** The bets that count as a guess. Sequence is excluded: dragging an order is doing, not guessing. */
const GUESS = new Set<CardType>(["binary", "predict"]);
/** Cards that pay a guess off by explaining the idea. */
const RESOLVER = new Set<CardType>(["concept", "diagram"]);

const groupKey = (card: Card) => `${card.topicNodeId} ${anchorOf(card)}`;

/** Move every same-idea bet sitting behind the explanation to just before the first card that resolves it. */
function hoistGuess(group: readonly Card[]): Card[] {
  const firstResolver = group.findIndex((c) => RESOLVER.has(c.type));
  if (firstResolver < 0) return [...group];

  const moving = new Set<number>();
  for (let i = firstResolver + 1; i < group.length; i++) if (GUESS.has(group[i].type)) moving.add(i);
  if (moving.size === 0) return [...group];

  const stay = group.filter((_, i) => !moving.has(i));
  const at = stay.indexOf(group[firstResolver]);
  return [...stay.slice(0, at), ...group.filter((_, i) => moving.has(i)), ...stay.slice(at)];
}

/** Move every concept sitting in front of a same-idea concrete card to just after the last of them. */
function sink(group: readonly Card[]): Card[] {
  let lastConcrete = -1;
  for (let i = 0; i < group.length; i++) if (CONCRETE.has(group[i].type)) lastConcrete = i;
  if (lastConcrete <= 0) return [...group];

  const moving = new Set<number>();
  for (let i = 0; i < lastConcrete; i++) if (group[i].type === "concept") moving.add(i);
  if (moving.size === 0) return [...group];

  const stay = group.filter((_, i) => !moving.has(i));
  const at = stay.indexOf(group[lastConcrete]) + 1;
  return [...stay.slice(0, at), ...group.filter((_, i) => moving.has(i)), ...stay.slice(at)];
}

/**
 * `recentTypes` is the same window the variety governor reads (the shapes already on screen), and
 * it is only used to check that this reorder didn't cost the batch a card.
 */
export function orderForLearning(cards: readonly Card[], recentTypes: readonly CardType[] = []): Card[] {
  if (cards.length < 2) return [...cards];

  const slots = new Map<string, number[]>();
  cards.forEach((card, i) => {
    const k = groupKey(card);
    const at = slots.get(k);
    if (at) at.push(i);
    else slots.set(k, [i]);
  });

  const out = [...cards];
  let moved = false;
  for (const positions of slots.values()) {
    if (positions.length < 2) continue;
    const group = positions.map((i) => cards[i]);
    const sunk = sink(hoistGuess(group));
    positions.forEach((p, k) => {
      if (out[p] !== sunk[k]) moved = true;
      out[p] = sunk[k];
    });
  }
  if (!moved) return [...cards];

  // the governor gets the last word: concrete-first is worth a swap, never worth a dropped card
  const before = enforceVariety(recentTypes, cards).dropped.length;
  const after = enforceVariety(recentTypes, out).dropped.length;
  return after > before ? [...cards] : out;
}
