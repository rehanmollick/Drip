"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * Inline answer: a floating chat bubble over the current card, just above
 * the ask bar. Dismissed on any scroll or tap.
 */
export function InlineBubble({ text, onDismiss }: { text: string | null; onDismiss: () => void }) {
  const { spring, reduced } = useTheme();
  return (
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-5" style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 76px)" }}>
      <AnimatePresence>
        {text && (
          <motion.button
            type="button"
            key={text}
            onClick={onDismiss}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={reduced ? { duration: 0.15 } : spring}
            className="pointer-events-auto max-w-sm rounded-2xl rounded-br-md px-4 py-3 text-left font-body text-[15px] leading-snug text-ink"
            style={{
              background: "var(--accent-soft)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)",
              overflow: "hidden",
            }}
            aria-label="answer, tap to dismiss"
          >
            {/* 12 lines × 15px/1.375 ≈ 248px holds a schema-max (400-char) inline answer whole; the clamp is the only ceiling */}
            <span className="block text-pretty" style={{ display: "-webkit-box", WebkitLineClamp: 12, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {text}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
