"use client";
import type { ConceptCard as ConceptCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Dials, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Visual } from "./Visual";
import { fitFontSize } from "./helpers";

/** concept — one idea: headline + ≤55-word body + a visual slot; dials at the bottom. */
export function ConceptView({ card, entered, onAskAbout, onDial }: CardViewProps<ConceptCardT>) {
  const bodyFs = fitFontSize(card.body, [[180, 19], [260, 18], [Infinity, 17]]);
  const headFs = fitFontSize(card.headline, [[36, 32], [52, 29], [Infinity, 26]]);
  const hasVisual = !!card.visual && card.visual.kind !== "none";
  const iconAbove = card.visual?.kind === "icon";
  return (
    <CardFrame
      card={card}
      entered={entered}
      onAskAbout={onAskAbout}
      align="center"
      gap={16}
      footer={<Dials onDial={onDial} />}
    >
      {iconAbove && (
        <Rise>
          <Visual spec={card.visual} size="sm" />
        </Rise>
      )}
      {card.eyebrow && (
        <Rise>
          <Eyebrow>{card.eyebrow}</Eyebrow>
        </Rise>
      )}
      <Rise>
        <h2 style={headlineStyle(headFs, 1.05)}>{card.headline}</h2>
      </Rise>
      <Rise>
        <p style={bodyStyle(bodyFs)}>{card.body}</p>
      </Rise>
      {hasVisual && !iconAbove && (
        <Rise style={{ marginTop: 4 }}>
          <Visual spec={card.visual} size="md" />
        </Rise>
      )}
    </CardFrame>
  );
}
