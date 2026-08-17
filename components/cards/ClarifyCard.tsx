"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { ClarifyCard as ClarifyCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { OptionButton } from "@/components/ui/OptionButton";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize } from "./helpers";

/**
 * clarify — setup question as a card (never a form). 2–3 options;
 * onInteract({choice: index}). Answered → checkmark state.
 */
export function ClarifyView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<ClarifyCardT>) {
  const prior =
    typeof interaction?.choice === "number" ? interaction.choice
    : typeof interaction?.choice === "string" ? Math.max(-1, card.options.indexOf(interaction.choice))
    : -1;
  const [picked, setPicked] = useState<number | null>(prior >= 0 ? prior : null);
  const [live, setLive] = useState(false);
  const tap = useCallback(
    (i: number) => {
      if (picked != null) return;
      setPicked(i);
      setLive(true);
      ticks.tap();
      onInteract?.({ choice: i });
    },
    [picked, onInteract],
  );
  const promptFs = fitFontSize(card.prompt, [[50, 32], [90, 28], [Infinity, 25]]);
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "quick one"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {card.options.map((label, i) => (
            <OptionButton
              key={i}
              label={label}
              state={picked == null ? "idle" : i === picked ? "correct" : "dim"}
              onTap={() => tap(i)}
              disabled={picked != null && i !== picked}
            />
          ))}
        </div>
      </Rise>
      <div style={{ minHeight: 24 }}>
        <AnimatePresence initial={live}>
          {picked != null && (
            <motion.span
              key="ok"
              initial={live ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              className="font-mono"
              style={{ fontSize: 12, letterSpacing: "0.12em", color: "var(--ink-2)" }}
            >
              got it. shaping the feed around that.
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </CardFrame>
  );
}
