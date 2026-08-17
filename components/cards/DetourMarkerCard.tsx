"use client";
import type { DetourMarkerCard as DetourMarkerCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";

/**
 * detour_marker — slim. open: eyebrow "detour" + the question in display type
 * behind an accent left border; close: "back to the main thread".
 */
export function DetourMarkerView({ card, entered, onAskAbout }: CardViewProps<DetourMarkerCardT>) {
  const open = card.kind === "open";
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={14}>
      {open ? (
        <>
          <Rise>
            <Eyebrow>{card.eyebrow ?? "detour"}</Eyebrow>
          </Rise>
          <Rise>
            <div style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={{ ...headlineStyle(card.question && card.question.length > 80 ? 26 : 30, 1.1), fontWeight: 600 }}>
                {card.question ?? card.label}
              </h2>
              {card.question && (
                <span className="font-body" style={{ fontSize: 14, color: "var(--ink-2)" }}>{card.label}</span>
              )}
            </div>
          </Rise>
        </>
      ) : (
        <>
          <Rise>
            <Eyebrow tone="muted">
              <span aria-hidden>↩ </span>rejoining
            </Eyebrow>
          </Rise>
          <Rise>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span aria-hidden style={{ height: 1, flex: "0 0 28px", background: "var(--accent)" }} />
              <h2 style={{ ...headlineStyle(24, 1.15), fontWeight: 600, color: "var(--ink)" }}>{card.label}</h2>
            </div>
          </Rise>
        </>
      )}
    </CardFrame>
  );
}
