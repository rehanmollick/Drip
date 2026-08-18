"use client";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * The framed surface. Concept visuals, code blocks and ascii boxes each grew
 * their own version of "tinted box with a hairline" and drifted to three
 * different radii, which on one 393px screen reads as three different design
 * systems. This is the one treatment: theme surface, hairline, 16px corner.
 *
 * It clips (`overflow: hidden`) because everything that goes in it — code,
 * ascii, a huge stat — is content that would otherwise push past the card edge.
 */

export const PANEL_RADIUS = 16;

const PAD = {
  none: 0,
  /** dense content that brings its own gutters (code, ascii) */
  sm: "10px 12px",
  /** the default: a visual with room to breathe */
  md: "14px 16px",
  /** a stat that has to feel like the point of the card */
  lg: "16px 18px",
} as const;

export type PanelPad = keyof typeof PAD;

export function Panel({
  children,
  as = "div",
  pad = "md",
  className = "",
  style,
  ...rest
}: {
  children?: ReactNode;
  /** "pre" for monospace blocks that keep their own whitespace */
  as?: "div" | "pre";
  /** a preset, or any CSS padding string when the content needs its own gutters */
  pad?: PanelPad | (string & {});
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">) {
  const Tag = as;
  const padding = pad in PAD ? PAD[pad as PanelPad] : pad;
  return (
    <Tag
      data-panel
      className={className}
      style={{
        margin: 0,
        padding,
        borderRadius: PANEL_RADIUS,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        boxSizing: "border-box",
        overflow: "hidden",
        maxWidth: "100%",
        ...(as === "pre" ? { whiteSpace: "pre" as const } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
