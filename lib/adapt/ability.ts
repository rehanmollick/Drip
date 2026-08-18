import { type Card } from "@/lib/schemas/cards";
import type { Interaction } from "@/lib/schemas/session";
import { evidenceWeight, guessRate } from "./anchors";

/**
 * How hard the next card should be, read off the answers instead of counted.
 *
 * This replaces a ±1-per-card ratchet that moved `level` whenever the hit rate over the last ten
 * answers crossed a line. Two lucky taps on a two-option bet saturated it to the ceiling, and it
 * never once looked at `difficulty` — the field the writer stamps on every scored card and nothing
 * read. So the reader who guessed twice got handed level-5 copy, and the reader who nailed a hard
 * question got the same credit as one who nailed a trivial one.
 *
 * What it is instead: a one-parameter logistic (Rasch, 1960) estimate with a guessing floor
 * (Birnbaum's 3PL, 1968), updated one answer at a time.
 *
 *   P(correct) = g + (1 − g)·σ(θ − b)
 *
 * θ is the reader on a logit scale, b is the card's `difficulty` on the same scale, g is
 * `guessRate`. Each answer moves θ along the exact 3PL score function, so:
 *   - a right answer on a coin-flip bet barely moves anything (most of P was the coin, not them),
 *   - a WRONG answer on one moves a lot (you can't accidentally miss a card you knew),
 *   - a right answer on something hard and unguessable moves the most.
 *
 * Three brakes, all load-bearing:
 *   - K-decay: the first answers move θ hard and the fortieth barely at all (Elo's K-factor,
 *     1978 — the same idea, and the same reason: early evidence is nearly all the evidence).
 *   - MAX_STEP: no single card may relocate the reader. One answer is one answer.
 *   - a DEADBAND on the level the writer is actually handed. θ is continuous; `level` is one of
 *     five notches, and it only moves when θ has left its notch by more than DEADBAND_LOGITS.
 *     That is what stops the deck's register flickering card to card — the failure the old ratchet
 *     produced constantly and the reader felt as "why did it suddenly start talking down to me".
 *
 * Honest about the evidence: Rasch estimation assumes items measure one trait and that difficulty
 * labels are calibrated. Ours are neither — `difficulty` is a model's guess at a number, on cards
 * spanning a whole subject. So this is a well-behaved smoother with the right SHAPE (discount the
 * guessable, weight the hard, slow down as evidence accumulates), not a measurement. Desirable
 * difficulties (Bjork 1994) says the target is a reader who is working, not one who is coasting;
 * this keeps them near it without pretending to a precision it does not have.
 */

/** One `level` notch is one logit. Difficulty 1..5 and ability 1..5 live on the same ruler. */
export const LOGITS_PER_LEVEL = 1;
/** The middle of the 1..5 scale — a reader we know nothing about, and a card of ordinary difficulty. */
export const SCALE_CENTRE = 3;
/** How far θ must leave a notch before the writer is handed a different one. */
export const DEADBAND_LOGITS = 0.55;
/** First-answer step size, and the floor it decays to. */
export const K_START = 1.4;
export const K_FLOOR = 0.2;
/** Answers it takes for K to fall halfway to the floor. */
export const K_HALF_LIFE = 6;
/** Ceiling on a single answer's move, in logits. No one card gets to relocate the reader. */
export const MAX_STEP = 0.6;
/** Answers before `level` may move at all: one lucky tap is not a reading. */
export const MIN_ABILITY_ITEMS = 4;
/** An `open` answer graded "close" — they had the move, one piece off. Half a hit, not a whole one. */
export const PARTIAL_CREDIT = 0.5;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 1..5 → logits, centred on 3. Used for both the reader and the card. */
export const toLogits = (level: number): number => (level - SCALE_CENTRE) * LOGITS_PER_LEVEL;
/** logits → the 1..5 scale the state stores, clamped to the scale's ends. */
export const toScale = (theta: number): number => clamp(SCALE_CENTRE + theta / LOGITS_PER_LEVEL, 1, 5);

/** How far the next answer is allowed to move θ. Decays with evidence, never to zero. */
export function kFor(items: number): number {
  return K_FLOOR + (K_START - K_FLOOR) / (1 + Math.max(0, items) / K_HALF_LIFE);
}

/** The card's own difficulty when it carries one, else "about where they are" — never a guess of 3. */
export function difficultyOf(card: Card, fallback: number): number {
  const d = (card as { difficulty?: unknown }).difficulty;
  return typeof d === "number" ? clamp(d, 1, 5) : clamp(fallback, 1, 5);
}

/** P(correct) under the 3PL with a fixed slope: the guessing floor plus what they actually know. */
export function expected(theta: number, difficulty: number, guess: number): number {
  const p = 1 / (1 + Math.exp(-(theta - toLogits(difficulty))));
  return clamp(guess + (1 - guess) * p, 1e-3, 1 - 1e-3);
}

/**
 * What the reader earned from this card. A miss is 0, a hit is 1, and an `open` graded "close" is
 * half — it was scored as a full hit until now, which flattered the estimate and was simply a lie
 * about what happened.
 */
export function creditFor(interaction: Interaction): number {
  if (interaction.correct !== true) return 0;
  return interaction.feedback?.verdict === "close" ? PARTIAL_CREDIT : 1;
}

/**
 * One answer's move on θ, in logits. The bracket is the 3PL score function with a=1:
 * (x − P)(P − g) / (P(1 − g)). The (P − g) factor is the whole point — it collapses toward zero
 * exactly when the answer could have been luck.
 */
export function abilityStep(input: {
  theta: number;
  difficulty: number;
  guess: number;
  weight: number;
  credit: number;
  items: number;
}): number {
  const { theta, difficulty, guess, weight, credit, items } = input;
  const g = clamp(guess, 0, 0.9);
  const p = expected(theta, difficulty, g);
  const grad = ((credit - p) * (p - g)) / (p * (1 - g));
  return clamp(kFor(items) * weight * grad, -MAX_STEP, MAX_STEP);
}

/**
 * The notch the writer is handed. Moves ONE step, and only once θ has left the current notch by
 * more than the deadband — so crossing back costs a full deadband too, and the register can't
 * flicker. `items` gates the very first move: nothing before there is something to read.
 */
export function levelFor(ability: number, currentLevel: number, items = MIN_ABILITY_ITEMS): number {
  if (items < MIN_ABILITY_ITEMS) return currentLevel;
  const drift = toLogits(ability) - toLogits(currentLevel);
  if (Math.abs(drift) <= DEADBAND_LOGITS) return currentLevel;
  return clamp(currentLevel + Math.sign(drift), 1, 5);
}

export type AbilityRead = { ability: number; abilityItems: number; level: number };

/**
 * The whole read after one scored answer: where they are, how much we've seen, and which notch
 * that means. Pure — the caller decides whether the notch is allowed to land (the dial bounds it).
 */
export function abilityAfter(
  state: { ability: number; abilityItems: number; level: number },
  card: Card,
  credit: number,
): AbilityRead {
  const theta = toLogits(state.ability);
  const step = abilityStep({
    theta,
    difficulty: difficultyOf(card, state.level),
    guess: guessRate(card),
    weight: evidenceWeight(card),
    credit: clamp(credit, 0, 1),
    items: state.abilityItems,
  });
  const ability = Math.round(toScale(theta + step) * 1e4) / 1e4;
  const abilityItems = state.abilityItems + 1;
  return { ability, abilityItems, level: levelFor(ability, state.level, abilityItems) };
}
