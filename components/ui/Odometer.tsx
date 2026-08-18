"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { useMotionValue, useMotionValueEvent, useSpring, type SpringOptions } from "framer-motion";
import { countTo, fitFontSize } from "@/components/cards/helpers";
import { formatOutput, type OutputFormat } from "@/lib/expr";
import { useEnterOnce } from "@/lib/motion";

/**
 * The big number. Two modes, one look:
 *
 *  - `Odometer` follows a live number (the slider's output): it springs between
 *    values as the reader drags, formatted by lib/expr.
 *  - `LiteralOdometer` rolls up to a value the writer authored as a string
 *    ("1.2M", "$0.02", "80%") and lands on that string EXACTLY — a stat card
 *    that counted up to "1.2 M" or "1200000" would be quoting the writer wrong.
 *
 * A value that can't be counted honestly (an approximation, a range) is painted
 * at once. Never a stuck 0, never a mangled string.
 */

const COUNT: SpringOptions = { stiffness: 260, damping: 30, mass: 0.6 };
const SNAP: SpringOptions = { stiffness: 1000, damping: 100 };

/** The slider's ramp — a 42px floor keeps "1,000,000/s" on one line. */
const SLIDER_FIT = [[6, 60], [9, 52], [Infinity, 42]] as const;

type Fit = ReadonlyArray<readonly [number, number]>;

/** data-* the card views hang their e2e hooks on (data-output, data-stat…). */
type DataProps = { [key: `data-${string}`]: string | undefined };

type Shell = {
  /** font sizes by text length; omit to inherit the caller's size */
  fit?: Fit;
  className?: string;
  style?: CSSProperties;
} & DataProps;

/** Live number that springs to `value` (or snaps under reduced motion). */
export function Odometer({
  value,
  format = "number",
  unit,
  reduced = false,
  fit = SLIDER_FIT,
  className = "",
  style,
  ...rest
}: {
  value: number;
  format?: OutputFormat;
  unit?: string;
  reduced?: boolean;
} & Shell) {
  const finite = Number.isFinite(value);
  const mv = useMotionValue(finite ? value : 0);
  const spring = useSpring(mv, reduced ? SNAP : COUNT);
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
    <Digits text={text} fit={fit} className={className} style={style} aria-live="polite" {...rest} />
  );
}

/** Authored value that rolls up from 0 and settles on the writer's own string. */
export function LiteralOdometer({
  value,
  entered = true,
  reduced = false,
  fit,
  className = "",
  style,
  ...rest
}: {
  value: string;
  /** false while the card is still off-screen: the roll waits for the reader */
  entered?: boolean;
  reduced?: boolean;
} & Shell) {
  const count = useMemo(() => countTo(value), [value]);
  const shown = useEnterOnce(entered);
  // a card the reader scrolls back to has already spent its motion — it renders landed
  const rolls = useRef(!!count && !reduced && !entered).current;
  const mv = useMotionValue(0);
  const spring = useSpring(mv, COUNT);
  const [text, setText] = useState(() => (rolls && count ? count.at(0) : value));

  useEffect(() => {
    if (!rolls || !count) { setText(value); return; }
    if (shown) mv.set(count.to);
  }, [rolls, count, shown, value, mv]);
  useMotionValueEvent(spring, "change", (n) => {
    if (rolls && count) setText(count.at(n));
  });

  return (
    <Digits
      text={text}
      fit={fit}
      fitText={value}
      className={className}
      style={style}
      label={value}
      {...rest}
    />
  );
}

function Digits({
  text,
  fitText,
  fit,
  label,
  className = "",
  style,
  ...rest
}: {
  text: string;
  /** what to measure for sizing, so the type doesn't resize mid-roll */
  fitText?: string;
  /** the authored value, handed to screen readers instead of the rolling digits */
  label?: string;
} & Shell &
  Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className" | "style">) {
  const fs = fit ? fitFontSize(fitText ?? text, fit) : undefined;
  return (
    <span
      className={`font-display ${className}`}
      style={{
        fontSize: fs,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        fontWeight: 700,
        color: "var(--accent)",
        fontVariantNumeric: "tabular-nums",
        overflowWrap: "anywhere",
        ...style,
      }}
      {...rest}
    >
      {label ? <span aria-hidden>{text}</span> : text}
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
