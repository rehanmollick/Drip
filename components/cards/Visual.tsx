"use client";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { VisualSpec } from "@/lib/schemas/visual";
import { useTheme } from "@/components/theme/ThemeRoot";
import { Icon } from "@/components/ui/Icon";
import { pointsToString, sparkPoints } from "./helpers";

/**
 * Renders a VisualSpec — the ONLY visual treatments the AI may request:
 * icon (inline SVG, accent stroke), stat (huge display number + label),
 * ascii (mono block), spark (accent polyline with a soft area fill), none.
 * Inner motion elements use {hidden, show} variants so they ride the card's
 * entry stagger.
 */
export function Visual({
  spec,
  size = "md",
  align = "start",
  className = "",
  style,
}: {
  spec?: VisualSpec | null;
  size?: "sm" | "md" | "lg";
  align?: "start" | "center";
  className?: string;
  style?: CSSProperties;
}) {
  const { reduced, spring } = useTheme();
  if (!spec || spec.kind === "none") return null;
  const wrap: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: align === "center" ? "center" : "flex-start",
    textAlign: align === "center" ? "center" : "left",
    ...style,
  };

  if (spec.kind === "icon") {
    const px = size === "lg" ? 72 : size === "sm" ? 48 : 60;
    return (
      <div className={className} style={wrap} aria-hidden>
        <motion.span
          variants={{ hidden: { scale: reduced ? 1 : 0.7, opacity: 0, rotate: reduced ? 0 : -6 }, show: { scale: 1, opacity: 1, rotate: 0, transition: reduced ? { duration: 0.15 } : spring } }}
          style={{
            display: "inline-flex",
            padding: Math.round(px * 0.22),
            borderRadius: 24,
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in oklab, var(--accent) 22%, transparent)",
          }}
        >
          <Icon name={spec.icon} size={px} />
        </motion.span>
      </div>
    );
  }

  if (spec.kind === "stat") {
    // a 12-char value at a fixed 64px runs off a 393px phone — size it to the width it has
    const cap = size === "lg" ? 64 : size === "sm" ? 40 : 54;
    const fs = Math.min(cap, Math.max(24, Math.floor(280 / Math.max(1, spec.value.length * 0.58))));
    return (
      <div className={className} style={wrap}>
        <span
          className="font-display"
          style={{ fontSize: fs, lineHeight: 0.95, letterSpacing: "-0.03em", fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", maxWidth: "100%" }}
        >
          {spec.value}
        </span>
        <span className="font-body" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.3, color: "var(--ink-2)", maxWidth: 260 }}>
          {spec.label}
        </span>
      </div>
    );
  }

  if (spec.kind === "ascii") {
    const fs = size === "sm" ? 12 : 13.5;
    return (
      <pre
        className={`font-mono ${className}`}
        aria-hidden
        style={{
          margin: 0,
          fontSize: fs,
          lineHeight: 1.45,
          color: "var(--ink)",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "10px 14px",
          whiteSpace: "pre",
          overflow: "hidden",
          maxWidth: "100%",
          alignSelf: align === "center" ? "center" : "flex-start",
          ...style,
        }}
      >
        {spec.lines.join("\n")}
      </pre>
    );
  }

  if (spec.kind === "spark") {
    const w = 100;
    const h = 32;
    const pts = sparkPoints(spec.values, w, h);
    const line = pointsToString(pts);
    const area = pts.length ? `${pts[0].x.toFixed(2)},${h} ${line} ${pts[pts.length - 1].x.toFixed(2)},${h}` : "";
    const last = pts[pts.length - 1];
    const height = size === "lg" ? 96 : size === "sm" ? 56 : 76;
    return (
      <div className={className} style={{ ...wrap, width: "100%", alignItems: "stretch" }} aria-hidden>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", overflow: "visible" }}>
          <motion.polygon
            points={area}
            fill="var(--accent)"
            variants={{ hidden: { opacity: 0 }, show: { opacity: 0.14, transition: { duration: reduced ? 0.15 : 0.6, delay: reduced ? 0 : 0.25 } } }}
          />
          <motion.polyline
            points={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            variants={{ hidden: { pathLength: 0, opacity: 0 }, show: { pathLength: 1, opacity: 1, transition: reduced ? { duration: 0.15 } : { duration: 0.8, ease: "easeOut" } } }}
          />
          {last && (
            <motion.circle
              cx={last.x}
              cy={last.y}
              r={2.2}
              fill="var(--accent)"
              vectorEffect="non-scaling-stroke"
              variants={{ hidden: { opacity: 0, scale: 0 }, show: { opacity: 1, scale: 1, transition: reduced ? { duration: 0.15 } : { delay: 0.7, type: "spring", stiffness: 500, damping: 20 } } }}
              style={{ transformOrigin: `${last.x}px ${last.y}px`, transformBox: "fill-box" }}
            />
          )}
        </svg>
        {spec.label && (
          <span className="font-mono uppercase" style={{ marginTop: 6, fontSize: 10.5, letterSpacing: "0.16em", color: "var(--ink-2)", textAlign: align === "center" ? "center" : "left" }}>
            {spec.label}
          </span>
        )}
      </div>
    );
  }
  return null;
}
