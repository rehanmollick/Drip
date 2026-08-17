"use client";
import { useEffect, useState } from "react";
import type { Transition, Variants } from "framer-motion";

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

/** Wrong-answer shake: x ±6px, 3 cycles (spec §5). */
export const shakeKeyframes = { x: [0, -6, 6, -6, 6, -6, 6, 0] };
export const shakeTransition: Transition = { duration: 0.42, ease: "easeInOut" };
