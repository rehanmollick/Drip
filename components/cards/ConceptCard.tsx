"use client";
import { motion } from "framer-motion";
import type { ConceptCard as ConceptCardT } from "@/lib/schemas/cards";
import type { VisualSpec } from "@/lib/schemas/visual";
import type { CardViewProps } from "./types";
import { CardFrame, Dials, PROSE_MEASURE, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Visual } from "./Visual";
import { useTheme } from "@/components/theme/ThemeRoot";
import { claimTerms, fitFontSize, ledeAndRest } from "./helpers";
import { growIn } from "@/lib/motion";

/**
 * concept — one idea. Two shapes, because "headline + paragraph" over and over
 * is the thing that reads like a wall:
 *
 *  - WITH a visual: headline → the visual, given real room in a framed panel →
 *    a tighter body underneath. The visual is part of the idea, not decoration,
 *    so it reads before the prose does.
 *  - WITHOUT one: the paragraph is broken into its own parts — a lede that
 *    carries the idea, an accent rule drawn under it, then the elaboration
 *    arriving a sentence at a time. Same words, composed instead of dumped.
 *
 * `terms` underline inline (components/cards/Glossed.tsx) — that's how a card
 * can explain a word without spending its word budget on it. Each term belongs
 * to exactly one of the two blocks, so nothing gets underlined twice.
 */
export function ConceptView({ card, entered, onAskAbout, onDial }: CardViewProps<ConceptCardT>) {
  const spec = card.visual;
  const kind = spec?.kind ?? "none";
  const hasVisual = kind !== "none";
  const iconAbove = kind === "icon";
  const inPanel = hasVisual && !iconAbove && kind !== "ascii";

  const { lede, rest } = hasVisual ? { lede: card.body, rest: "" } : ledeAndRest(card.body);
  const { claimed, left } = claimTerms(lede, card.terms);

  const bodyFs = hasVisual
    ? fitFontSize(card.body, [[160, 18], [240, 17], [Infinity, 16]])
    : fitFontSize(card.body, [[170, 20], [250, 19], [Infinity, 18]]);
  const ledeFs = rest ? fitFontSize(lede, [[70, 23], [110, 21], [Infinity, 19]]) : bodyFs;
  const restFs = fitFontSize(rest, [[120, 17], [200, 16], [Infinity, 15]]);
  const headFs = hasVisual
    ? fitFontSize(card.headline, [[34, 30], [50, 27], [Infinity, 25]])
    : fitFontSize(card.headline, [[28, 38], [44, 33], [Infinity, 29]]);

  return (
    <CardFrame
      card={card}
      entered={entered}
      onAskAbout={onAskAbout}
      gap={hasVisual ? 12 : 16}
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
          {!hasVisual && !rest && <AccentRule />}
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
          text={lede}
          terms={claimed}
          cascade
          className="font-body"
          style={{
            margin: 0,
            fontSize: ledeFs,
            lineHeight: hasVisual ? 1.4 : rest ? 1.32 : 1.45,
            color: "var(--ink)",
            maxWidth: hasVisual ? "100%" : PROSE_MEASURE,
            textWrap: "pretty",
            overflowWrap: "anywhere",
          }}
        />
      </Rise>

      {rest && (
        <Rise style={{ marginTop: -4 }}>
          <AccentRule />
        </Rise>
      )}

      {rest && (
        <Rise style={{ marginTop: -6 }}>
          <Glossed
            text={rest}
            terms={left}
            cascade
            className="font-body"
            style={{
              margin: 0,
              fontSize: restFs,
              lineHeight: 1.45,
              color: "var(--ink-2)",
              maxWidth: PROSE_MEASURE,
              textWrap: "pretty",
              overflowWrap: "anywhere",
            }}
          />
        </Rise>
      )}

      {hasTerms(card.body, card.terms) && (
        <Rise>
          <GlossHint text={card.body} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}

/** The accent hairline, drawn left-to-right as the card lands. */
function AccentRule() {
  const { spring, reduced } = useTheme();
  return (
    <motion.span
      aria-hidden
      variants={growIn(1, spring, reduced, { axis: "x", delay: 120 })}
      style={{ display: "block", width: 46, height: 3, borderRadius: 2, background: "var(--accent)" }}
    />
  );
}

/** A visual with presence: framed, centered, breathing — reads as part of the idea. */
function VisualPanel({ spec }: { spec?: VisualSpec | null }) {
  return (
    <div
      data-visual-panel
      style={{
        padding: spec?.kind === "stat" ? "16px" : "12px 16px",
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
