"use client";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/**
 * Shared motion helpers (spec §5). Card content staggers in ONCE when the card
 * first crosses 60% visibility; scrolling back never replays. Under
 * prefers-reduced-motion every spring becomes a 150ms fade (still staggered,
 * as fades).
 */

/** Latches `entered`: once true, stays true for the life of the component. */
export function useEnterOnce(entered: boolean): boolean {
  const [shown, setShown] = useState(entered);
  useEffect(() => {
    if (entered) setShown(true);
  }, [entered]);
  return shown;
}

/** Parent variants: children stagger by `staggerMs` (60ms per spec). */
export function staggerContainer(staggerMs = 60, delayMs = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: staggerMs / 1000, delayChildren: delayMs / 1000 } },
  };
}

/** Child variants: rise 14px + fade with the theme spring; reduced → 150ms fade only. */
export function riseIn(spring: Transition, reduced = false): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: reduced ? REDUCED_FADE : spring },
  };
}

/** Plain fade child variants (for things that shouldn't move, e.g. backgrounds). */
export function fadeIn(spring: Transition, reduced = false): Variants {
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: reduced ? REDUCED_FADE : spring },
  };
}

export const REDUCED_FADE: Transition = { duration: 0.15, ease: "easeOut" };

/** Tap tactility: scale to 0.97 with a spring on press (never navigator.vibrate). */
export const pressable = {
  whileTap: { scale: 0.97 },
  transition: { type: "spring", stiffness: 500, damping: 30 } as Transition,
} as const;

/** Reduced motion: no press scale at all — the state change (border/tint) is the feedback. */
export const pressableReduced = {
  whileTap: undefined,
  transition: REDUCED_FADE,
} as const;

export type Pressable = { whileTap: { scale: number } | undefined; transition: Transition };

/** `pressable` that respects prefers-reduced-motion (spec §5: every spring becomes a 150ms fade). */
export function usePressable(): Pressable {
  const reduced = !!useReducedMotion();
  return useMemo(() => (reduced ? pressableReduced : pressable), [reduced]);
}

/** Wrong-answer shake: x ±6px, 3 cycles (spec §5). */
export const shakeKeyframes = { x: [0, -6, 6, -6, 6, -6, 6, 0] };
export const shakeTransition: Transition = { duration: 0.42, ease: "easeInOut" };

/**
 * ── the inline rule ────────────────────────────────────────────────────────
 * Text pieces INSIDE a paragraph animate OPACITY ONLY. A transform on an inline
 * span can push a line past the edge of a 393px screen mid-flight, and a card
 * that overflows for 200ms is still a card that overflowed. Only block-level
 * children are allowed to move in y (that's `riseIn`). `cascade().item` is the
 * only variant here that may ride an inline <span>.
 */

/** However many pieces a cascade has, the last one has landed by now (ms). */
export const CASCADE_MAX_MS = 400;

/** How long a single piece takes to fade up (ms). Part of the 400ms budget. */
export const CASCADE_FADE_MS = 180;

/**
 * The real gap between pieces: `stepMs` when there's room, squeezed when there
 * isn't, so a nine-sentence card still finishes inside CASCADE_MAX_MS. A reader
 * who flicks fast must never catch a card mid-assembly.
 */
export function cascadeStep(stepMs: number, count: number): number {
  const gaps = Math.max(0, Math.floor(count) - 1);
  if (gaps === 0) return 0;
  const budget = Math.max(0, CASCADE_MAX_MS - CASCADE_FADE_MS);
  return Math.max(0, Math.min(stepMs, budget / gaps));
}

/**
 * Sentence-by-sentence arrival: prose lands a piece at a time instead of as one
 * slab. Spread `container` on the paragraph and `item` on each piece; pass the
 * piece count so the gap can shrink to fit the budget.
 *
 * `item` is opacity-only — see the inline rule above. Reduced motion drops the
 * stagger entirely: every piece fades together, nothing waits its turn.
 */
export function cascade(reduced = false, stepMs = 60, count = 1): { container: Variants; item: Variants } {
  const step = reduced ? 0 : cascadeStep(stepMs, count);
  return {
    container: { hidden: {}, show: { transition: { staggerChildren: step / 1000 } } },
    item: {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: reduced ? REDUCED_FADE : { duration: CASCADE_FADE_MS / 1000, ease: "easeOut" },
      },
    },
  };
}

/**
 * A bar / rule / connector growing from nothing to `to` (a scale factor, so a
 * 62%-full bar is growIn(0.62)). The origin is baked in so the thing can't grow
 * the wrong way: x grows from the left, y from the bottom.
 *
 * Reduced motion: full size from the first frame, opacity does the arriving.
 */
export function growIn(
  to: number,
  spring: Transition,
  reduced = false,
  opts: { delay?: number; axis?: "x" | "y"; origin?: string } = {},
): Variants {
  const vertical = opts.axis === "y";
  const transformOrigin = opts.origin ?? (vertical ? "center bottom" : "left center");
  const delay = (opts.delay ?? 0) / 1000;
  const from = reduced ? to : 0;
  return {
    hidden: {
      ...(vertical ? { scaleY: from } : { scaleX: from }),
      opacity: reduced ? 0 : 1,
      transformOrigin,
    },
    show: {
      ...(vertical ? { scaleY: to } : { scaleX: to }),
      opacity: 1,
      transformOrigin,
      transition: reduced ? REDUCED_FADE : { ...spring, delay },
    },
  };
}

/**
 * An SVG stroke drawing itself in (framer turns `pathLength` into
 * stroke-dasharray/dashoffset). Give `duration` in ms for a steady draw — a
 * spring on a line makes the tip stutter at the end.
 *
 * Reduced motion: the stroke is already whole, opacity does the arriving.
 */
export function drawIn(
  spring: Transition,
  reduced = false,
  opts: { duration?: number; delay?: number } = {},
): Variants {
  const delay = (opts.delay ?? 0) / 1000;
  const drawn: Transition = opts.duration
    ? { duration: opts.duration / 1000, ease: "easeOut", delay }
    : { ...spring, delay };
  return {
    hidden: { pathLength: reduced ? 1 : 0, opacity: reduced ? 0 : 1 },
    show: { pathLength: 1, opacity: 1, transition: reduced ? REDUCED_FADE : drawn },
  };
}
