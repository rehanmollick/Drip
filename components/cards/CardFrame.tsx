"use client";
import { motion, type Variants } from "framer-motion";
import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
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
  const container = useMemo(() => staggerContainer(reduced ? 40 : staggerMs || 60), [reduced, staggerMs]);
  const item = useMemo(() => riseIn(spring, reduced), [spring, reduced]);
  return { shown, container, item, animate: shown ? "show" : "hidden", spring, reduced } as const;
}

export function CardFrame({
  card,
  entered,
  onAskAbout,
  children,
  align = "center",
  gap = 18,
  className = "",
  style,
  contentStyle,
  footer,
}: {
  card: Card;
  entered: boolean;
  onAskAbout?: () => void;
  children: ReactNode;
  /** vertical anchoring of the content column */
  align?: "center" | "start" | "end";
  gap?: number;
  className?: string;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
  /** pinned to the bottom of the content area (dials, hints) — outside the stagger */
  footer?: ReactNode;
}) {
  const { shown, container, animate } = useEntry(entered);
  const ask = useCallback(() => onAskAbout?.(), [onAskAbout]);
  const press = useLongPress(ask, { ms: 480 });
  const inDetour = card.detourId != null;

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
      <motion.div
        variants={container}
        initial="hidden"
        animate={animate}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
          gap,
          ...contentStyle,
        }}
      >
        {children}
      </motion.div>
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

/** 🧒 simpler / 🎓 deeper ghosts (concept + diagram cards, spec §8). */
export function Dials({ onDial }: { onDial?: (dir: "simpler" | "deeper") => void }) {
  if (!onDial) return null;
  return (
    <div data-dials style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
      <GhostButton size="sm" onClick={() => onDial("simpler")} ariaLabel="simpler">
        <span aria-hidden>🧒</span> simpler
      </GhostButton>
      <GhostButton size="sm" onClick={() => onDial("deeper")} ariaLabel="deeper">
        <span aria-hidden>🎓</span> deeper
      </GhostButton>
    </div>
  );
}

/** Body copy style shared by concept/reveal/binary reveal etc. */
export const bodyStyle = (fs = 18): CSSProperties => ({
  fontFamily: "var(--font-body)",
  fontSize: fs,
  lineHeight: 1.4,
  color: "var(--ink)",
  margin: 0,
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
