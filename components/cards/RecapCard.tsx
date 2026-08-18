"use client";
import { motion } from "framer-motion";
import type { RecapCard as RecapCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { useTheme } from "@/components/theme/ThemeRoot";
import { claimTerms, fitFontSize } from "./helpers";
import { growIn } from "@/lib/motion";

/**
 * recap — headline + 3 beats with numbered mono markers. A hairline grows down
 * from each marker into the next one as the beats land, so three sentences read
 * as one chain of reasoning rather than three bullets that happen to be stacked.
 */
export function RecapView({ card, entered, onAskAbout }: CardViewProps<RecapCardT>) {
  const { spring, reduced } = useTheme();
  const headFs = fitFontSize(card.headline, [[36, 30], [Infinity, 26]]);
  const longest = Math.max(...card.beats.map((b) => b.length));
  const beatFs = longest > 90 ? 16 : 17;
  // each term belongs to the first beat that says it — never underlined twice on one screen
  let pool = card.terms ?? [];
  const beatTerms = card.beats.map((beat) => {
    const { claimed, left } = claimTerms(beat, pool);
    pool = left;
    return claimed;
  });
  const allBeats = card.beats.join(" ");

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={16}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "rewind"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(headFs, 1.08)}>{card.headline}</h2>
      </Rise>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {card.beats.map((beat, i) => (
          <Rise key={i}>
            <li style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
              {i < card.beats.length - 1 && (
                <motion.span
                  aria-hidden
                  data-beat-link
                  variants={growIn(1, spring, reduced, { axis: "y", origin: "center top", delay: 140 })}
                  style={{
                    position: "absolute",
                    left: 15,
                    marginLeft: -0.75,
                    top: 33,
                    bottom: -16,
                    width: 1.5,
                    borderRadius: 1,
                    background: "color-mix(in oklab, var(--accent) 40%, transparent)",
                  }}
                />
              )}
              <span
                className="font-mono"
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  color: "var(--accent)",
                  border: "1px solid color-mix(in oklab, var(--accent) 45%, transparent)",
                  background: "var(--accent-soft)",
                  marginTop: 1,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <Glossed
                text={beat}
                terms={beatTerms[i]}
                cascade
                wrapStyle={{ flex: "1 1 auto" }}
                className="font-body"
                style={{ margin: 0, fontSize: beatFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
              />
            </li>
          </Rise>
        ))}
      </ol>
      {hasTerms(allBeats, card.terms) && (
        <Rise>
          <GlossHint text={allBeats} terms={card.terms} />
        </Rise>
      )}
      {card.metaphor && (
        <Rise>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-2)" }}>
            new angle · {card.metaphor}
          </span>
        </Rise>
      )}
    </CardFrame>
  );
}
