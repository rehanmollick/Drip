"use client";
import type { WrapCard as WrapCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { fitFontSize } from "./helpers";

/**
 * wrap — the ending, and only ever because it was asked for at a crossroads.
 * Headline, the thread in 3–5 beats with quiet numbering, an optional number
 * to leave them with, and `openThread` at the bottom as an invitation rather
 * than a cliffhanger. Should read like a satisfying last page.
 */
export function WrapView({ card, entered, onAskAbout }: CardViewProps<WrapCardT>) {
  const beats = card.beats;
  const totalBeats = beats.reduce((n, b) => n + b.length, 0);
  const beatFs = totalBeats > 460 ? 14.5 : totalBeats > 320 ? 15.5 : beats.length >= 5 ? 16 : 17;
  const beatGap = beats.length >= 5 ? 10 : 13;
  const headFs = fitFontSize(card.headline, [[34, 34], [56, 29], [Infinity, 26]]);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={16}>
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
            <li style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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
              <p
                className="font-body"
                style={{ margin: 0, fontSize: beatFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
              >
                {beat}
              </p>
            </li>
          </Rise>
        ))}
      </ol>

      {card.stat && (
        <Rise>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span
              className="font-display"
              style={{ fontSize: 44, lineHeight: 0.95, letterSpacing: "-0.035em", fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}
            >
              {card.stat.value}
            </span>
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
              gap: 5,
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
