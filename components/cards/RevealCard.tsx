"use client";
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { RevealCard as RevealCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Visual } from "./Visual";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { pressable } from "@/lib/motion";
import { fitFontSize } from "./helpers";

/**
 * reveal — tap the card body to flip setup → payoff (rotateX; crossfade under
 * reduced motion). onInteract({choice: "revealed"}) once.
 */
export function RevealView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<RevealCardT>) {
  const { spring, reduced } = useTheme();
  const [flipped, setFlipped] = useState(interaction?.choice === "revealed");
  const flip = useCallback(() => {
    if (flipped) return;
    setFlipped(true);
    ticks.reveal();
    onInteract?.({ choice: "revealed" });
  }, [flipped, onInteract]);

  const setupFs = fitFontSize(card.setup, [[60, 30], [100, 27], [Infinity, 24]]);
  const payoffFs = fitFontSize(card.payoff, [[150, 19], [Infinity, 17.5]]);
  const t = reduced ? { duration: 0.15 } : { ...spring, stiffness: 240, damping: 26 };

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      {card.visual?.kind === "icon" && (
        <Rise>
          <Visual spec={card.visual} size="sm" />
        </Rise>
      )}
      <Rise>
        <Eyebrow>{card.eyebrow ?? "tap it"}</Eyebrow>
      </Rise>
      <Rise>
        <motion.div
          role="button"
          tabIndex={0}
          aria-pressed={flipped}
          data-reveal-panel
          onClick={flip}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } }}
          whileTap={flipped ? undefined : pressable.whileTap}
          transition={pressable.transition}
          style={{ perspective: 1000, cursor: flipped ? "default" : "pointer", display: "grid" }}
        >
          <motion.div
            initial={false}
            animate={reduced ? {} : { rotateX: flipped ? 180 : 0 }}
            transition={t}
            style={{ display: "grid", transformStyle: "preserve-3d", gridTemplateAreas: '"cell"' }}
          >
            <motion.div
              initial={false}
              animate={{ opacity: flipped ? 0 : 1 }}
              transition={reduced ? { duration: 0.15 } : { duration: 0.18, delay: flipped ? 0 : 0.14 }}
              style={{ gridArea: "cell", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", display: "flex", flexDirection: "column", gap: 14 }}
            >
              <h2 style={headlineStyle(setupFs, 1.08)}>{card.setup}</h2>
              <span className="font-mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, border: "1.5px solid var(--accent)" }} />
                tap to flip
              </span>
            </motion.div>
            <motion.div
              initial={false}
              animate={{ opacity: flipped ? 1 : 0 }}
              transition={reduced ? { duration: 0.15 } : { duration: 0.18, delay: flipped ? 0.14 : 0 }}
              aria-hidden={!flipped}
              style={{
                gridArea: "cell",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: reduced ? undefined : "rotateX(180deg)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                pointerEvents: flipped ? "auto" : "none",
              }}
            >
              <span className="font-mono uppercase" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--accent)" }}>the payoff</span>
              <p style={{ ...bodyStyle(payoffFs), borderLeft: "3px solid var(--accent)", paddingLeft: 14 }}>{card.payoff}</p>
            </motion.div>
          </motion.div>
        </motion.div>
      </Rise>
      {card.visual && card.visual.kind !== "icon" && card.visual.kind !== "none" && (
        <Rise>
          <motion.div initial={false} animate={{ opacity: flipped ? 0.4 : 1 }} transition={{ duration: 0.3 }}>
            <Visual spec={card.visual} size="sm" />
          </motion.div>
        </Rise>
      )}
    </CardFrame>
  );
}
