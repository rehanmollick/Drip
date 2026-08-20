"use client";
import { motion } from "framer-motion";
import type { WrapCard as WrapCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { Glossed } from "./Glossed";
import { LiteralOdometer } from "@/components/ui/Odometer";
import { useTheme } from "@/components/theme/ThemeRoot";
import { fitFontSize } from "./helpers";
import { growIn } from "@/lib/motion";

/** The parting number steps down rather than wrapping onto a second line. */
const STAT_FIT = [[3, 44], [6, 40], [9, 34], [Infinity, 27]] as const;

/**
 * wrap — the ending, and only ever because it was asked for at a crossroads.
 * Headline, the thread in 3–5 beats strung together by a hairline so they read
 * as one line of reasoning, an optional number to leave them with, and
 * `openThread` at the bottom as an invitation rather than a cliffhanger.
 * Should read like a satisfying last page.
 */
export function WrapView({ card, entered, onAskAbout }: CardViewProps<WrapCardT>) {
  const { spring, reduced } = useTheme();
  const beats = card.beats;
  const totalBeats = beats.reduce((n, b) => n + b.length, 0);
  const beatFs = totalBeats > 460 ? 14.5 : totalBeats > 320 ? 15.5 : beats.length >= 5 ? 16 : 17;
  const beatGap = beats.length >= 5 ? 8 : 12;
  const headFs = fitFontSize(card.headline, [[34, 34], [56, 29], [Infinity, 26]]);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={16}>
      <Rise>
        <SignatureEyebrow text={card.eyebrow ?? "that's the thread"} seed={card.id} />
      </Rise>

      <Rise>
        <SignatureHeadline as="h1" seed={card.id} style={headlineStyle(headFs, 1.05)}>
          {card.headline}
        </SignatureHeadline>
      </Rise>

      <ol data-wrap-beats style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: beatGap }}>
        {beats.map((beat, i) => (
          <Rise key={i}>
            <li style={{ position: "relative", display: "flex", gap: 12, alignItems: "flex-start" }}>
              {i < beats.length - 1 && (
                <motion.span
                  aria-hidden
                  data-beat-link
                  variants={growIn(1, spring, reduced, { axis: "y", origin: "center top", delay: 120 })}
                  style={{
                    position: "absolute",
                    left: 10,
                    marginLeft: -0.5,
                    top: 16,
                    bottom: -(beatGap - 2),
                    width: 1,
                    background: "color-mix(in oklab, var(--accent) 34%, transparent)",
                  }}
                />
              )}
              <span
                className="font-mono"
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: 20,
                  paddingTop: 2,
                  fontSize: 10.5,
                  letterSpacing: "0.1em",
                  color: "var(--accent)",
                  opacity: 0.85,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <Glossed
                text={beat}
                cascade
                wrapStyle={{ flex: "1 1 auto" }}
                className="font-body"
                style={{ margin: 0, fontSize: beatFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
              />
            </li>
          </Rise>
        ))}
      </ol>

      {card.stat && (
        <Rise>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <LiteralOdometer
              value={card.stat.value}
              entered={entered}
              reduced={reduced}
              fit={STAT_FIT}
              style={{ lineHeight: 0.95, letterSpacing: "-0.035em" }}
            />
            <span className="font-body" style={{ fontSize: 14, lineHeight: 1.25, color: "var(--ink-2)", minWidth: 0, overflowWrap: "anywhere" }}>
              {card.stat.label}
            </span>
          </div>
        </Rise>
      )}

      {card.openThread && (
        <Rise>
          <div
            data-wrap-open-thread
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingTop: 12,
              borderTop: "1px solid var(--line)",
            }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--accent)" }}>
              still out there
            </span>
            <p className="font-body" style={{ margin: 0, fontSize: 15, lineHeight: 1.35, color: "var(--ink-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>
              {card.openThread}
            </p>
          </div>
        </Rise>
      )}
    </CardFrame>
  );
}
