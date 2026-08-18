"use client";
import type { HookCard as HookCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Visual } from "./Visual";

/**
 * hook — one bold claim/question, huge type, vertically centered, signature
 * device on. The headline lands whole and at once: a claim delivered in three
 * beats is a claim that arrived late. Only the sub-line carries the glossary.
 */
export function HookView({ card, entered, onAskAbout }: CardViewProps<HookCardT>) {
  const long = card.headline.length > 60;
  const fs = long ? "clamp(34px, 9.6vw, 48px)" : "clamp(40px, 11vw, 56px)";
  const iconAbove = card.visual?.kind === "icon";
  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={20}>
      {iconAbove && (
        <Rise>
          <Visual spec={card.visual} size="md" />
        </Rise>
      )}
      <Rise>
        <SignatureEyebrow text={card.eyebrow} seed={card.id} />
      </Rise>
      <Rise>
        <SignatureHeadline as="h1" seed={card.id} style={headlineStyle(fs, 0.98)}>
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
            style={{ margin: 0, fontSize: 19, lineHeight: 1.35, color: "var(--ink-2)", textWrap: "pretty", maxWidth: 340, overflowWrap: "anywhere" }}
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
