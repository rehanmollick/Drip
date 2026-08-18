import { type Card } from "@/lib/schemas/cards";

/**
 * What a card is ABOUT, as a joinable key — and how much one answer about it is worth.
 *
 * The writer already stamps `anchor` on most cards (a slug like "cache-stampede"). It is never
 * rendered; it exists so the card that teaches an idea and the card 26 slides later that bets on
 * it can be recognised as the same idea. Everything downstream of this file — the ability estimate
 * (ability.ts), spaced retrieval (schedule.ts), concrete-before-abstract ordering
 * (lib/generation/pedagogy.ts) — joins on the value `anchorOf` returns, so it has to return
 * SOMETHING for every card, including the ones where the model forgot the field.
 *
 * Research this serves:
 *  - Retrieval practice / the testing effect (Roediger & Karpicke 2006): being asked about an idea
 *    later beats re-reading it. That only works if "the same idea" is a thing the code can name.
 *  - Interleaving (Rohrer & Taylor 2007; Taylor & Rohrer 2010): mixing ideas beats blocking them.
 *    Interleaving needs ideas to stay DISTINCT, which is why `mergeAnchor` never merges across
 *    topic nodes — collapsing two nodes' anchors would erase exactly the pairs worth interleaving.
 *  - Guessing correction (Birnbaum's 3PL, 1968): a two-option tap is half noise. `guessRate` is
 *    what stops the estimate treating a coin flip as knowledge.
 * Honest caveat: `evidenceWeight` is a judgement call, not a measured discrimination parameter.
 * Its ordering (typing an answer > ordering steps > tapping one of two) follows the generation
 * effect (Slamecka & Graf 1978), but the exact numbers are tuning, not findings.
 */

/** The shape the writer's `anchor` field is validated against (lib/schemas/cards.ts). */
const ANCHOR_RE = /^[a-z0-9]+(-[a-z0-9]+){0,3}$/;
const MAX_ANCHOR = 40;
/** Slug segments the stem keeps — the field allows four, and four is already a sentence. */
const STEM_TOKENS = 3;

/** Two anchors in one node that share this many words are the same idea wearing two slugs. */
export const MERGE_MIN_SHARED = 2;

/** An anchor is only ever an anchor WITHIN a node — see mergeAnchor. */
export type AnchorRef = { anchor: string; nodeId: string };

/**
 * Words that carry no idea. Dropped from a stem so "why-a-cache-is-a-bet" and "the-cache-bet"
 * land on the same slug instead of on two.
 */
const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was",
  "were", "it", "its", "that", "this", "you", "your", "why", "how", "what", "when", "which", "who",
  "does", "do", "did", "not", "no", "if", "at", "by", "from", "as", "be", "been", "can", "will",
  "just", "one", "all", "so", "than", "then", "most", "more", "into", "out", "up", "down", "we",
]);

/**
 * Short label for the concept a card is about: the card's substantive text
 * (bet prompt, headline, title, setup) — never the eyebrow first, which the
 * writer fills with stylistic labels ("hot take", "the footgun") that would
 * collapse every miss into one meaningless "concept".
 */
export function conceptOf(card: Card): string {
  const c = card as Record<string, unknown>;
  const raw =
    (typeof c.headline === "string" && c.headline.trim()) ||
    (typeof c.prompt === "string" && c.prompt.trim()) ||
    (typeof c.title === "string" && c.title.trim()) ||
    (typeof c.setup === "string" && c.setup.trim()) ||
    (typeof c.label === "string" && c.label.trim()) ||
    (typeof c.eyebrow === "string" && c.eyebrow.trim()) ||
    card.type;
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s;
}

/** A sentence squeezed down to an anchor-shaped slug: the first few words that mean anything. */
export function stemAnchor(label: string): string {
  const words = label.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/[\s-]+/).filter(Boolean);
  const kept = words.filter((w) => w.length > 1 && !STOP.has(w));
  const picked = (kept.length ? kept : words).slice(0, STEM_TOKENS);
  const slug = picked.join("-").slice(0, MAX_ANCHOR).replace(/-+$/, "");
  return ANCHOR_RE.test(slug) ? slug : "idea";
}

/**
 * The idea this card joins on. The writer's own slug when it left one, otherwise a stem of the
 * card's copy — a card without an anchor still has to be schedulable, or the one type the model
 * keeps forgetting to stamp becomes the one type that never gets called back.
 */
export function anchorOf(card: Card): string {
  const given = (card as { anchor?: unknown }).anchor;
  if (typeof given === "string" && ANCHOR_RE.test(given)) return given;
  return stemAnchor(conceptOf(card));
}

/**
 * Fold a new anchor into one already seen, WITHIN THE SAME NODE ONLY. "cache-stampede" and
 * "stampede-cache-cold" are one idea; "cache-key" in the eviction node and "cache-key" in the
 * invalidation node are two, and merging them would collapse exactly the pair that interleaving
 * exists to keep apart. First match wins, so the oldest slug stays canonical and a callback
 * written 30 slides ago still resolves.
 */
export function mergeAnchor(known: readonly AnchorRef[], next: AnchorRef): string {
  const tokens = new Set(next.anchor.split("-"));
  for (const k of known) {
    if (k.nodeId !== next.nodeId) continue;
    if (k.anchor === next.anchor) return k.anchor;
    let shared = 0;
    for (const t of new Set(k.anchor.split("-"))) if (tokens.has(t)) shared++;
    if (shared >= MERGE_MIN_SHARED) return k.anchor;
  }
  return next.anchor;
}

/** n! — only ever called on 3..6 items, so the naive loop is the whole story. */
function factorial(n: number): number {
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

/**
 * The chance of getting this card right while knowing nothing. A right tap on a two-option bet is
 * half a coin flip and the ability estimate has to discount it; typing an answer in your own words
 * cannot be guessed at all, which is most of why it is worth asking.
 */
export function guessRate(card: Card): number {
  switch (card.type) {
    case "binary": return 0.5;
    case "predict": return 1 / Math.max(2, card.options.length);
    case "spot": return Math.min(0.5, card.pieces.filter((p) => p.hit).length / card.pieces.length);
    case "sequence": return 1 / factorial(card.items.length);
    case "open": return 0;
    default: return 0;
  }
}

/**
 * How much one answer counts as evidence. Saying an idea back in your own words is a production
 * task (generation effect, Slamecka & Graf 1978) and tells us far more than picking one of two.
 * Cards with no right answer teach without measuring, and weigh nothing.
 */
export function evidenceWeight(card: Card): number {
  switch (card.type) {
    case "open": return 1.4;
    case "sequence": return 1.2;
    case "predict": return 1;
    case "spot": return 1;
    case "binary": return 0.8;
    default: return 0;
  }
}
