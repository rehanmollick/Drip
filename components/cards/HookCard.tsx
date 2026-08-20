"use client";
import type { HookCard as HookCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, PROSE_MEASURE, Rise, headlineStyle } from "./CardFrame";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Visual } from "./Visual";

/**
 * hook — one bold claim/question, huge type, anchored upper-third, signature
 * device on. The headline lands whole and at once: a claim delivered in three
 * beats is a claim that arrived late. Only the sub-line carries the glossary.
 */
export function HookView({ card, entered, onAskAbout }: CardViewProps<HookCardT>) {
  // a five-word claim gets the biggest cut — glanceable from arm's length; the
  // top sizes open their leading a touch so stacked lines don't collide
  const len = card.headline.length;
  const fs = len > 60 ? "clamp(34px, 9.6vw, 48px)" : len > 30 ? "clamp(40px, 11vw, 56px)" : "clamp(44px, 13.5vw, 62px)";
  const lh = len > 60 ? 0.98 : len > 30 ? 1.02 : 1.06;
  const iconAbove = card.visual?.kind === "icon";
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={20}>
      {iconAbove && (
        <Rise>
          <Visual spec={card.visual} size="md" />
        </Rise>
      )}
      <Rise>
        <SignatureEyebrow text={card.eyebrow} seed={card.id} />
      </Rise>
      <Rise>
        <SignatureHeadline as="h1" seed={card.id} style={headlineStyle(fs, lh)}>
          {card.headline}
        </SignatureHeadline>
      </Rise>
      {card.sub && (
        <Rise>
          <Glossed
            text={card.sub}
            terms={card.terms}
            cascade
            className="font-body"
            style={{ margin: 0, fontSize: 19, lineHeight: 1.35, color: "var(--ink-2)", textWrap: "pretty", maxWidth: PROSE_MEASURE, overflowWrap: "anywhere" }}
          />
        </Rise>
      )}
      {card.sub && hasTerms(card.sub, card.terms) && (
        <Rise>
          <GlossHint text={card.sub} terms={card.terms} />
        </Rise>
      )}
      {!iconAbove && card.visual && card.visual.kind !== "none" && (
        <Rise style={{ marginTop: 6 }}>
          <Visual spec={card.visual} size="md" />
        </Rise>
      )}
    </CardFrame>
  );
}
