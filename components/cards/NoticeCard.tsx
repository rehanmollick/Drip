"use client";
import { motion } from "framer-motion";
import type { NoticeCard as NoticeCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GhostButton } from "@/components/ui/GhostButton";
import { SignatureEyebrow, SignatureHeadline } from "@/components/ui/Signature";
import { useTheme } from "@/components/theme/ThemeRoot";

const EYEBROW: Record<NoticeCardT["kind"], string> = {
  budget: "budget",
  catching_up: "catching up…",
  offline: "offline",
  planning: "reading your stuff…",
  error: "hmm",
};

/**
 * notice — themed in-feed messages, never a raw spinner: budget, catching_up
 * (shimmer skeleton + signature device), offline, planning ("reading your
 * stuff…"), error (one-tap retry → onAction).
 */
export function NoticeView({ card, entered, onAction, onAskAbout }: CardViewProps<NoticeCardT>) {
  const { reduced } = useTheme();
  const k = card.kind;
  const busy = k === "catching_up" || k === "planning";
  const eyebrow = card.eyebrow ?? EYEBROW[k];

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
        {busy ? (
          <SignatureHeadline as="h2" seed={card.id} style={headlineStyle(card.headline.length > 40 ? 28 : 34, 1.05)}>
            {card.headline}
          </SignatureHeadline>
        ) : (
          <h2 style={headlineStyle(card.headline.length > 40 ? 28 : 34, 1.05)}>{card.headline}</h2>
        )}
      </Rise>
      {card.body && (
        <Rise>
          <p className="font-body" style={{ margin: 0, fontSize: 17, lineHeight: 1.4, color: "var(--ink-2)", maxWidth: 320, textWrap: "pretty" }}>{card.body}</p>
        </Rise>
      )}
      {busy && (
        <Rise>
          <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <span className="shimmer" style={{ display: "block", height: 14, width: "78%", borderRadius: 7 }} />
            <span className="shimmer" style={{ display: "block", height: 14, width: "92%", borderRadius: 7 }} />
            <span className="shimmer" style={{ display: "block", height: 14, width: "60%", borderRadius: 7 }} />
            <span className="shimmer" style={{ display: "block", height: 96, width: "100%", borderRadius: 14, marginTop: 8 }} />
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
