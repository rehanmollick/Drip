"use client";
import { motion } from "framer-motion";
import type { NoticeCard as NoticeCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GhostButton } from "@/components/ui/GhostButton";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { PlanReveal, ProtoRail, usePlanTheatre } from "@/components/feed/PlanningTheatre";
import { useTheme } from "@/components/theme/ThemeRoot";

const EYEBROW: Record<NoticeCardT["kind"], string> = {
  budget: "budget",
  catching_up: "catching up…",
  offline: "offline",
  planning: "reading your stuff…",
  error: "hmm",
};

/**
 * notice — themed in-feed messages, never a raw spinner: budget, catching_up,
 * offline, error (one-tap retry → onAction), and planning — which is a
 * narrated reveal, not a skeleton: while the plan is being made a proto-rail
 * breathes; the moment it lands the palette has already surfaced (the theme
 * repaints the whole feed), the persona says one line, and the first stops of
 * the thread tick in. Data arrives via PlanTheatreContext from the feed's
 * session poll; without a provider (dev fixtures) the card still stands alone.
 */
export function NoticeView({ card, entered, onAction, onAskAbout }: CardViewProps<NoticeCardT>) {
  const { reduced } = useTheme();
  const theatre = usePlanTheatre();
  const k = card.kind;
  const planned = k === "planning" && !!theatre?.planned;
  const busy = k === "catching_up" || (k === "planning" && !planned);
  const eyebrow = planned ? "they’re here" : (card.eyebrow ?? EYEBROW[k]);
  // once the plan lands, the card stops saying "reading your stuff" and starts saying what it made
  const headline = planned && theatre?.title ? theatre.title : card.headline;

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <Rise>
        {busy ? (
          <motion.span
            animate={reduced ? undefined : { opacity: [1, 0.45, 1] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
            style={{ display: "inline-block" }}
          >
            <SignatureEyebrow text={eyebrow} seed={card.id} />
          </motion.span>
        ) : k === "error" ? (
          <Eyebrow tone="muted">{eyebrow}</Eyebrow>
        ) : (
          <SignatureEyebrow text={eyebrow} seed={card.id} />
        )}
      </Rise>
      <Rise>
        {busy || planned ? (
          <SignatureHeadline as="h2" seed={card.id} style={headlineStyle(headline.length > 40 ? 28 : 34, 1.05)}>
            {headline}
          </SignatureHeadline>
        ) : (
          <h2 style={headlineStyle(headline.length > 40 ? 28 : 34, 1.05)}>{headline}</h2>
        )}
      </Rise>
      {card.body && !planned && (
        <Rise>
          <p className="font-body" style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: "var(--ink-2)", maxWidth: 320, textWrap: "pretty" }}>{card.body}</p>
        </Rise>
      )}
      {k === "planning" && (
        <Rise>
          <div style={{ marginTop: 6, width: "100%" }}>{planned && theatre ? <PlanReveal theatre={theatre} /> : <ProtoRail />}</div>
        </Rise>
      )}
      {k === "catching_up" && (
        <Rise>
          <div style={{ marginTop: 6 }}>
            <ProtoRail />
          </div>
        </Rise>
      )}
      {k === "error" && onAction && (
        <Rise>
          <GhostButton tone="accent" size="lg" onClick={onAction} ariaLabel="try again" style={{ minWidth: 160 }}>
            <span aria-hidden>↻</span> try again
          </GhostButton>
        </Rise>
      )}
      {k === "offline" && (
        <Rise>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-2)" }}>
            what you already scrolled still works.
          </span>
        </Rise>
      )}
    </CardFrame>
  );
}
