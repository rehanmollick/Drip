"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { GlossTerm } from "@/lib/schemas/cards";
import { useTheme } from "@/components/theme/ThemeRoot";
import { splitGlossed } from "./helpers";

/**
 * Inline glossary. Any card copy that carries `terms` renders through this:
 * the first whole-word occurrence of each term gets a dotted accent underline
 * and a tap opens a small chip with the one-line gloss. This is how a card
 * explains a word it had to use WITHOUT spending its word budget on a
 * definition — and how it stops assuming you already know.
 *
 * Placement: the chip is absolutely positioned under (or above, when there
 * isn't room) the tapped word, clamped inside the card so it can never push
 * layout or overflow the viewport. Dismiss: tap the word again, tap anywhere
 * else, or scroll.
 */
export function Glossed({
  text,
  terms,
  style,
  wrapStyle,
  className = "",
  as: Tag = "p",
}: {
  text: string;
  terms?: readonly GlossTerm[] | null;
  style?: CSSProperties;
  /** style for the positioned wrapper (the chip's containing block) */
  wrapStyle?: CSSProperties;
  className?: string;
  as?: "p" | "span" | "div" | "h1" | "h2" | "h3";
}) {
  const { spring, reduced } = useTheme();
  const segments = splitGlossed(text, terms ?? undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  const close = useCallback(() => {
    setOpen(null);
    setPos(null);
  }, []);

  // dismiss on tap-elsewhere / any scroll (the feed snaps under you — a stale chip is worse than none)
  useEffect(() => {
    if (open == null) return;
    const onDown = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && wrapRef.current?.contains(el)) return;
      close();
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("scroll", close, opts);
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [open, close]);

  const place = useCallback((btn: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const width = Math.min(268, Math.max(180, w.width));
    const rawLeft = b.left - w.left + b.width / 2 - width / 2;
    const left = Math.max(0, Math.min(rawLeft, w.width - width));
    // ~4 lines of gloss + padding; flip above the word when the bottom of the card is too close
    const estH = 96;
    const roomBelow = window.innerHeight - b.bottom - 96; // 96 ≈ ask-bar + safe area
    if (roomBelow < estH) setPos({ left, bottom: w.bottom - b.top + 8, width });
    else setPos({ left, top: b.bottom - w.top + 8, width });
  }, []);

  const toggle = useCallback(
    (i: number, el: HTMLElement) => {
      if (open === i) return close();
      place(el);
      setOpen(i);
    },
    [open, close, place],
  );

  const openSeg = open != null ? segments[open] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0, ...wrapStyle }}>
      <Tag className={className} style={style}>
        {segments.map((s, i) =>
          s.gloss ? (
            // a <span>, not a <button>: a real button is inline-block, so a two-word term would
            // become its own centred box mid-sentence instead of flowing with the copy
            <span
              key={i}
              role="button"
              tabIndex={0}
              data-gloss-term={s.term}
              aria-expanded={open === i}
              onClick={(e) => toggle(i, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(i, e.currentTarget);
                }
              }}
              style={{
                background: open === i ? "var(--accent-soft)" : "transparent",
                borderRadius: 4,
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textDecorationColor: "var(--accent)",
                textDecorationThickness: "1.5px",
                textUnderlineOffset: "0.22em",
                WebkitTapHighlightColor: "transparent",
                touchAction: "manipulation",
              }}
            >
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </Tag>
      <AnimatePresence>
        {openSeg?.gloss && pos && (
          <motion.span
            key={open}
            role="note"
            data-gloss-chip
            initial={{ opacity: 0, y: reduced ? 0 : pos.top != null ? -6 : 6, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.98, transition: { duration: 0.12 } }}
            transition={reduced ? { duration: 0.15 } : spring}
            className="font-body"
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
              zIndex: 5,
              display: "block",
              // opaque: --surface-2 is translucent, and a see-through chip over body copy is unreadable.
              // layering it on --bg keeps the theme's tint with none of the bleed-through.
              backgroundColor: "var(--bg)",
              backgroundImage: "linear-gradient(var(--surface-2), var(--surface-2))",
              border: "1px solid color-mix(in oklab, var(--accent) 30%, var(--line))",
              borderRadius: 12,
              padding: "9px 12px",
              fontSize: 13,
              lineHeight: 1.35,
              color: "var(--ink)",
              textAlign: "left",
              boxShadow: "0 12px 30px -12px rgba(0,0,0,0.5)",
            }}
          >
            <span className="font-mono uppercase" style={{ display: "block", fontSize: 9.5, letterSpacing: "0.16em", color: "var(--accent)", marginBottom: 3 }}>
              {openSeg.term}
            </span>
            {openSeg.gloss}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** True when `text` actually renders at least one underlined term (an unmatched term shows nothing). */
export function hasTerms(text: string, terms?: readonly GlossTerm[] | null): boolean {
  if (!terms || terms.length === 0) return false;
  return splitGlossed(text, terms).some((s) => !!s.gloss);
}

/** Tiny hint under glossed copy so the dotted underline reads as tappable. */
export function GlossHint({ text, terms }: { text: string; terms?: readonly GlossTerm[] | null }) {
  if (!hasTerms(text, terms)) return null;
  return (
    <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ width: 14, height: 0, borderBottom: "1.5px dotted var(--accent)", display: "inline-block" }} />
      tap the underlined bits
    </span>
  );
}
