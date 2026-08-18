"use client";
import type { ConceptCard as ConceptCardT } from "@/lib/schemas/cards";
import type { VisualSpec } from "@/lib/schemas/visual";
import type { CardViewProps } from "./types";
import { CardFrame, Dials, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Visual } from "./Visual";
import { fitFontSize } from "./helpers";

/**
 * concept — one idea. Two shapes, because "headline + paragraph" over and over
 * is the thing that reads like a wall:
 *
 *  - WITH a visual: headline → the visual, given real room in a framed panel →
 *    a tighter body underneath. The visual is part of the idea, not decoration,
 *    so it reads before the prose does.
 *  - WITHOUT one: the type scale opens up (bigger headline, an accent rule,
 *    measured line length) so the card is composed rather than dense.
 *
 * `terms` underline inline (components/cards/Glossed.tsx) — that's how a card
 * can explain a word without spending its word budget on it.
 */
export function ConceptView({ card, entered, onAskAbout, onDial }: CardViewProps<ConceptCardT>) {
  const spec = card.visual;
  const kind = spec?.kind ?? "none";
  const hasVisual = kind !== "none";
  const iconAbove = kind === "icon";
  const inPanel = hasVisual && !iconAbove && kind !== "ascii";

  const bodyFs = hasVisual
    ? fitFontSize(card.body, [[160, 18], [240, 17], [Infinity, 16]])
    : fitFontSize(card.body, [[170, 20], [250, 19], [Infinity, 18]]);
  const headFs = hasVisual
    ? fitFontSize(card.headline, [[34, 30], [50, 27], [Infinity, 25]])
    : fitFontSize(card.headline, [[28, 38], [44, 33], [Infinity, 29]]);

  return (
    <CardFrame
      card={card}
      entered={entered}
      onAskAbout={onAskAbout}
      align="center"
      gap={hasVisual ? 14 : 18}
      footer={<Dials onDial={onDial} />}
    >
      {iconAbove && (
        <Rise>
          <Visual spec={spec} size="md" />
        </Rise>
      )}
      {card.eyebrow && (
        <Rise>
          <Eyebrow>{card.eyebrow}</Eyebrow>
        </Rise>
      )}
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: hasVisual ? 0 : 12 }}>
          <h2 style={headlineStyle(headFs, 1.05)}>{card.headline}</h2>
          {!hasVisual && (
            <span aria-hidden style={{ display: "block", width: 38, height: 3, borderRadius: 2, background: "var(--accent)" }} />
          )}
        </div>
      </Rise>

      {hasVisual && !iconAbove && (
        <Rise>
          {inPanel ? (
            <VisualPanel spec={spec} />
          ) : (
            <Visual spec={spec} size="md" />
          )}
        </Rise>
      )}

      <Rise>
        <Glossed
          text={card.body}
          terms={card.terms}
          className="font-body"
          style={{
            margin: 0,
            fontSize: bodyFs,
            lineHeight: hasVisual ? 1.4 : 1.45,
            color: "var(--ink)",
            maxWidth: hasVisual ? "100%" : 340,
            textWrap: "pretty",
            overflowWrap: "anywhere",
          }}
        />
      </Rise>

      {hasTerms(card.body, card.terms) && (
        <Rise>
          <GlossHint text={card.body} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}

/** A visual with presence: framed, centered, breathing — reads as part of the idea. */
function VisualPanel({ spec }: { spec?: VisualSpec | null }) {
  return (
    <div
      data-visual-panel
      style={{
        padding: spec?.kind === "stat" ? "16px 18px" : "14px 16px",
        borderRadius: 18,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        alignItems: spec?.kind === "stat" ? "flex-start" : "stretch",
      }}
    >
      <Visual spec={spec} size="lg" />
    </div>
  );
}
