"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenCard as OpenCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GhostButton } from "@/components/ui/GhostButton";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize, splitGlossed } from "./helpers";

const VERDICT: Record<string, { label: string; tint: string }> = {
  got_it: { label: "yep, that's it", tint: "var(--accent)" },
  close: { label: "close", tint: "var(--accent-alt)" },
  not_yet: { label: "not yet — here's the bit", tint: "var(--ink-2)" },
};

/**
 * open — say it in your own words. A real textarea, a submit, and a "just show
 * me" escape that hands over `modelAnswer` without grading anything.
 *
 * The reply is written against WHAT THEY WROTE (onAnswer → interaction.feedback),
 * so the answered state is: what they said, quoted and compact, then the reply
 * tinted by verdict. A miss is never red — it still teaches.
 */
export function OpenView({ card, entered, interaction, onAnswer, onInteract, onAskAbout }: CardViewProps<OpenCardT>) {
  const { spring, reduced } = useTheme();
  const feedback = interaction?.feedback ?? null;
  const priorText = interaction?.text ?? "";
  const priorShown = interaction?.choice === "shown";

  const [text, setText] = useState(priorText);
  const [sent, setSent] = useState<string | null>(priorText || null);
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState(priorShown);
  const [settled, setSettled] = useState(false);   // handler resolved but no reply landed
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;             // re-arm on remount (StrictMode mounts twice in dev)
    return () => { mounted.current = false; };
  }, []);

  // a reply landing (now or on scroll-back) always wins over local state
  useEffect(() => {
    if (feedback) {
      setPending(false);
      setSettled(false);
    }
  }, [feedback]);

  const submit = useCallback(async () => {
    const value = text.trim();
    if (!value || pending || sent) return;
    setSent(value);
    ticks.reveal();
    if (!onAnswer) {
      setSettled(true);           // nothing to grade against → hand over the model answer
      return;
    }
    setPending(true);
    try {
      await onAnswer(value);
    } finally {
      if (mounted.current) {
        setPending(false);
        setSettled(true);
      }
    }
  }, [text, pending, sent, onAnswer]);

  const showMe = useCallback(() => {
    setShown(true);
    onInteract?.({ choice: "shown" });
  }, [onInteract]);

  // an interaction can land AFTER mount (the feed refetches rows on scroll-back), so the quote
  // always falls back to whatever the server has for this card
  const said = sent ?? (priorText || null);
  const answered = !!feedback;
  const waiting = pending && !answered;
  const fellBack = !answered && !waiting && !!said && settled;
  const idle = !answered && !waiting && !said;

  const promptFs = fitFontSize(card.prompt, [[70, 28], [110, 25], [Infinity, 22]]);
  // terms the prompt already underlined don't get underlined twice on the same card
  const usedInPrompt = new Set(splitGlossed(card.prompt, card.terms).map((s) => s.term).filter(Boolean));
  const answerTerms = (card.terms ?? []).filter((t) => !usedInPrompt.has(t.term.trim()));
  const fb = feedback ? (VERDICT[feedback.verdict] ?? VERDICT.not_yet) : null;
  const feedbackFs = feedback ? fitFontSize(feedback.feedback, [[160, 17], [260, 16], [Infinity, 15]]) : 17;

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={14}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "your words"}</Eyebrow>
      </Rise>

      <Rise>
        <Glossed
          text={card.prompt}
          terms={card.terms}
          as="h2"
          style={headlineStyle(promptFs, 1.1)}
        />
      </Rise>

      {idle && (
        <>
          <Rise>
            <textarea
              data-open-input
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder={card.placeholder ?? "say it however it comes out"}
              aria-label="your answer"
              maxLength={1200}
              className="font-body"
              style={{
                width: "100%",
                boxSizing: "border-box",
                resize: "none",
                background: "var(--surface)",
                border: "1.5px solid var(--line)",
                borderRadius: 16,
                padding: "12px 14px",
                color: "var(--ink)",
                fontSize: 16,          // 16px: iOS refuses to zoom the viewport on focus
                lineHeight: 1.4,
                outline: "none",
                caretColor: "var(--accent)",
                userSelect: "text",
                WebkitUserSelect: "text",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
            />
          </Rise>
          <Rise>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <GhostButton tone="accent" size="md" onClick={() => void submit()} disabled={!text.trim()} ariaLabel="send it">
                send it <span aria-hidden>↑</span>
              </GhostButton>
              {!shown && (
                <GhostButton size="sm" onClick={showMe} ariaLabel="just show me">
                  just show me
                </GhostButton>
              )}
            </div>
          </Rise>
        </>
      )}

      {!idle && said && (
        <Rise>
          <blockquote
            data-open-said
            className="font-body"
            style={{
              margin: 0,
              paddingLeft: 12,
              borderLeft: "2px solid var(--line)",
              color: "var(--ink-2)",
              fontSize: 14.5,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {said}
          </blockquote>
        </Rise>
      )}

      <AnimatePresence initial={false}>
        {waiting && (
          <motion.div
            key="waiting"
            data-open-waiting
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={reduced ? { duration: 0.15 } : spring}
            aria-live="polite"
            style={{ display: "flex", flexDirection: "column", gap: 9 }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: "0.16em", color: "var(--ink-2)" }}>
              reading what you wrote…
            </span>
            <span className="shimmer" aria-hidden style={{ display: "block", height: 13, width: "86%", borderRadius: 7 }} />
            <span className="shimmer" aria-hidden style={{ display: "block", height: 13, width: "96%", borderRadius: 7 }} />
            <span className="shimmer" aria-hidden style={{ display: "block", height: 13, width: "64%", borderRadius: 7 }} />
          </motion.div>
        )}
      </AnimatePresence>

      {answered && fb && (
        <Rise>
          <div data-open-feedback data-verdict={feedback.verdict} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: "0.16em", color: fb.tint }}>
              {fb.label}
            </span>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: fb.tint, opacity: 0.9, flexShrink: 0 }} />
              <p
                className="font-body"
                style={{
                  margin: 0,
                  fontSize: feedbackFs,
                  lineHeight: 1.4,
                  color: "var(--ink)",
                  textWrap: "pretty",
                  overflowWrap: "anywhere",
                  display: "-webkit-box",
                  WebkitLineClamp: 8,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {feedback.feedback}
              </p>
            </div>
            {feedback.missed.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {feedback.missed.slice(0, 3).map((m, i) => (
                  <span
                    key={i}
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      padding: "4px 9px",
                      borderRadius: 999,
                      color: "var(--ink-2)",
                      border: "1px solid var(--line)",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    + {m}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Rise>
      )}

      {(shown || fellBack) && (
        <Rise>
          <div data-open-model style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: "0.16em", color: "var(--accent)" }}>
              one way to put it
            </span>
            <Glossed
              text={card.modelAnswer}
              terms={answerTerms}
              className="font-body"
              style={{ margin: 0, fontSize: fitFontSize(card.modelAnswer, [[180, 17], [Infinity, 16]]), lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
            />
          </div>
        </Rise>
      )}

      {idle && hasTerms(card.prompt, card.terms) && (
        <Rise>
          <GlossHint text={card.prompt} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}
