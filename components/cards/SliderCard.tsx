"use client";
import { motion, type Transition } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SliderCard as SliderCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Glossed, GlossHint, hasTerms } from "./Glossed";
import { Odometer } from "@/components/ui/Odometer";
import { useTheme } from "@/components/theme/ThemeRoot";
import { compile, formatOutput, sampleCurve } from "@/lib/expr";
import { drawIn } from "@/lib/motion";
import { estimateLines, fitFontSize, fraction } from "./helpers";

const RANGE_CSS = `
.drip-range{-webkit-appearance:none;appearance:none;width:100%;height:44px;background:transparent;margin:0;cursor:pointer;touch-action:pan-y;}
.drip-range:focus{outline:none}
.drip-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--accent) 0 var(--fill,0%),var(--surface-2) var(--fill,0%) 100%);}
.drip-range::-moz-range-track{height:6px;border-radius:999px;background:var(--surface-2);}
.drip-range::-moz-range-progress{height:6px;border-radius:999px;background:var(--accent);}
.drip-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;margin-top:-11px;border-radius:999px;background:var(--accent);border:3px solid var(--bg);box-shadow:0 0 0 1.5px var(--accent),0 6px 16px -6px rgba(0,0,0,.5);transition:transform 120ms ease;}
.drip-range::-moz-range-thumb{width:28px;height:28px;border-radius:999px;background:var(--accent);border:3px solid var(--bg);box-shadow:0 0 0 1.5px var(--accent);}
.drip-range:active::-webkit-slider-thumb{transform:scale(1.12)}
`;

/** The curve's drawing box, in px and in svg user units at once (1:1 in y). */
const CURVE_H = 40;
const CURVE_PAD = 4;

/**
 * slider — a range input that live-drives a safe expression (lib/expr.ts).
 * Above the track, the whole expression is drawn as a curve with the reader's
 * position marked on it: dragging then reads as walking along a shape instead
 * of watching a number twitch. The curve is dropped when the prompt is long
 * enough to need the room. Output is an <Odometer>; onInteract({value}) fires
 * on release (debounced 300ms).
 */
export function SliderView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<SliderCardT>) {
  const { reduced, spring } = useTheme();
  const initial = typeof interaction?.value === "number" ? interaction.value : card.defaultValue;
  const [value, setValue] = useState<number>(clamp(initial, card.min, card.max));
  const fn = useMemo(() => compile(card.expression), [card.expression]);
  const raw = fn ? safe(fn, value) : NaN;
  const commitTimer = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const lastSent = useRef<number | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => () => { if (commitTimer.current) window.clearTimeout(commitTimer.current); }, []);

  const commit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      if (lastSent.current === latest.current) return; // blur after pointerup: nothing new to say
      lastSent.current = latest.current;
      onInteract?.({ value: latest.current });
    }, 300);
  }, [onInteract]);

  const at = fraction(value, card.min, card.max);
  const fill = `${(at * 100).toFixed(2)}%`;
  const promptFs = fitFontSize(card.prompt, [[50, 30], [90, 26], [Infinity, 23]]);
  const inputText = formatOutput(value, Number.isInteger(card.step) ? "int" : "number", card.unit);
  // a long prompt already owns the top of the card; the curve doesn't get to fight it for room
  const showCurve = estimateLines(card.prompt, 34) <= 2;

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={16}>
      <style dangerouslySetInnerHTML={{ __html: RANGE_CSS }} />
      <Rise>
        <Eyebrow>{card.eyebrow ?? "feel it"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span className="font-body" style={{ fontSize: 14, color: "var(--ink-2)" }}>{card.label}</span>
            <span className="font-mono" style={{ fontSize: 15, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{inputText}</span>
          </div>
          {showCurve && <Curve card={card} at={at} reduced={reduced} spring={spring} />}
          <input
            type="range"
            className="drip-range"
            aria-label={card.label}
            min={card.min}
            max={card.max}
            step={card.step}
            value={value}
            style={{ "--fill": fill } as React.CSSProperties}
            onChange={(e) => { setValue(Number(e.target.value)); setTouched(true); }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={commit}
            onTouchEnd={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <div className="font-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-2)", letterSpacing: "0.08em" }}>
            <span>{formatOutput(card.min, Number.isInteger(card.step) ? "int" : "number", card.unit)}</span>
            <span>{formatOutput(card.max, Number.isInteger(card.step) ? "int" : "number", card.unit)}</span>
          </div>
        </div>
      </Rise>
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Odometer data-output="" value={raw} format={card.outputFormat} unit={card.outputUnit} reduced={reduced} />
          <span className="font-body" style={{ fontSize: 14, color: "var(--ink-2)" }}>{card.outputLabel}</span>
        </div>
      </Rise>
      {card.insight && (
        <Rise>
          {/* quiet until they've moved it: the line is a payoff for something they did */}
          <div style={{ opacity: touched ? 1 : 0.55, transition: "opacity 300ms ease" }}>
            <Glossed
              text={card.insight}
              terms={card.terms}
              cascade
              className="font-body"
              style={{ margin: 0, fontSize: 16, lineHeight: 1.4, color: "var(--ink)", borderLeft: "3px solid var(--accent)", paddingLeft: 12, textWrap: "pretty", overflowWrap: "anywhere" }}
            />
          </div>
        </Rise>
      )}
      {card.insight && hasTerms(card.insight, card.terms) && (
        <Rise>
          <GlossHint text={card.insight} terms={card.terms} />
        </Rise>
      )}
    </CardFrame>
  );
}

/**
 * The expression as a shape, with a dot where the reader is standing on it.
 * The line stretches horizontally (preserveAspectRatio: none) so it always
 * spans the track; the dot is a real DOM element so stretching can't turn it
 * into an ellipse.
 */
function Curve({ card, at, reduced, spring }: { card: SliderCardT; at: number; reduced: boolean; spring: Transition }) {
  const pts = useMemo(() => sampleCurve(card.expression, card.min, card.max, 40), [card.expression, card.min, card.max]);
  const line = useMemo(
    () => pts?.map((p) => `${(p.x * 100).toFixed(2)},${(CURVE_PAD + (1 - p.y) * (CURVE_H - CURVE_PAD * 2)).toFixed(2)}`).join(" "),
    [pts],
  );
  if (!pts || !line) return null;
  const here = pts[Math.round(at * (pts.length - 1))];
  const dotY = CURVE_PAD + (1 - here.y) * (CURVE_H - CURVE_PAD * 2);

  return (
    <div data-curve style={{ position: "relative", height: CURVE_H, marginBottom: 2 }}>
      <svg
        aria-hidden
        viewBox={`0 0 100 ${CURVE_H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        <motion.polygon
          points={`${line} 100,${CURVE_H} 0,${CURVE_H}`}
          fill="var(--accent)"
          variants={{ hidden: { opacity: 0 }, show: { opacity: 0.1, transition: { duration: reduced ? 0.15 : 0.5, delay: reduced ? 0 : 0.25 } } }}
        />
        {/* no vectorEffect: webkit computes pathLength dashes wrong under a stretched
            viewBox and draws the line in pieces. a shallow line stretched in x reads
            the same thickness anyway. */}
        <motion.polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          variants={drawIn(spring, reduced, { duration: 520, delay: 80 })}
        />
      </svg>
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: `${at * 100}%`,
          top: dotY,
          width: 9,
          height: 9,
          marginLeft: -4.5,
          marginTop: -4.5,
          borderRadius: 999,
          background: "var(--accent)",
          border: "2px solid var(--bg)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
}
function safe(fn: (x: number) => number, x: number) {
  try { return fn(x); } catch { return NaN; }
}
