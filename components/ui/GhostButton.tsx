"use client";
import { motion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { usePressable } from "@/lib/motion";

/**
 * Low-emphasis pill button (dials, "lock it in", retry). --ink-2 text on a
 * hairline border; `tone="accent"` fills with the accent for the one primary
 * action a card may have.
 */
export function GhostButton({
  children,
  onClick,
  tone = "ghost",
  size = "sm",
  disabled,
  className = "",
  style,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "ghost" | "accent" | "solid";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const pressable = usePressable();
  const pad = size === "lg" ? "14px 26px" : size === "md" ? "11px 20px" : "8px 14px";
  const fs = size === "lg" ? 17 : size === "md" ? 15 : 13;
  const base: CSSProperties = {
    padding: pad,
    fontSize: fs,
    borderRadius: 999,
    minHeight: size === "sm" ? 36 : 48,
    lineHeight: 1,
    fontFamily: "var(--font-body)",
    fontWeight: 500,
    border: "1px solid var(--line)",
    color: "var(--ink-2)",
    background: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    WebkitTapHighlightColor: "transparent",
    userSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "manipulation",
  };
  const tones: Record<string, CSSProperties> = {
    ghost: {},
    solid: { background: "var(--surface-2)", color: "var(--ink)", borderColor: "transparent" },
    accent: { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "transparent", fontWeight: 600 },
  };
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : pressable.whileTap}
      transition={pressable.transition}
      className={className}
      style={{ ...base, ...tones[tone], ...style }}
    >
      {children}
    </motion.button>
  );
}
