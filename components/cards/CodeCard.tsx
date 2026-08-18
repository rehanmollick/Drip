"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useMemo, useState } from "react";
import type { CodeCard as CodeCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Chip } from "@/components/ui/Chip";
import { useTheme } from "@/components/theme/ThemeRoot";
import { codeFontSize } from "./helpers";
import { CASCADE_FADE_MS, cascadeStep, usePressable } from "@/lib/motion";

/**
 * Lines land top-to-bottom, fast enough to read as typing rather than as a queue —
 * squeezed by cascadeStep so even a 23-line block is fully assembled inside the
 * 400ms budget. A reader who flicks fast must never catch a card mid-write.
 */
const LINE_STEP_MS = 22;

/**
 * code — monospaced block (server-side shiki tokens when present, plain lines
 * otherwise). The block writes itself in line by line, which is the order you'd
 * read it anyway. Lines with annotations get an accent dot; tapping one toggles
 * a note chip under it and drops every other line back to 0.45 so the line
 * being talked about is the only one in focus. Long lines wrap; never
 * horizontal scroll.
 */
export function CodeView({ card, entered, onAskAbout }: CardViewProps<CodeCardT>) {
  const { spring, reduced } = useTheme();
  const pressable = usePressable();
  const lines = useMemo(() => card.code.replace(/\n$/, "").split("\n"), [card.code]);
  const notes = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of card.annotations) if (a.line >= 1 && a.line <= lines.length && !m.has(a.line)) m.set(a.line, a.note);
    return m;
  }, [card.annotations, lines.length]);
  const highlighted = card.highlighted && card.highlighted.length === lines.length ? card.highlighted : null;
  const fs = codeFontSize(card.code);
  const [open, setOpen] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const gutter = `${String(lines.length).length}ch`;
  const lineIn = useMemo(
    () => ({
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { duration: (reduced ? 150 : CASCADE_FADE_MS) / 1000, ease: "easeOut" as const } },
    }),
    [reduced],
  );

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={14}>
      <Rise>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {card.eyebrow && <Eyebrow>{card.eyebrow}</Eyebrow>}
            {card.title && <h2 style={{ ...headlineStyle(22, 1.1), fontWeight: 600 }}>{card.title}</h2>}
          </div>
          <span className="font-mono" style={{ fontSize: 11, color: "var(--ink-2)", letterSpacing: "0.08em", flexShrink: 0 }}>
            {card.lang}
          </span>
        </div>
      </Rise>
      <Rise>
        <motion.div
          className="font-mono"
          data-code-block
          variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : cascadeStep(LINE_STEP_MS, lines.length) / 1000 } } }}
          style={{
            fontSize: fs,
            lineHeight: 1.5,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "10px 12px 10px 8px",
            color: "var(--ink)",
            overflow: "hidden",
            maxWidth: "100%",
          }}
        >
          {lines.map((line, i) => {
            const n = i + 1;
            const note = notes.get(n);
            const isOpen = open === n;
            const toks = highlighted?.[i];
            return (
              <Fragment key={n}>
                <motion.div
                  role={note ? "button" : undefined}
                  tabIndex={note ? 0 : undefined}
                  aria-expanded={note ? isOpen : undefined}
                  onClick={note ? () => { setOpen(isOpen ? null : n); setTouched(true); } : undefined}
                  onKeyDown={note ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : n); setTouched(true); } } : undefined}
                  whileTap={note ? pressable.whileTap : undefined}
                  transition={pressable.transition}
                  data-annotated={note ? "true" : undefined}
                  variants={lineIn}
                  style={{
                    borderRadius: 6,
                    padding: "0 4px",
                    cursor: note ? "pointer" : "default",
                    background: isOpen ? "var(--accent-soft)" : "transparent",
                    transition: "background-color 160ms ease",
                    transformOrigin: "left center",
                  }}
                >
                  {/* the dim rides its own wrapper: the entry fade owns the row's opacity */}
                  <span
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      opacity: open != null && !isOpen ? 0.45 : 1,
                      transition: "opacity 200ms ease",
                    }}
                  >
                    <span aria-hidden style={{ width: gutter, textAlign: "right", color: "var(--ink-2)", opacity: 0.6, flexShrink: 0, userSelect: "none" }}>
                      {n}
                    </span>
                    <span aria-hidden style={{ width: 6, flexShrink: 0, display: "flex", alignItems: "center", height: `${fs * 1.5}px` }}>
                      {note && (
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: "var(--accent)",
                            boxShadow: isOpen ? "0 0 0 3px var(--accent-soft)" : "none",
                            transition: "box-shadow 160ms ease",
                          }}
                        />
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word", tabSize: 2 }}>
                      {toks
                        ? toks.map((t, k) => (
                            <span key={k} style={t.c ? { color: t.c } : undefined}>
                              {t.t}
                            </span>
                          ))
                        : line || " "}
                    </span>
                  </span>
                </motion.div>
                <AnimatePresence initial={false}>
                  {isOpen && note && (
                    <div style={{ padding: "4px 4px 6px", paddingLeft: `calc(${gutter} + 12px)` }}>
                      <Chip spring={spring} reduced={reduced} style={{ fontSize: Math.max(12.5, fs + 0.5) }}>
                        {note}
                      </Chip>
                    </div>
                  )}
                </AnimatePresence>
              </Fragment>
            );
          })}
        </motion.div>
      </Rise>
      {notes.size > 0 && (
        <Rise>
          <motion.span
            className="font-mono"
            animate={{ opacity: touched ? 0 : 1 }}
            style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} />
            tap a marked line
          </motion.span>
        </Rise>
      )}
    </CardFrame>
  );
}
