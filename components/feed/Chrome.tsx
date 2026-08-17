"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * Persistent minimal chrome: back chevron (top-left) + ask pill (bottom).
 * Both fade to 0 while scrolling and reappear after 400ms of rest.
 */
export function BackChevron({ hidden }: { hidden: boolean }) {
  const { reduced } = useTheme();
  return (
    <motion.div
      className="fixed left-3 z-40"
      style={{ top: "calc(max(env(safe-area-inset-top), 16px) + 6px)" }}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: "easeOut" }}
    >
      <Link
        href="/"
        aria-label="back"
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: "var(--surface)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", pointerEvents: hidden ? "none" : "auto" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </Link>
    </motion.div>
  );
}

export function AskPill({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const { reduced, spring } = useTheme();
  return (
    <motion.div
      className="fixed inset-x-0 z-40 flex justify-center px-6"
      style={{ bottom: "max(env(safe-area-inset-bottom), 16px)" }}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: reduced ? 0.15 : 0.22, ease: "easeOut" }}
    >
      <motion.button
        type="button"
        onClick={onOpen}
        whileTap={reduced ? undefined : { scale: 0.97 }}
        transition={spring}
        className="flex h-12 w-full max-w-sm items-center gap-3 rounded-full px-5 text-left font-body text-[15px] text-ink-2"
        style={{
          background: "var(--surface)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "0 0 0 1px var(--accent), 0 0 0 5px var(--accent-soft)",
          pointerEvents: hidden ? "none" : "auto",
        }}
        aria-label="ask anything"
      >
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="flex-1 truncate">ask anything…</span>
      </motion.button>
    </motion.div>
  );
}
