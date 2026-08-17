"use client";
import type { CSSProperties, ReactNode } from "react";

/** Tiny mono uppercase label in the accent color ("the footgun", "0x02"). */
export function Eyebrow({
  children,
  className = "",
  style,
  tone = "accent",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tone?: "accent" | "muted";
}) {
  return (
    <span
      className={`font-mono uppercase ${className}`}
      style={{
        fontSize: 11,
        letterSpacing: "0.18em",
        lineHeight: 1.2,
        color: tone === "accent" ? "var(--accent)" : "var(--ink-2)",
        display: "inline-block",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
