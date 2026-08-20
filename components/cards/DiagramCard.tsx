"use client";
import type { DiagramCard as DiagramCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Dials, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { DiagramRenderer } from "@/components/diagrams";
import { useEnterOnce } from "@/lib/motion";

/** diagram — title + the themed SVG diagram (components/diagrams) + dials. */
export function DiagramView({ card, entered, onAskAbout, onDial }: CardViewProps<DiagramCardT>) {
  const shown = useEnterOnce(entered);
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={12} footer={<Dials onDial={onDial} />}>
      {/* top-anchored card: clear the feed's back chevron (~64px tall incl. its offset) */}
      <Rise style={{ paddingTop: 44 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {card.eyebrow && <Eyebrow>{card.eyebrow}</Eyebrow>}
          <h2 style={{ ...headlineStyle(24, 1.1), fontWeight: 600 }}>{card.title}</h2>
        </div>
      </Rise>
      <Rise style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <DiagramRenderer card={card} entered={shown} style={{ width: "100%", height: "100%" }} />
        </div>
      </Rise>
    </CardFrame>
  );
}
