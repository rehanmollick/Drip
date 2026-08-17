"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "@/components/theme/ThemeRoot";

/** One-line toast in the persona's voice, bottom of the feed, ~2.2s. */
export function Toast({ text }: { text: string | null }) {
  const { spring } = useTheme();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-6"
      style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 84px)" }}
      aria-live="polite"
    >
      <AnimatePresence>
        {text && (
          <motion.div
            key={text}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={spring}
            className="max-w-full rounded-full px-4 py-2 font-body text-sm text-ink shadow-lg"
            style={{ background: "var(--surface-2)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--line)" }}
          >
            <span className="block truncate">{text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
