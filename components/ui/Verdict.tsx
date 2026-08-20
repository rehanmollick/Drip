"use client";
import type { CSSProperties } from "react";

/**
 * The outcome of a scored tap, said three ways at once — colour, glyph, AND
 * words — so it never leans on colour alone (binary / sequence / spot payoffs).
 * Two words max: a nod, never a grade.
 */
export function Verdict({
  correct,
  label,
  style,
}: {
  correct: boolean;
  /** override the default nod ("called it" / "not quite") */
  label?: string;
  style?: CSSProperties;
}) {
  const tint = correct ? "var(--state-correct)" : "var(--state-wrong)";
  return (
    <span
      data-verdict={correct ? "correct" : "wrong"}
      className="font-mono uppercase"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        letterSpacing: "0.16em",
        lineHeight: 1.2,
        color: tint,
        ...style,
      }}
    >
      <span aria-hidden>{correct ? "✓" : "✕"}</span>
      {label ?? (correct ? "called it" : "not quite")}
    </span>
  );
}

/** Height the payoff's reserved slot must add when a Verdict rides above the copy. */
export const VERDICT_SLOT = 22;
