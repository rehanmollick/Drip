import type { Slide } from "@/components/cards/types";
import { pseudoSlide, type PseudoKind } from "./notices";
import { isRowSlide } from "./slides";

/**
 * Placeholder stability (bug: "my slide gets regenerated into something else").
 *
 * The card under the reader's thumb must NEVER change identity. Real cards are
 * never regenerated — what used to change was the client-side pseudo slide the
 * reader was standing on: `pseudo:planning` flipped to `pseudo:catching_up` the
 * instant the session went active, and then real cards were swapped into its
 * slot. Both of those are list surgery under a stationary thumb.
 *
 * The fix is a PIN. Whenever the active slide is a pseudo, we remember it AND
 * the exact set of rows that sit above it; from then on it keeps its key and
 * its slot, and every row that lands afterwards goes AFTER it. The pin is
 * released only once the reader has demonstrably scrolled onto another slide
 * AND the scroll has settled — the slide list never mutates under a moving
 * thumb either.
 *
 * The slot is a SET OF ROW KEYS, not an `idx` watermark. `idx` is a fractional
 * key handed out by the server, and a batch can perfectly legitimately land
 * with keys that sort *before* the reader's position (a detour splice, a
 * backfill of a stale frontier, a generate that raced a re-sync). Anchoring the
 * pin to "the last idx above me" meant those rows sorted themselves ABOVE the
 * placeholder, which pushed it down the deck — key intact, slot stolen, which
 * is exactly the bug from the reader's point of view. Membership of the slot is
 * decided once, when the pin is taken, so nothing that arrives later can move
 * the reader.
 */

export const PSEUDO_PREFIX = "pseudo:";

const KINDS: readonly PseudoKind[] = ["planning", "replanning", "catching_up", "offline", "error"];
/** Pseudo kinds that live at the head of the deck (before every row). */
const HEAD_KINDS: readonly PseudoKind[] = ["planning", "error"];

export function isPseudoKey(key: string | null | undefined): key is string {
  return typeof key === "string" && key.startsWith(PSEUDO_PREFIX);
}

export function pseudoKindOf(key: string): PseudoKind | null {
  const k = key.slice(PSEUDO_PREFIX.length) as PseudoKind;
  return KINDS.includes(k) ? k : null;
}

/**
 * A pinned pseudo slide: which one, and the slot it holds — the keys of the row slides that were
 * above it when the reader landed on it (empty = it sits at the head of the deck). Everything not
 * in `above` renders after it, whatever its idx.
 */
export type Pin = { key: string; kind: PseudoKind; above: readonly string[] };

/** The row-slide keys above `key` in the list the reader is looking at; null when it isn't there. */
function slotAbove(slides: readonly Slide[], key: string): string[] | null {
  const i = slides.findIndex((s) => s.key === key);
  if (i < 0) return null;
  const above: string[] = [];
  for (let k = 0; k < i; k++) {
    const s = slides[k];
    if (isRowSlide(s)) above.push(s.key);
  }
  return above;
}

/**
 * Next pin state.
 *  - active slide is a pseudo → pin it (capturing the slot it holds) and keep that pin, unchanged,
 *    for as long as it stays active. Before the observer has reported anything, slide 0 counts as
 *    active: a session that opens on the planning notice is pinned from the first frame. A pin is
 *    never re-anchored — re-anchoring is how it used to drift to the tail.
 *  - active slide is something else → release, but only on a move we can actually confirm: the
 *    scroll must have come to rest (so the list never shifts mid-swipe) AND the slide the observer
 *    named must really be in the deck we are looking at. A report we cannot place (nothing reported
 *    yet, or a key from a list that has already been replaced) is ambiguous, not a move; dropping
 *    the pin on one lets the placeholder fall back to being the ordinary tail notice while the
 *    reader is still standing on it, and real cards take the slot under their thumb.
 */
export function nextPin(
  prev: Pin | null,
  { activeKey, slides, settled }: { activeKey: string | null; slides: readonly Slide[]; settled: boolean },
): Pin | null {
  const key = activeKey ?? slides[0]?.key ?? null;
  const present = key !== null && slides.some((s) => s.key === key);

  if (isPseudoKey(key)) {
    if (prev && prev.key === key) return prev;
    const kind = pseudoKindOf(key);
    if (!kind) return prev;
    const above = slotAbove(slides, key);
    if (above === null) return prev; // can't place a slide we can't see — wait for a list that has it
    return { key, kind, above };
  }

  if (!prev) return null;
  return settled && present ? null : prev;
}

/**
 * The rendered slide list: an optional head notice, the rows, an optional tail notice — and the
 * pinned pseudo held exactly where the reader left it. Keys are unique by construction (a pin whose
 * kind matches the head/tail absorbs it) so React never remounts a slide it is already showing.
 */
export function buildSlides({
  head,
  rowSlides,
  tail,
  pin,
}: {
  head: PseudoKind | null;
  rowSlides: readonly Slide[];
  tail: PseudoKind | null;
  pin: Pin | null;
}): Slide[] {
  const out: Slide[] = [];
  const seen = new Set<string>();
  const push = (s: Slide) => {
    if (seen.has(s.key)) return;
    seen.add(s.key);
    out.push(s);
  };

  const held = pin && pin.above.length > 0 ? new Set(pin.above) : null;

  if (pin && !held) push(pseudoSlide(pin.kind));
  if (head) push(pseudoSlide(head));

  if (pin && held) {
    for (const s of rowSlides) if (held.has(s.key)) push(s);
    push(pseudoSlide(pin.kind));
    for (const s of rowSlides) if (!held.has(s.key)) push(s);
  } else {
    for (const s of rowSlides) push(s);
  }

  if (tail) push(pseudoSlide(tail));
  return out;
}

/**
 * How many row slides are still ahead of the reader — the number the generation loop budgets
 * against. Counted from the pin when the reader is standing on a pinned pseudo (every row that
 * isn't part of its slot is below it, and therefore ahead of them). Returns null when the position
 * is unknown.
 */
export function runwayAhead({
  rowSlides,
  activeKey,
  pin,
}: {
  rowSlides: readonly Slide[];
  activeKey: string | null;
  pin: Pin | null;
}): number | null {
  if (!activeKey) return rowSlides.length;
  if (isPseudoKey(activeKey)) {
    if (pin && pin.key === activeKey) {
      const held = new Set(pin.above);
      return rowSlides.reduce((n, s) => (held.has(s.key) ? n : n + 1), 0);
    }
    const kind = pseudoKindOf(activeKey);
    return kind && HEAD_KINDS.includes(kind) ? rowSlides.length : 0;
  }
  const i = rowSlides.findIndex((s) => s.key === activeKey);
  return i >= 0 ? rowSlides.length - 1 - i : null;
}
