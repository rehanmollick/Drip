"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { BinaryCard as BinaryCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { OptionButton, type OptionState } from "@/components/ui/OptionButton";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Shake } from "@/components/ui/Shake";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize, reserveHeight } from "./helpers";

/**
 * binary — two big options under a hot take. Correct → accent flash + local
 * confetti; wrong → shake + the reveal slides in. Both end with revealCopy,
 * which carries the inline glossary. The reveal slot is reserved (hint line
 * included) so the options never jump when the payoff lands.
 * A prior `interaction` renders the answered state with no animation.
 */
export function BinaryView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<BinaryCardT>) {
  const { spring, reduced } = useTheme();
  const prior = typeof interaction?.choice === "number" ? interaction.choice : null;
  const [picked, setPicked] = useState<number | null>(prior);
  const [burst, setBurst] = useState(0);
  const [shake, setShake] = useState(0);
  const [live, setLive] = useState(false); // answered in THIS mount → animate the payoff

  const tap = useCallback(
    (i: number) => {
      if (picked != null) return;
      const correct = i === card.correctIndex;
      setPicked(i);
      setLive(true);
      if (correct) {
        setBurst((b) => b + 1);
        ticks.correct();
      } else {
        setShake((s) => s + 1);
      }
      onInteract?.({ choice: i, correct });
    },
    [picked, card.correctIndex, onInteract],
  );

  const stateFor = (i: number): OptionState => {
    if (picked == null) return "idle";
    if (i === card.correctIndex) return "correct";
    if (i === picked) return "wrong";
    return "dim";
  };
  const answered = picked != null;
  const wasWrong = answered && picked !== card.correctIndex;
  const promptFs = fitFontSize(card.prompt, [[60, 32], [100, 28], [Infinity, 25]]);
  const revealFs = fitFontSize(card.revealCopy, [[160, 17.5], [Infinity, 16.5]]);
  const glossed = hasTerms(card.revealCopy, card.terms);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      {card.eyebrow && (
        <Rise>
          <Eyebrow>{card.eyebrow}</Eyebrow>
        </Rise>
      )}
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <Shake trigger={shake} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {card.options.map((label, i) => (
            <OptionButton
              key={i}
              label={label}
              state={stateFor(i)}
              onTap={() => tap(i)}
              burst={i === picked && picked === card.correctIndex ? burst : 0}
              disabled={answered && i !== picked}
            />
          ))}
        </Shake>
      </Rise>
      {/* reserved slot: the payoff lands here without shifting the options */}
      <div style={{ minHeight: reserveHeight(card.revealCopy, revealFs, 40) + (glossed ? 24 : 0) }}>
      <AnimatePresence initial={live}>
        {answered && (
          <motion.div
            key="reveal"
            data-reveal
            initial={live ? { opacity: 0, x: wasWrong && !reduced ? -14 : 0, y: !wasWrong && !reduced ? 10 : 0 } : false}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={reduced ? { duration: 0.15 } : { ...spring, delay: wasWrong ? 0.25 : 0.1 }}
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <span
              aria-hidden
              style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: wasWrong ? "var(--state-wrong)" : "var(--state-correct)", flexShrink: 0, opacity: 0.9 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <Glossed
                text={card.revealCopy}
                terms={card.terms}
                style={{ ...bodyStyle(revealFs), color: "var(--ink)" }}
              />
              {glossed && <GlossHint text={card.revealCopy} terms={card.terms} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </CardFrame>
  );
}
