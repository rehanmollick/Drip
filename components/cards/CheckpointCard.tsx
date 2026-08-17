"use client";
import { motion } from "framer-motion";
import type { CheckpointCard as CheckpointCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { Visual } from "./Visual";
import { useTheme } from "@/components/theme/ThemeRoot";
import { fitFontSize } from "./helpers";

/** checkpoint — the flex. Big headline, optional stat, streak pill (only here), signature device. */
export function CheckpointView({ card, entered, streak, onAskAbout }: CardViewProps<CheckpointCardT>) {
  const { reduced, spring } = useTheme();
  const headFs = fitFontSize(card.headline, [[40, 40], [64, 34], [Infinity, 30]]);
  const showStreak = typeof streak === "number" && streak >= 2;
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={20}>
      <Rise>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <SignatureEyebrow text={card.eyebrow ?? "checkpoint"} seed={card.id} />
          {showStreak && (
            <motion.span
              data-streak
              variants={{ hidden: { opacity: 0, scale: reduced ? 1 : 0.7 }, show: { opacity: 1, scale: 1, transition: reduced ? { duration: 0.15 } : { ...spring, delay: 0.3 } } }}
              className="font-mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                letterSpacing: "0.12em",
                padding: "5px 10px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontWeight: 600,
              }}
            >
              <span aria-hidden>🔥</span> {streak} in a row
            </motion.span>
          )}
        </div>
      </Rise>
      <Rise>
        <SignatureHeadline as="h1" seed={card.id} style={headlineStyle(headFs, 1.02)}>
          {card.headline}
        </SignatureHeadline>
      </Rise>
      {card.sub && (
        <Rise>
          <p className="font-body" style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: "var(--ink-2)", textWrap: "pretty" }}>{card.sub}</p>
        </Rise>
      )}
      {(card.stat || (card.visual && card.visual.kind !== "none")) && (
        <Rise>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
            {card.stat && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span className="font-display" style={{ fontSize: 56, lineHeight: 0.95, letterSpacing: "-0.03em", fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>
                  {card.stat.value}
                </span>
                <span className="font-body" style={{ marginTop: 6, fontSize: 14, color: "var(--ink-2)" }}>{card.stat.label}</span>
              </div>
            )}
            {card.visual && card.visual.kind !== "none" && (
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <Visual spec={card.visual} size={card.stat ? "sm" : "md"} />
              </div>
            )}
          </div>
        </Rise>
      )}
    </CardFrame>
  );
}
