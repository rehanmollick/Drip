"use client";
import { motion } from "framer-motion";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * Shown on a placeholder the reader is standing on once real cards are waiting below it.
 *
 * The placeholder never swaps itself out for the first card — that is exactly the "my slide got
 * regenerated into something else" bug. So it says so instead, and the reader's thumb does the rest.
 */
export function SwipeNudge() {
  const { reduced } = useTheme();
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[2] flex flex-col items-center gap-1"
      style={{ bottom: "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 64px)" }}
      data-testid="swipe-nudge"
    >
      <motion.span
        aria-hidden
        style={{ color: "var(--accent)", lineHeight: 1 }}
        animate={reduced ? undefined : { y: [0, -5, 0] }}
        transition={reduced ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V6M6 12l6-6 6 6" />
        </svg>
      </motion.span>
      <span className="font-body text-[13px]" style={{ color: "var(--ink-2)" }}>
        they’re here — swipe up
      </span>
    </div>
  );
}
