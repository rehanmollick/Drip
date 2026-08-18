"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { PredictCard as PredictCardT } from "@/lib/schemas/cards";
import type { Interaction } from "@/lib/schemas/session";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { OptionButton, type OptionState } from "@/components/ui/OptionButton";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Confetti } from "@/components/ui/Confetti";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize } from "./helpers";

const MARKERS = ["a", "b", "c", "d"];

/**
 * predict (question slide) — "what happens next?" with 2–4 options. Tapping
 * records {choice, correct} but does NOT reveal; a hint says the payoff is one
 * swipe up (PredictRevealView is the next slide).
 */
export function PredictView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<PredictCardT>) {
  const { reduced } = useTheme();
  const prior = typeof interaction?.choice === "number" ? interaction.choice : null;
  const [picked, setPicked] = useState<number | null>(prior);
  const [live, setLive] = useState(false);

  const tap = useCallback(
    (i: number) => {
      if (picked != null) return;
      setPicked(i);
      setLive(true);
      ticks.tap();
      onInteract?.({ choice: i, correct: i === card.correctIndex });
    },
    [picked, card.correctIndex, onInteract],
  );
  const stateFor = (i: number): OptionState => (picked == null ? "idle" : i === picked ? "picked" : "dim");
  const promptFs = fitFontSize(card.prompt, [[60, 32], [100, 28], [Infinity, 25]]);
  const size = card.options.length > 3 ? "md" : "lg";

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "call it"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {card.options.map((label, i) => (
            <OptionButton key={i} label={label} marker={MARKERS[i]} size={size} state={stateFor(i)} onTap={() => tap(i)} disabled={picked != null && i !== picked} />
          ))}
        </div>
      </Rise>
      <div style={{ minHeight: 28 }}>
        <AnimatePresence initial={live}>
          {picked != null && (
            <motion.div
              key="hint"
              data-swipe-hint
              initial={live ? { opacity: 0, y: reduced ? 0 : 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="font-mono"
              style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, letterSpacing: "0.12em", color: "var(--ink-2)" }}
            >
              <motion.span
                aria-hidden
                animate={reduced ? undefined : { y: [0, -4, 0] }}
                transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                style={{ display: "inline-block", color: "var(--accent)" }}
              >
                ↑
              </motion.span>
              locked in. swipe up to see.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CardFrame>
  );
}

/**
 * predict (reveal slide) — the payoff on the NEXT slide: revealHeadline +
 * revealBody + "you said X" tinted by correctness (from the recorded interaction).
 */
export function PredictRevealView({
  card,
  interaction,
  entered,
  called,
  onAskAbout,
}: {
  card: PredictCardT;
  interaction?: Interaction | null;
  entered: boolean;
  /** lib/feed/progress.ts `calledIt`, read off the recorded answer. Undefined → fall back to this slide's own read. */
  called?: boolean;
  onAskAbout?: () => void;
}) {
  const { reduced } = useTheme();
  const choice = typeof interaction?.choice === "number" ? interaction.choice : null;
  const said = choice != null ? card.options[choice] : null;
  const correct = choice != null ? choice === card.correctIndex : null;
  const [burst, setBurst] = useState(0);
  const [fired, setFired] = useState(false);
  // confetti fires once, when the reveal slide is actually seen and the call was right
  useEffect(() => {
    if (entered && correct && !fired) {
      setFired(true);
      setBurst(1);
      ticks.reveal();
    }
  }, [entered, correct, fired]);
  /**
   * Two words, and the entire on-screen footprint of the pedagogy layer (lib/feed/progress.ts).
   * A nod, never a score: it never says how many, how often, or out of what. If a reader can tell
   * there is a retrieval schedule under the feed, it is wrong.
   */
  const nailed = called ?? correct === true;
  const headFs = fitFontSize(card.revealHeadline, [[36, 34], [Infinity, 29]]);
  const bodyFs = fitFontSize(card.revealBody, [[160, 18.5], [Infinity, 17]]);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <Rise>
        <Eyebrow>{nailed ? "called it" : correct === false ? "the twist" : "the answer"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(headFs, 1.05)}>{card.revealHeadline}</h2>
      </Rise>
      <Rise>
        <Glossed text={card.revealBody} terms={card.terms} cascade style={bodyStyle(bodyFs)} />
      </Rise>
      {hasTerms(card.revealBody, card.terms) && (
        <Rise>
          <GlossHint text={card.revealBody} terms={card.terms} />
        </Rise>
      )}
      <Rise>
        <div
          data-you-said
          style={{
            position: "relative",
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 14,
            border: `1.5px solid ${correct == null ? "var(--line)" : correct ? "var(--state-correct)" : "var(--state-wrong)"}`,
            background: correct == null ? "var(--surface)" : correct ? "color-mix(in oklab, var(--state-correct) 14%, transparent)" : "color-mix(in oklab, var(--state-wrong) 12%, transparent)",
            color: "var(--ink)",
            fontSize: 15,
            maxWidth: "100%",
            alignSelf: "flex-start",
          }}
        >
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--ink-2)", textTransform: "uppercase" }}>
            you said
          </span>
          <span style={{ fontWeight: 600 }}>{said ?? "nothing — you skipped it"}</span>
          {correct != null && (
            <span aria-hidden className="font-mono" style={{ color: correct ? "var(--state-correct)" : "var(--state-wrong)" }}>
              {correct ? "✓" : "✕"}
            </span>
          )}
          {!reduced && <Confetti burst={burst} count={12} />}
        </div>
      </Rise>
    </CardFrame>
  );
}
