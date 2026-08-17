"use client";
import { motion, useMotionValue, useMotionValueEvent, useSpring } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SliderCard as SliderCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { useTheme } from "@/components/theme/ThemeRoot";
import { compile, formatOutput } from "@/lib/expr";
import { fitFontSize, fraction } from "./helpers";

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

/**
 * slider — a range input that live-drives a safe expression (lib/expr.ts).
 * Output is an animated number formatted per outputFormat; onInteract({value})
 * fires on release (debounced 300ms).
 */
export function SliderView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<SliderCardT>) {
  const { reduced } = useTheme();
  const initial = typeof interaction?.value === "number" ? interaction.value : card.defaultValue;
  const [value, setValue] = useState<number>(clamp(initial, card.min, card.max));
  const fn = useMemo(() => compile(card.expression), [card.expression]);
  const raw = fn ? safe(fn, value) : NaN;
  const commitTimer = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const [touched, setTouched] = useState(false);

  useEffect(() => () => { if (commitTimer.current) window.clearTimeout(commitTimer.current); }, []);

  const commit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => onInteract?.({ value: latest.current }), 300);
  }, [onInteract]);

  const fill = `${(fraction(value, card.min, card.max) * 100).toFixed(2)}%`;
  const promptFs = fitFontSize(card.prompt, [[50, 30], [90, 26], [Infinity, 23]]);
  const inputText = formatOutput(value, Number.isInteger(card.step) ? "int" : "number", card.unit);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={18}>
      <style dangerouslySetInnerHTML={{ __html: RANGE_CSS }} />
      <Rise>
        <Eyebrow>{card.eyebrow ?? "feel it"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span className="font-body" style={{ fontSize: 14, color: "var(--ink-2)" }}>{card.label}</span>
            <span className="font-mono" style={{ fontSize: 15, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{inputText}</span>
          </div>
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
          <AnimatedNumber value={raw} format={card.outputFormat} unit={card.outputUnit} reduced={reduced} />
          <span className="font-body" style={{ fontSize: 14, color: "var(--ink-2)" }}>{card.outputLabel}</span>
        </div>
      </Rise>
      {card.insight && (
        <Rise>
          <motion.p
            className="font-body"
            animate={{ opacity: touched ? 1 : 0.55 }}
            style={{ margin: 0, fontSize: 16, lineHeight: 1.4, color: "var(--ink)", borderLeft: "3px solid var(--accent)", paddingLeft: 12, textWrap: "pretty" }}
          >
            {card.insight}
          </motion.p>
        </Rise>
      )}
    </CardFrame>
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

/** Big display number that springs between values (or snaps under reduced motion). */
function AnimatedNumber({ value, format, unit, reduced }: { value: number; format: SliderCardT["outputFormat"]; unit?: string; reduced: boolean }) {
  const finite = Number.isFinite(value);
  const mv = useMotionValue(finite ? value : 0);
  const spring = useSpring(mv, reduced ? { stiffness: 1000, damping: 100 } : { stiffness: 260, damping: 30, mass: 0.6 });
  const [text, setText] = useState(() => formatOutput(value, format, unit));
  useEffect(() => {
    if (finite) mv.set(value);
  }, [value, finite, mv]);
  useMotionValueEvent(spring, "change", (v) => {
    if (finite) setText(formatOutput(v, format, unit));
  });
  useEffect(() => {
    if (!finite) setText("—");
    else if (reduced) setText(formatOutput(value, format, unit));
  }, [finite, reduced, value, format, unit]);
  return (
    <span
      className="font-display"
      data-output
      aria-live="polite"
      style={{ fontSize: fitFontSize(text, [[6, 60], [9, 52], [Infinity, 42]]), lineHeight: 1, letterSpacing: "-0.03em", fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}
    >
      {text}
    </span>
  );
}
