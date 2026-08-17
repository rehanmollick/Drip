"use client";
import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import { pressable } from "@/lib/motion";
import { Confetti } from "./Confetti";

export type OptionState = "idle" | "picked" | "correct" | "wrong" | "dim";

/**
 * Big tappable option (binary / predict / clarify). States:
 *  idle   – tappable
 *  picked – chosen, correctness not shown (predict, clarify)
 *  correct/wrong – answered, tinted with --state-correct / --state-wrong
 *  dim    – the road not taken
 * `burst` > 0 fires a local confetti burst from this button.
 */
export function OptionButton({
  label,
  state = "idle",
  onTap,
  disabled,
  burst = 0,
  size = "lg",
  marker,
  className = "",
  style,
}: {
  label: ReactNode;
  state?: OptionState;
  onTap?: () => void;
  disabled?: boolean;
  burst?: number;
  size?: "lg" | "md";
  /** optional leading mono marker ("a", "b", "✓") */
  marker?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const border =
    state === "correct" ? "var(--state-correct)"
    : state === "wrong" ? "var(--state-wrong)"
    : state === "picked" ? "var(--accent)"
    : "var(--line)";
  const bg =
    state === "correct" ? "color-mix(in oklab, var(--state-correct) 14%, transparent)"
    : state === "wrong" ? "color-mix(in oklab, var(--state-wrong) 12%, transparent)"
    : state === "picked" ? "var(--accent-soft)"
    : "var(--surface)";
  const inactive = disabled || state !== "idle";
  return (
    <motion.button
      type="button"
      onClick={onTap}
      disabled={disabled}
      whileTap={inactive ? undefined : pressable.whileTap}
      transition={pressable.transition}
      animate={{ opacity: state === "dim" ? 0.42 : 1 }}
      initial={false}
      className={`font-body ${className}`}
      style={{
        position: "relative",
        width: "100%",
        minHeight: size === "lg" ? 60 : 52,
        padding: size === "lg" ? "14px 18px" : "11px 16px",
        borderRadius: 18,
        border: `1.5px solid ${border}`,
        background: bg,
        transition: "border-color 200ms ease, background-color 200ms ease",
        color: "var(--ink)",
        fontSize: size === "lg" ? 18 : 16,
        fontWeight: 500,
        lineHeight: 1.25,
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: inactive ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "manipulation",
        overflow: "visible",
        ...style,
      }}
    >
      {marker !== undefined && (
        <span
          className="font-mono"
          aria-hidden
          style={{
            flex: "0 0 auto",
            width: 26,
            height: 26,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: state === "correct" ? "var(--state-correct)" : state === "wrong" ? "var(--state-wrong)" : state === "picked" ? "var(--accent)" : "var(--ink-2)",
            border: `1px solid ${state === "idle" || state === "dim" ? "var(--line)" : border}`,
          }}
        >
          {marker}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      {state === "correct" && (
        <motion.span
          aria-hidden
          initial={reduced ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className="font-mono"
          style={{ color: "var(--state-correct)", fontSize: 18, flex: "0 0 auto" }}
        >
          ✓
        </motion.span>
      )}
      {state === "wrong" && (
        <span aria-hidden className="font-mono" style={{ color: "var(--state-wrong)", fontSize: 18, flex: "0 0 auto" }}>
          ✕
        </span>
      )}
      <Confetti burst={burst} />
    </motion.button>
  );
}
