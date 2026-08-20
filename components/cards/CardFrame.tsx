"use client";
import { motion, type Variants } from "framer-motion";
import { useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { Card } from "@/lib/schemas/cards";
import { useTheme } from "@/components/theme/ThemeRoot";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { riseIn, staggerContainer, useEnterOnce } from "@/lib/motion";
import { GhostButton } from "@/components/ui/GhostButton";

/**
 * Shared full-viewport layout for every card view. Owns:
 *  - safe-area padding (top: max(safe,20)+16; bottom: max(safe,16)+80 for the ask bar)
 *  - the ONE-time entry stagger (variants container; children use <Rise/>)
 *  - long-press anywhere → onAskAbout (taps/drags untouched)
 *  - the detour left-border tag when card.detourId is set
 */

/** Padding values shared with views that need to position things absolutely. */
export const FRAME_PAD_TOP = "calc(max(env(safe-area-inset-top, 0px), 20px) + 16px)";
export const FRAME_PAD_BOTTOM = "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 80px)";
export const FRAME_PAD_X = 24;

export function useEntry(entered: boolean) {
  const { spring, reduced, staggerMs } = useTheme();
  const shown = useEnterOnce(entered);
  // A card that had already entered when this view mounted (the feed windows views in and out
  // around the active slide) renders straight in its final state: elements animate ONCE per card,
  // never again on a remount / scroll-back (spec §5).
  const initial = useRef<"hidden" | false>(entered ? false : "hidden").current;
  const container = useMemo(() => staggerContainer(reduced ? 40 : staggerMs || 60), [reduced, staggerMs]);
  const item = useMemo(() => riseIn(spring, reduced), [spring, reduced]);
  return { shown, container, item, initial, animate: shown ? "show" : "hidden", spring, reduced } as const;
}

export type FrameAlign = "start" | "center" | "end" | "upper" | "mech";

/**
 * Where a card's content column sits on the screen, decided ONCE here instead
 * of twelve times in the views. Ratios are [space-above, space-below] — flex
 * spacers that collapse to zero when the content needs the whole screen, so a
 * schema-max card can never overflow because of its anchoring.
 */
const ALIGN_RATIO: Record<FrameAlign, [number, number]> = {
  start: [0, 1],      // fills: the diagram takes whatever height is left
  upper: [1, 1.9],    // big display type keeps its headroom below (hooks)
  center: [1, 1.2],   // optical center: a touch above the geometric middle
  mech: [1.2, 1],     // the mechanism sits at true center; its reserved payoff slot below borrows from the dead bottom
  end: [1, 0],
};

/**
 * Per-type anchoring: hooks stay upper-third, cards whose interaction reserves
 * a payoff slot below the mechanism ride slightly lower so the mechanism —
 * not the mechanism-plus-empty-slot — reads centered. Everything else sits at
 * optical center.
 */
const ALIGN_BY_TYPE: Partial<Record<Card["type"], FrameAlign>> = {
  hook: "upper",
  diagram: "start",
  binary: "mech",
  predict: "mech",
  sequence: "mech",
  spot: "mech",
  clarify: "mech",
  open: "mech",
};

export function CardFrame({
  card,
  entered,
  onAskAbout,
  children,
  align,
  gap = 16,
  className = "",
  style,
  contentStyle,
  footer,
}: {
  card: Card;
  entered: boolean;
  onAskAbout?: () => void;
  children: ReactNode;
  /** vertical anchoring override; leave unset to use the per-type map */
  align?: FrameAlign;
  gap?: number;
  className?: string;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
  /** pinned to the bottom of the content area (dials, hints) — outside the stagger */
  footer?: ReactNode;
}) {
  const { shown, container, animate, initial } = useEntry(entered);
  const ask = useCallback(() => onAskAbout?.(), [onAskAbout]);
  const press = useLongPress(ask, { ms: 480 });
  const inDetour = card.detourId != null;
  const anchoring = align ?? ALIGN_BY_TYPE[card.type] ?? "center";
  const [above, below] = ALIGN_RATIO[anchoring];
  const fills = anchoring === "start"; // the content column takes the leftover height itself

  return (
    <div
      {...press}
      className={`no-select ${className}`}
      data-card-type={card.type}
      data-entered={shown ? "true" : "false"}
      style={{
        position: "relative",
        flex: "1 1 auto",
        minHeight: 0,
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        paddingTop: FRAME_PAD_TOP,
        paddingBottom: FRAME_PAD_BOTTOM,
        paddingLeft: FRAME_PAD_X + (inDetour ? 10 : 0),
        paddingRight: FRAME_PAD_X,
        color: "var(--ink)",
        WebkitTouchCallout: "none",
        overflow: "hidden",
        ...style,
      }}
    >
      {inDetour && (
        <span
          aria-hidden
          data-detour-tag
          style={{
            position: "absolute",
            left: 12,
            top: FRAME_PAD_TOP,
            bottom: FRAME_PAD_BOTTOM,
            width: 2,
            borderRadius: 2,
            background: "var(--accent)",
            opacity: 0.75,
          }}
        />
      )}
      {above > 0 && <span aria-hidden style={{ flex: `${above} 1 0px`, minHeight: 0 }} />}
      <motion.div
        variants={container}
        initial={initial}
        animate={animate}
        style={{
          flex: fills ? "1 1 auto" : "0 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap,
          ...contentStyle,
        }}
      >
        {children}
      </motion.div>
      {below > 0 && <span aria-hidden style={{ flex: `${below} 1 0px`, minHeight: 0 }} />}
      {footer && <div style={{ flex: "0 0 auto", paddingTop: 12 }}>{footer}</div>}
    </div>
  );
}

/** A staggered child: rises 14px + fades with the theme spring (150ms fade under reduced motion). */
export function Rise({
  children,
  className,
  style,
  variants,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  variants?: Variants;
}) {
  const { spring, reduced } = useTheme();
  const v = useMemo(() => variants ?? riseIn(spring, reduced), [variants, spring, reduced]);
  return (
    <motion.div variants={v} className={className} style={style}>
      {children}
    </motion.div>
  );
}

/**
 * simpler / deeper dial chips (concept + diagram cards, spec §8). Typographic,
 * in the theme's mono label face — an emoji here reads as placeholder, and a
 * grad cap is school iconography. Press feedback is the accent border lighting
 * up plus the usual 0.97 spring.
 */
const DIAL_CSS = `.drip-dial:active{border-color:var(--accent);color:var(--accent)}`;

export function Dials({ onDial }: { onDial?: (dir: "simpler" | "deeper") => void }) {
  if (!onDial) return null;
  return (
    <div data-dials style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
      <style dangerouslySetInnerHTML={{ __html: DIAL_CSS }} />
      <DialChip dir="simpler" glyph="−" onDial={onDial} />
      <DialChip dir="deeper" glyph="+" onDial={onDial} />
    </div>
  );
}

function DialChip({ dir, glyph, onDial }: { dir: "simpler" | "deeper"; glyph: string; onDial: (dir: "simpler" | "deeper") => void }) {
  return (
    <GhostButton
      size="sm"
      onClick={() => onDial(dir)}
      ariaLabel={dir}
      className="font-mono drip-dial"
      style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.1em", padding: "8px 16px", transition: "border-color 160ms ease, color 160ms ease" }}
    >
      <span aria-hidden style={{ color: "var(--accent)", fontWeight: 600 }}>{glyph}</span> {dir}
    </GhostButton>
  );
}

/**
 * The prose measure: ~36ch keeps 30–40 characters per line in ANY theme font,
 * where a px cap drifts wide in a narrow face and cramped in a round one.
 */
export const PROSE_MEASURE = "36ch";

/** Body copy style shared by concept/reveal/binary reveal etc. */
export const bodyStyle = (fs = 18): CSSProperties => ({
  fontFamily: "var(--font-body)",
  fontSize: fs,
  lineHeight: 1.4,
  color: "var(--ink)",
  margin: 0,
  maxWidth: PROSE_MEASURE,
  textWrap: "pretty",
  overflowWrap: "anywhere",
});

export const headlineStyle = (fs: number | string, lh = 1.02): CSSProperties => ({
  fontFamily: "var(--font-display)",
  fontSize: fs,
  lineHeight: lh,
  letterSpacing: "-0.02em",
  fontWeight: 700,
  color: "var(--ink)",
  margin: 0,
  textWrap: "balance",
  overflowWrap: "anywhere",
});
