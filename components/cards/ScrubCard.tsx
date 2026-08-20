"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrubCard as ScrubCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { drawIn, fadeIn } from "@/lib/motion";
import { fitFontSize, reserveHeight } from "./helpers";

/**
 * scrub — drag a moment across time and watch the meter move.
 *
 * The SHAPE of the levels across the frames IS the causality, and the reader
 * produces it with their thumb instead of reading a sentence about it. Nothing
 * here can be got wrong: the meter snaps to whole frames so they never land
 * between two captions, and the payoff is having felt the curve.
 */

// svg user units. the box is stretched to fit (preserveAspectRatio="none"), which rules out
// vector-effect="non-scaling-stroke": WebKit and a pathLength dasharray disagree under it and the
// line draws itself with holes in it. a 0.6-unit stroke lands at ~2px on both axes anyway.
const H = 40;
const PAD_Y = 3;
const CHART_PX = 118;
const KNOB = 28;

export function ScrubView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<ScrubCardT>) {
  const { spring, reduced } = useTheme();
  const n = card.frames.length;
  const prior = typeof interaction?.value === "number" ? clampInt(interaction.value, 0, n - 1) : 0;
  const [index, setIndex] = useState(prior);
  const trackRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const commitTimer = useRef<number | null>(null);
  const latest = useRef(index);
  latest.current = index;
  const lastSent = useRef<number | null>(null);

  useEffect(() => () => { if (commitTimer.current) window.clearTimeout(commitTimer.current); }, []);

  // release, not every step: a thumb sweeping 0→5 is one thought, not six
  const commit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      if (lastSent.current === latest.current) return;
      lastSent.current = latest.current;
      onInteract?.({ value: latest.current });
    }, 300);
  }, [onInteract]);

  const move = useCallback((to: number) => {
    setIndex((cur) => {
      const next = clampInt(to, 0, n - 1);
      if (next !== cur) ticks.tap();
      return next;
    });
  }, [n]);

  const fromClientX = useCallback((clientX: number) => {
    const el = railRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    move(Math.round(((clientX - r.left) / r.width) * (n - 1)));
  }, [move, n]);

  const frame = card.frames[index];
  const pct = index / Math.max(1, n - 1);
  const y = (i: number) => PAD_Y + (1 - clampInt(card.frames[i].level, 0, 100) / 100) * (H - PAD_Y * 2);
  const stepX = 100 / n;
  let line = `M 0 ${y(0).toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    line += ` L ${((i + 1) * stepX).toFixed(2)} ${y(i).toFixed(2)}`;
    if (i < n - 1) line += ` L ${((i + 1) * stepX).toFixed(2)} ${y(i + 1).toFixed(2)}`;
  }
  const area = `${line} L 100 ${H} L 0 ${H} Z`;

  const titleFs = fitFontSize(card.title, [[24, 34], [38, 30], [Infinity, 26]]);
  const captionFs = fitFontSize(longest(card.frames.map((f) => f.caption)), [[70, 18], [Infinity, 17]]);
  const captionBox = reserveHeight(longest(card.frames.map((f) => f.caption)), captionFs, 36);
  const labelFs = fitFontSize(longest(card.frames.map((f) => f.label)), [[10, 15], [16, 14], [Infinity, 12.5]]);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={16}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "drag it"}</Eyebrow>
      </Rise>

      <Rise>
        <h2 style={headlineStyle(titleFs, 1.08)}>{card.title}</h2>
      </Rise>

      <Rise style={{ position: "relative", height: CHART_PX }}>
        <svg
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          style={{ display: "block", width: "100%", height: "100%" }}
        >
          <motion.path d={area} fill="var(--accent-soft)" variants={fadeIn(spring, reduced)} />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={0.6}
            strokeLinejoin="round"
            variants={drawIn(spring, reduced, { duration: 420, delay: 60 })}
          />
          <line x1={0} y1={H} x2={100} y2={H} stroke="var(--line)" strokeWidth={0.4} />
        </svg>
        {/* the lit column rides ON TOP of the svg as HTML: framer turns an SVG x/y into a pixel
            translate, which under preserveAspectRatio="none" lands nowhere near the step it means */}
        <motion.span
          aria-hidden
          style={{ position: "absolute", background: "var(--accent)", opacity: 0.3 }}
          animate={{
            left: `${index * stepX}%`,
            width: `${stepX}%`,
            top: `${(y(index) / H) * 100}%`,
            height: `${((H - y(index)) / H) * 100}%`,
          }}
          transition={reduced ? { duration: 0.12 } : spring}
          initial={false}
        />
      </Rise>

      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            {/* both are capped short, but at their maximums they used to collide and wrap raggedly
                into each other. the frame label is the one that changes as you scrub, so it keeps
                its whole self and the standing label gives way. */}
            <span
              className="font-body"
              style={{ fontSize: 14, color: "var(--ink-2)", flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {card.meterLabel}
            </span>
            <span
              className="font-mono"
              data-scrub-frame
              style={{ fontSize: labelFs, color: "var(--accent)", textAlign: "right", flex: "0 0 auto", whiteSpace: "nowrap" }}
            >
              {frame.label}
            </span>
          </div>
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label={card.meterLabel}
            aria-valuemin={0}
            aria-valuemax={n - 1}
            aria-valuenow={index}
            aria-valuetext={frame.label}
            data-scrub-track
            onPointerDown={(e) => {
              e.stopPropagation();          // CardFrame's 480ms long-press must not fire mid-drag
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              fromClientX(e.clientX);
            }}
            onPointerMove={(e) => { if (dragging.current) fromClientX(e.clientX); }}
            onPointerUp={() => { dragging.current = false; commit(); }}
            onPointerCancel={() => { dragging.current = false; commit(); }}
            onKeyDown={(e) => {
              const to =
                e.key === "ArrowLeft" || e.key === "ArrowDown" ? index - 1
                : e.key === "ArrowRight" || e.key === "ArrowUp" ? index + 1
                : e.key === "Home" ? 0
                : e.key === "End" ? n - 1
                : null;
              if (to == null) return;
              e.preventDefault();
              move(to);
              commit();
            }}
            style={{
              position: "relative",
              height: 44,
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              touchAction: "pan-y",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* the rail is inset by the knob's radius so the knob can never hang past the copy column */}
            <div ref={railRef} style={{ position: "absolute", left: KNOB / 2, right: KNOB / 2, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
              <span aria-hidden style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 999, background: "var(--surface)", border: "1px solid var(--line)", boxSizing: "border-box" }} />
              <motion.span
                aria-hidden
                style={{ position: "absolute", left: 0, height: 6, borderRadius: 999, background: "var(--accent)" }}
                animate={{ width: `${pct * 100}%` }}
                transition={reduced ? { duration: 0.12 } : spring}
                initial={false}
              />
              {card.frames.map((_, i) => (
                <span
                  key={i}
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: `${(i / Math.max(1, n - 1)) * 100}%`,
                    width: 6,
                    height: 6,
                    marginLeft: -3,
                    borderRadius: 999,
                    background: i <= index ? "var(--accent)" : "var(--line)",
                    transition: "background-color 160ms ease",
                  }}
                />
              ))}
              <motion.span
                aria-hidden
                style={{
                  position: "absolute",
                  width: KNOB,
                  height: KNOB,
                  marginLeft: -KNOB / 2,
                  borderRadius: 999,
                  background: "var(--accent)",
                  border: "3px solid var(--bg)",
                  boxShadow: "0 0 0 1.5px var(--accent)",
                }}
                animate={{ left: `${pct * 100}%` }}
                transition={reduced ? { duration: 0.12 } : spring}
                initial={false}
              />
            </div>
          </div>
        </div>
      </Rise>

      {/* reserved slot: the longest caption already has its room, so a drag never shifts the chart */}
      <Rise style={{ minHeight: captionBox }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.16, ease: "easeOut" }}
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: "var(--accent)", opacity: 0.85, flexShrink: 0 }} />
            <Glossed
              text={frame.caption}
              terms={card.terms}
              wrapStyle={{ flex: "1 1 auto" }}
              className="font-body"
              style={{ margin: 0, fontSize: captionFs, lineHeight: 1.4, color: "var(--ink)", textWrap: "pretty", overflowWrap: "anywhere" }}
            />
          </motion.div>
        </AnimatePresence>
      </Rise>

      {card.insight && (
        <Rise>
          <p className="font-body" style={{ margin: 0, fontSize: 15, lineHeight: 1.4, color: "var(--ink-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>
            {card.insight}
          </p>
        </Rise>
      )}

      {hasTerms(frame.caption, card.terms) && (
        <Rise>
          <GlossHint text={frame.caption} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}

function clampInt(v: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Math.round(v) : lo;
  return Math.min(hi, Math.max(lo, n));
}

function longest(xs: readonly string[]): string {
  return xs.reduce((a, b) => (b.length > a.length ? b : a), "");
}
