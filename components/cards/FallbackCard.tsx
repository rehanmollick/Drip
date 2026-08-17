"use client";
import { motion } from "framer-motion";
import type { Card, FallbackCard as FallbackCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GhostButton } from "@/components/ui/GhostButton";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * fallback — "hit a pothole, pull to retry" + a big retry affordance. Never
 * shows an error string. Also what CardView renders for any unknown card
 * (props.card may not be a real FallbackCard then; treat it loosely).
 */
export function FallbackView({ card, entered, onRetry, onAskAbout }: CardViewProps<FallbackCardT> | (Omit<CardViewProps, "card"> & { card: Card })) {
  const { reduced, spring } = useTheme();
  const retryable = card.type === "fallback" ? card.retryable !== false : true;
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <Rise>
        <Eyebrow tone="muted">{card.eyebrow ?? "bump in the road"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(34, 1.02)}>hit a pothole,<br />pull to retry.</h2>
      </Rise>
      <Rise>
        <p className="font-body" style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: "var(--ink-2)", maxWidth: 320 }}>
          this stretch didn&apos;t load right. one tap and we take another run at it.
        </p>
      </Rise>
      {retryable && (
        <Rise>
          <motion.div
            animate={reduced ? undefined : { y: [0, -3, 0] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
            style={{ display: "inline-flex" }}
          >
            <GhostButton tone="accent" size="lg" onClick={onRetry} ariaLabel="retry" style={{ minWidth: 180, minHeight: 56, fontSize: 18 }}>
              <span aria-hidden>↻</span> retry
            </GhostButton>
          </motion.div>
        </Rise>
      )}
      <Rise>
        <motion.span
          className="font-mono"
          variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: reduced ? { duration: 0.15 } : { ...spring, delay: 0.5 } } }}
          style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-2)" }}
        >
          or keep scrolling — the feed goes on.
        </motion.span>
      </Rise>
    </CardFrame>
  );
}
