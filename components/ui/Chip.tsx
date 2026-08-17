"use client";
import { motion, type Transition } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

/**
 * Floating note chip (code annotations, diagram tap-notes). Mount it inside an
 * <AnimatePresence>; enter/exit is built in.
 */
export function Chip({
  children,
  spring,
  reduced,
  className = "",
  style,
  layoutId,
}: {
  children: ReactNode;
  spring?: Transition;
  reduced?: boolean;
  className?: string;
  style?: CSSProperties;
  layoutId?: string;
}) {
  const t: Transition = reduced ? { duration: 0.15 } : (spring ?? { type: "spring", stiffness: 420, damping: 32 });
  return (
    <motion.div
      layoutId={layoutId}
      initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98, transition: { duration: 0.12 } }}
      transition={t}
      className={`font-body ${className}`}
      style={{
        position: "relative",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "9px 12px 9px 22px",
        fontSize: 13.5,
        lineHeight: 1.35,
        color: "var(--ink)",
        maxWidth: "100%",
        boxShadow: "0 8px 24px -12px rgba(0,0,0,0.35)",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 10,
          top: 14,
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--accent)",
        }}
      />
      {children}
    </motion.div>
  );
}
