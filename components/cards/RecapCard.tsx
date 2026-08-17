"use client";
import type { RecapCard as RecapCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fitFontSize } from "./helpers";

/** recap — headline + 3 beats with numbered mono markers, staggered. */
export function RecapView({ card, entered, onAskAbout }: CardViewProps<RecapCardT>) {
  const headFs = fitFontSize(card.headline, [[36, 30], [Infinity, 26]]);
  const longest = Math.max(...card.beats.map((b) => b.length));
  const beatFs = longest > 90 ? 16 : 17;
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
            <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
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
              <p style={bodyStyle(beatFs)}>{beat}</p>
            </li>
          </Rise>
        ))}
      </ol>
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
