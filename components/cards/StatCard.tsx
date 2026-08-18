"use client";
import { motion } from "framer-motion";
import type { StatCard as StatCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { useTheme } from "@/components/theme/ThemeRoot";
import { fitFontSize, statBars, statFontSize } from "./helpers";

/**
 * stat — one number, as big as the phone allows. The antidote to headline +
 * paragraph: the number IS the card. `compare` becomes a second, quieter
 * number (with bars when the two are actually comparable) so the big one has
 * scale instead of floating in a vacuum. `context` is the line that makes it
 * mean something, and carries the inline glossary.
 */
export function StatView({ card, entered, onAskAbout }: CardViewProps<StatCardT>) {
  const { spring, reduced } = useTheme();
  const fs = statFontSize(card.value, card.unit);
  // the unit lives in its own field; fold it back in so "0.2" + "ms" compares against "20ms"
  const bars = card.compare ? statBars(`${card.value}${card.unit ?? ""}`, card.compare.value) : null;
  const contextFs = fitFontSize(card.context, [[90, 19], [130, 18], [Infinity, 17]]);
  const labelFs = fitFontSize(card.label, [[28, 16], [Infinity, 15]]);

  // reduced motion: the bar arrives at its width and only the opacity moves (spec §5)
  const grow = (w: number, delay: number) => ({
    hidden: { scaleX: reduced ? w : 0, opacity: 0 },
    show: {
      scaleX: w,
      opacity: 1,
      transition: reduced ? { duration: 0.15 } : { ...spring, delay },
    },
  });

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={14}>
      {card.eyebrow && (
        <Rise>
          <Eyebrow>{card.eyebrow}</Eyebrow>
        </Rise>
      )}

      <Rise>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            data-stat-value
            className="font-display"
            style={{
              fontSize: fs,
              lineHeight: 0.88,
              letterSpacing: "-0.045em",
              fontWeight: 700,
              color: "var(--accent)",
              fontVariantNumeric: "tabular-nums",
              overflowWrap: "anywhere",
            }}
          >
            {card.value}
          </span>
          {card.unit && (
            <span
              className="font-display"
              style={{
                fontSize: Math.max(15, Math.round(fs * 0.3)),
                lineHeight: 1,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "color-mix(in oklab, var(--accent) 70%, var(--ink))",
                overflowWrap: "anywhere",
              }}
            >
              {card.unit}
            </span>
          )}
        </div>
      </Rise>

      <Rise>
        <p className="font-body" style={{ margin: 0, fontSize: labelFs, lineHeight: 1.3, color: "var(--ink-2)", textWrap: "pretty" }}>
          {card.label}
        </p>
      </Rise>

      {card.compare && (
        <Rise>
          <div data-stat-compare style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
            {bars && (
              <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "block", height: 10, borderRadius: 5, background: "var(--surface)", overflow: "hidden" }}>
                  <motion.span
                    variants={grow(bars.value, 0.06)}
                    style={{ display: "block", height: "100%", width: "100%", borderRadius: 5, background: "var(--accent)", transformOrigin: "left center" }}
                  />
                </span>
                <span style={{ display: "block", height: 10, borderRadius: 5, background: "var(--surface)", overflow: "hidden" }}>
                  <motion.span
                    variants={grow(bars.compare, 0.18)}
                    style={{ display: "block", height: "100%", width: "100%", borderRadius: 5, background: "color-mix(in oklab, var(--ink) 34%, transparent)", transformOrigin: "left center" }}
                  />
                </span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span
                className="font-display"
                style={{
                  fontSize: Math.max(22, Math.round(fs * 0.34)),
                  lineHeight: 1,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: "var(--ink-2)",
                  fontVariantNumeric: "tabular-nums",
                  overflowWrap: "anywhere",
                }}
              >
                {card.compare.value}
              </span>
              <span className="font-body" style={{ fontSize: 14, lineHeight: 1.25, color: "var(--ink-2)", minWidth: 0, overflowWrap: "anywhere" }}>
                {card.compare.label}
              </span>
            </div>
          </div>
        </Rise>
      )}

      <Rise style={{ marginTop: 2 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: "var(--accent)", opacity: 0.85, flexShrink: 0 }} />
          <Glossed
            text={card.context}
            terms={card.terms}
            wrapStyle={{ flex: "1 1 auto" }}
            className="font-body"
            style={{ margin: 0, fontSize: contextFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
          />
        </div>
      </Rise>

      {hasTerms(card.context, card.terms) && (
        <Rise>
          <GlossHint text={card.context} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}
