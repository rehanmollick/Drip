"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import type { SpotCard as SpotCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Panel } from "@/components/ui/Panel";
import { Confetti } from "@/components/ui/Confetti";
import { Shake } from "@/components/ui/Shake";
import { Verdict, VERDICT_SLOT } from "@/components/ui/Verdict";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { useTheme } from "@/components/theme/ThemeRoot";
import { usePressable } from "@/lib/motion";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize, reserveHeight } from "./helpers";

/**
 * spot — find the one line that matters inside real material.
 *
 * The pieces ARE the content, so a wrong tap still leaves them having read the
 * whole thing: a miss shakes and dims that row and THE HUNT CONTINUES. Only
 * finding every hit ends the card. Calibration reads the first tap — spotting
 * it straight off is the thing worth measuring, and the rest is the reader
 * working, not failing.
 *
 * The note and the payoff share ONE reserved slot under the panel. Growing the
 * rows themselves would push a seven-piece card past the bottom of the phone.
 */
export function SpotView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<SpotCardT>) {
  const { spring, reduced } = useTheme();
  const pressable = usePressable();
  const prior = useMemo(() => tappedFrom(interaction?.choice, card.pieces.length), [interaction?.choice, card.pieces.length]);
  const [tapped, setTapped] = useState<number[]>(prior);
  const [shakes, setShakes] = useState<number[]>(() => card.pieces.map(() => 0));
  const [burst, setBurst] = useState(0);
  const [live, setLive] = useState(false);   // tapped in THIS mount → animate the payoff

  const hits = useMemo(() => card.pieces.map((p, i) => (p.hit ? i : -1)).filter((i) => i >= 0), [card.pieces]);
  const found = hits.filter((i) => tapped.includes(i));
  const solved = found.length === hits.length;
  const last = tapped.length ? tapped[tapped.length - 1] : null;

  const tap = useCallback(
    (i: number) => {
      if (solved || tapped.includes(i)) return;
      const hit = card.pieces[i].hit;
      const next = [...tapped, i];
      setTapped(next);
      setLive(true);
      if (hit) {
        setBurst((b) => b + 1);
        ticks.correct();
      } else {
        setShakes((s) => s.map((v, j) => (j === i ? v + 1 : v)));
      }
      // the FIRST tap is the measurement; later ones only widen `choice` (engine ignores a second `correct`)
      onInteract?.({ choice: next.map(String), correct: card.pieces[next[0]].hit });
    },
    [solved, tapped, card.pieces, onInteract],
  );

  const longestText = card.pieces.reduce((a, p) => (p.text.length > a.length ? p.text : a), "");
  const pieceFs = pieceFontSize(longestText, card.pieces.length, card.mono);
  const promptFs = fitFontSize(card.prompt, [[48, 28], [80, 25], [Infinity, 22]]);
  const noteFs = 14.5;
  const revealFs = fitFontSize(card.revealCopy, [[140, 16], [Infinity, 15]]);
  const longestNote = card.pieces.reduce((a, p) => ((p.note ?? "").length > a.length ? p.note ?? "" : a), "");
  const slot = Math.max(
    longestNote ? reserveHeight(longestNote, noteFs, 42) : 0,
    reserveHeight(card.revealCopy, revealFs, 40) + VERDICT_SLOT,
  );

  const note = last != null ? card.pieces[last].note : undefined;
  const lastWasHit = last != null && card.pieces[last].hit;

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={16}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "spot it"}</Eyebrow>
      </Rise>

      <Rise>
        <h2 style={headlineStyle(promptFs, 1.1)}>{card.prompt}</h2>
      </Rise>

      <Rise style={{ position: "relative" }}>
        {/* the burst rides OUTSIDE the panel — inside it, half the particles die on the clip */}
        <Confetti burst={lastWasHit ? burst : 0} count={12} origin={{ x: 50, y: rowCenter(last ?? 0, card.pieces.length) }} />
        <Panel pad="none">
          {card.pieces.map((piece, i) => {
            const isTapped = tapped.includes(i);
            const isHit = isTapped && piece.hit;
            const isMiss = isTapped && !piece.hit;
            return (
              <Shake key={i} trigger={shakes[i]}>
                <motion.button
                  type="button"
                  onClick={() => tap(i)}
                  onPointerDown={(e) => e.stopPropagation()}   // CardFrame's 480ms long-press, not this tap
                  disabled={solved || isTapped}
                  whileTap={solved || isTapped ? undefined : pressable.whileTap}
                  transition={pressable.transition}
                  animate={{ opacity: isMiss ? 0.4 : 1 }}
                  initial={false}
                  data-spot-piece
                  data-state={isHit ? "hit" : isMiss ? "miss" : "idle"}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    width: "100%",
                    padding: piecePadding(card.pieces.length),
                    background: isHit ? "var(--accent-soft)" : "transparent",
                    border: "none",
                    borderTop: i === 0 ? "none" : "1px solid var(--line)",
                    borderLeft: `2px solid ${isHit ? "var(--accent)" : "transparent"}`,
                    textAlign: "left",
                    color: isHit ? "var(--accent)" : "var(--ink)",
                    cursor: solved || isTapped ? "default" : "pointer",
                    transition: "background-color 200ms ease, color 200ms ease, border-color 200ms ease",
                    WebkitTapHighlightColor: "transparent",
                    touchAction: "manipulation",
                    overflow: "visible",
                  }}
                >
                  <span
                    aria-hidden
                    className="font-mono"
                    style={{ flex: "0 0 auto", width: 12, fontSize: 12, lineHeight: `${pieceFs * 1.35}px`, color: isHit ? "var(--accent)" : isMiss ? "var(--state-wrong)" : "var(--ink-2)" }}
                  >
                    {isHit ? "✓" : isMiss ? "✕" : "·"}
                  </span>
                  <span
                    className={card.mono ? "font-mono" : "font-body"}
                    style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      fontSize: pieceFs,
                      lineHeight: 1.35,
                      fontWeight: isHit ? 600 : 400,
                      textDecorationLine: isMiss ? "line-through" : "none",
                      textDecorationColor: "var(--line)",
                      overflowWrap: "anywhere",
                      whiteSpace: card.mono ? "pre-wrap" : "normal",
                    }}
                  >
                    {piece.text}
                  </span>
                </motion.button>
              </Shake>
            );
          })}
        </Panel>
      </Rise>

      {/* one reserved slot: the tapped piece's note, then the payoff once every hit is found */}
      <div style={{ minHeight: slot }}>
        <AnimatePresence mode="wait" initial={live}>
          {(solved || note) && (
            <motion.div
              key={solved ? "reveal" : `note-${last}`}
              data-reveal={solved ? "" : undefined}
              initial={live ? { opacity: 0, y: reduced ? 0 : 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0.15 } : { ...spring, delay: solved ? 0.12 : 0 }}
              style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
            >
              <span
                aria-hidden
                style={{
                  width: 3,
                  alignSelf: "stretch",
                  borderRadius: 2,
                  flexShrink: 0,
                  opacity: 0.9,
                  background: solved ? "var(--state-correct)" : lastWasHit ? "var(--accent)" : "var(--state-wrong)",
                }}
              />
              {solved ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 auto", minWidth: 0 }}>
                  {/* the outcome in words, not just tint: colour + glyph + copy, always all three */}
                  <Verdict correct label="found it" />
                  <Glossed
                    text={card.revealCopy}
                    terms={card.terms}
                    className="font-body"
                    style={{ margin: 0, fontSize: revealFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
                  />
                </div>
              ) : (
                <p className="font-body" style={{ margin: 0, fontSize: noteFs, lineHeight: 1.4, color: "var(--ink-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>
                  {note}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {solved && hasTerms(card.revealCopy, card.terms) && (
        <div>
          <GlossHint text={card.revealCopy} terms={card.terms} />
        </div>
      )}
    </CardFrame>
  );
}

/** Replay a viewed card: `choice` is the tap order, recorded as piece indices. */
function tappedFrom(choice: unknown, count: number): number[] {
  if (!Array.isArray(choice)) return [];
  const out: number[] = [];
  for (const v of choice) {
    const i = Number(v);
    if (Number.isInteger(i) && i >= 0 && i < count && !out.includes(i)) out.push(i);
  }
  return out;
}

/** Vertical centre of row `i` as a percentage of the panel — where a hit's burst comes from. */
function rowCenter(i: number, count: number): number {
  return ((i + 0.5) / Math.max(1, count)) * 100;
}

/** Six 44-char rows at reading size still overflow 393×852; long or many pieces step down. */
function pieceFontSize(longest: string, count: number, mono: boolean): number {
  const base = fitFontSize(longest, mono ? [[26, 15], [38, 13.5], [Infinity, 12.5]] : [[26, 17], [40, 15.5], [Infinity, 14.5]]);
  return count >= 5 ? base - 1 : base;
}

/** Row padding shrinks with the row count — six rows cannot each afford 8px of breathing room. */
function piecePadding(count: number): string {
  return count >= 6 ? "4px 12px" : "8px 12px";
}
