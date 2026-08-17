"use client";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DiagramCard } from "@/lib/schemas/cards";
import { useTheme } from "@/components/theme/ThemeRoot";
import {
  ARROW_LEN,
  EDGE_LABEL_PX,
  LABEL_LINE_H,
  NODE_PAD_X,
  NODE_PAD_Y,
  NODE_RADIUS,
  SUB_LINE_H,
  SUB_PX,
  layoutDiagram,
  metricsForFonts,
  type Box,
  type Decor,
  type LayoutEdge,
  type LayoutNode,
} from "./layout";

/**
 * DiagramRenderer — themed, animated rendering of a DiagramCard.
 *
 * Structure: an SVG layer (edges, arrowheads, spine/divider/dots) under a
 * layer of absolutely-positioned HTML nodes (real text wrapping + clamping,
 * proper tap targets, springy press feedback) and floating tap-note chips.
 * Layout is pure (layout.ts) and computed in px from the measured container,
 * so it never overflows and looks right from ~300px up.
 *
 * Motion: nodes stagger in ONCE when `entered` first becomes true (60ms,
 * theme spring), edges draw pathLength 0->1 after the nodes land, arrowheads
 * and labels fade in as their edge finishes. Reduced motion: fades only.
 * Everything visual comes from theme CSS variables — no hardcoded colors/fonts.
 */
export type DiagramRendererProps = {
  card: DiagramCard;
  /** first true → play the entry animation once; later toggles never replay */
  entered: boolean;
  className?: string;
  style?: CSSProperties;
  onNodeTap?: (id: string) => void;
};

const FALLBACK: Box = { w: 345, h: 460 };
const REDUCED_FADE: Transition = { duration: 0.15, ease: "easeOut" };

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): Box | null {
  const [size, setSize] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Latch: true from the first time `entered` is true, forever after. */
function usePlayOnce(entered: boolean): boolean {
  const played = useRef(entered);
  const [play, setPlay] = useState(entered);
  useEffect(() => {
    if (entered && !played.current) {
      played.current = true;
      setPlay(true);
    }
  }, [entered]);
  return play;
}

export function DiagramRenderer({ card, entered, className, style, onNodeTap }: DiagramRendererProps) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useContainerSize(ref);
  const box = measured ?? FALLBACK;
  const { theme, spring, reduced, staggerMs } = useTheme();
  const play = usePlayOnce(entered);
  const [openId, setOpenId] = useState<string | null>(null);

  const metrics = useMemo(() => metricsForFonts(theme.display, theme.body), [theme.display, theme.body]);
  const layout = useMemo(() => layoutDiagram(card, box, metrics), [card, box, metrics]);
  const notes = useMemo(() => card.tapNotes ?? {}, [card.tapNotes]);

  // timings (seconds)
  const stagger = (reduced ? 40 : staggerMs || 60) / 1000;
  const nodeCount = layout.nodes.length;
  const nodesDone = nodeCount * stagger + (reduced ? 0.1 : 0.22);
  const edgeDur = reduced ? 0.15 : 0.45;
  const edgeStep = reduced ? 0.03 : 0.08;
  const nodeTransition = (i: number): Transition => (reduced ? { ...REDUCED_FADE, delay: i * stagger } : { ...spring, delay: i * stagger });

  // dismiss the note on any tap outside a node (anywhere on the page) or Escape
  useEffect(() => {
    if (!openId) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Element | null;
      if (t && ref.current?.contains(t) && t.closest("[data-node-id]")) return; // node taps toggle themselves
      setOpenId(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);
  const toggle = useCallback(
    (id: string) => {
      onNodeTap?.(id);
      if (notes[id]) setOpenId((cur) => (cur === id ? null : id));
    },
    [notes, onNodeTap],
  );

  const openNode = openId ? layout.nodes.find((n) => n.id === openId) : undefined;
  const openNote = openId ? notes[openId] : undefined;

  return (
    <div
      ref={ref}
      className={className}
      data-diagram={card.variant}
      data-played={play ? "true" : "false"}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        // nothing is tappable while the diagram is still hidden (pre-entry)
        pointerEvents: play ? undefined : "none",
        ...style,
      }}
    >
      {measured && (
        <>
          <svg
            width={box.w}
            height={box.h}
            viewBox={`0 0 ${box.w} ${box.h}`}
            aria-hidden
            style={{ position: "absolute", inset: 0, display: "block", overflow: "visible", pointerEvents: "none" }}
          >
            {layout.decor.map((d) => (
              <DecorEl key={d.key} d={d} play={play} reduced={reduced} stagger={stagger} nodesDone={nodesDone} spring={spring} />
            ))}
            {layout.edges.map((e, i) => (
              <EdgeEl key={e.key} e={e} play={play} reduced={reduced} delay={nodesDone + i * edgeStep} dur={edgeDur} />
            ))}
          </svg>

          {layout.edges.map((e, i) =>
            e.label ? (
              <EdgeLabel key={`${e.key}-label`} e={e} play={play} reduced={reduced} delay={nodesDone + i * edgeStep + edgeDur * 0.5} />
            ) : null,
          )}

          {layout.nodes.map((n) => (
            <NodeEl
              key={n.id}
              n={n}
              play={play}
              reduced={reduced}
              transition={nodeTransition(n.order)}
              hasNote={!!notes[n.id]}
              tappable={!!notes[n.id] || !!onNodeTap}
              open={openId === n.id}
              onTap={toggle}
            />
          ))}

          <AnimatePresence>
            {openNode && openNote && (
              <NoteChip key={openNode.id} node={openNode} note={openNote} box={box} reduced={reduced} spring={spring} />
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/* ------------------------------ nodes ------------------------------ */

function NodeEl({
  n,
  play,
  reduced,
  transition,
  hasNote,
  tappable,
  open,
  onTap,
}: {
  n: LayoutNode;
  play: boolean;
  reduced: boolean;
  transition: Transition;
  hasNote: boolean;
  tappable: boolean;
  open: boolean;
  onTap: (id: string) => void;
}) {
  const hidden = { opacity: 0, y: reduced ? 0 : 10, scale: reduced ? 1 : 0.96 };
  const shown = { opacity: 1, y: 0, scale: 1 };
  const row = n.textLayout === "row";
  // clamp to what physically fits (the layout's line estimate is a heuristic; CSS does the real wrapping)
  const avail = n.h - 2 * NODE_PAD_Y;
  const subLines = row ? 1 : n.subLines.length;
  const labelClamp = row
    ? 1
    : Math.max(1, Math.min(2, Math.floor((avail - (subLines ? 4 + subLines * SUB_LINE_H : 0)) / LABEL_LINE_H)));
  const label = (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: n.fontSize,
        lineHeight: `${LABEL_LINE_H}px`,
        letterSpacing: "-0.01em",
        color: "var(--ink)",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: labelClamp,
        overflow: "hidden",
        overflowWrap: "anywhere",
        textAlign: row ? "left" : "center",
        textWrap: "balance",
      } as CSSProperties}
    >
      {n.label}
    </span>
  );
  const sub = n.subLines.length > 0 && (
    <span
      style={{
        fontFamily: "var(--font-body)",
        fontSize: SUB_PX,
        lineHeight: `${SUB_LINE_H}px`,
        color: "var(--ink-2)",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: Math.max(1, Math.min(2, n.subLines.length)),
        overflow: "hidden",
        overflowWrap: "anywhere",
        textAlign: row ? "right" : "center",
        flexShrink: row ? 1 : undefined,
      } as CSSProperties}
    >
      {n.sub}
    </span>
  );
  return (
    <motion.div
      role={tappable ? "button" : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-label={hasNote ? `${n.label} — more` : undefined}
      aria-expanded={hasNote ? open : undefined}
      data-node-id={n.id}
      data-emphasis={n.emphasis ? "true" : undefined}
      data-note={hasNote ? "true" : undefined}
      initial={hidden}
      animate={play ? shown : hidden}
      transition={transition}
      whileTap={tappable && !reduced ? { scale: 0.97 } : undefined}
      onClick={tappable ? () => onTap(n.id) : undefined}
      onKeyDown={
        tappable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTap(n.id);
              }
            }
          : undefined
      }
      style={{
        position: "absolute",
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        boxSizing: "border-box",
        borderRadius: NODE_RADIUS,
        background: n.emphasis ? "var(--accent-soft)" : "var(--surface)",
        border: `1px solid ${n.emphasis ? "var(--accent)" : "var(--line)"}`,
        display: "flex",
        flexDirection: row ? "row" : "column",
        alignItems: "center",
        justifyContent: row ? "space-between" : "center",
        gap: row ? 12 : 3,
        padding: `0 ${NODE_PAD_X}px`,
        cursor: tappable ? "pointer" : "default",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        outline: "none",
        transformOrigin: "50% 50%",
      }}
    >
      {label}
      {sub}
      {hasNote && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "var(--accent)",
            boxShadow: "0 0 0 3px var(--accent-soft)",
            opacity: open ? 0 : 1,
            transition: "opacity 150ms",
          }}
        />
      )}
    </motion.div>
  );
}

/* ------------------------------ edges ------------------------------ */

function EdgeEl({ e, play, reduced, delay, dur }: { e: LayoutEdge; play: boolean; reduced: boolean; delay: number; dur: number }) {
  if (!e.d) return null;
  const line = reduced
    ? { initial: { opacity: 0 }, animate: play ? { opacity: 1 } : { opacity: 0 }, transition: { ...REDUCED_FADE, delay } }
    : {
        initial: { pathLength: 0, opacity: 0 },
        animate: play ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 },
        transition: { pathLength: { delay, duration: dur, ease: "easeInOut" as const }, opacity: { delay, duration: 0.01 } },
      };
  return (
    <g data-edge={`${e.from}->${e.to}`}>
      <motion.path
        d={e.d}
        fill="none"
        stroke="var(--ink-2)"
        strokeOpacity={0.6}
        strokeWidth={1.5}
        strokeLinecap="round"
        {...line}
      />
      {e.arrow && (
        <motion.path
          d={`M0 0L${-ARROW_LEN} ${-ARROW_LEN * 0.55}L${-ARROW_LEN * 0.72} 0L${-ARROW_LEN} ${ARROW_LEN * 0.55}Z`}
          transform={`translate(${e.arrow.x} ${e.arrow.y}) rotate(${e.arrow.angle})`}
          fill="var(--ink-2)"
          fillOpacity={0.85}
          initial={{ opacity: 0 }}
          animate={play ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.2, delay: delay + (reduced ? 0 : dur * 0.85) }}
        />
      )}
    </g>
  );
}

function EdgeLabel({ e, play, reduced, delay }: { e: LayoutEdge; play: boolean; reduced: boolean; delay: number }) {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0 }}
      animate={play ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.25, delay }}
      style={{
        position: "absolute",
        left: e.labelAt.x,
        top: e.labelAt.y,
        transform: `translate(-50%, -50%) rotate(${e.labelRotate}deg)`,
        transformOrigin: "50% 50%",
        fontFamily: "var(--font-mono)",
        fontSize: EDGE_LABEL_PX,
        lineHeight: "12px",
        letterSpacing: "0.02em",
        color: "var(--ink-2)",
        background: "var(--bg)",
        padding: "3px 6px",
        borderRadius: 5,
        whiteSpace: "nowrap",
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
      }}
    >
      {e.label}
    </motion.span>
  );
}

/* ------------------------------ decor ------------------------------ */

function DecorEl({
  d,
  play,
  reduced,
  stagger,
  nodesDone,
  spring,
}: {
  d: Decor;
  play: boolean;
  reduced: boolean;
  stagger: number;
  nodesDone: number;
  spring: Transition;
}) {
  if (d.kind === "dot") {
    const t: Transition = reduced ? { ...REDUCED_FADE, delay: d.order * stagger } : { ...spring, delay: d.order * stagger };
    return (
      <motion.circle
        cx={d.x}
        cy={d.y}
        r={d.r}
        fill={d.emphasis ? "var(--accent)" : "var(--bg)"}
        stroke={d.emphasis ? "var(--accent)" : "var(--ink-2)"}
        strokeWidth={1.5}
        initial={{ opacity: 0 }}
        animate={play ? { opacity: 1 } : { opacity: 0 }}
        transition={t}
      />
    );
  }
  const isPerNode = typeof d.order === "number";
  const delay = isPerNode ? d.order! * stagger : 0;
  const draw = reduced
    ? { initial: { opacity: 0 }, animate: play ? { opacity: 1 } : { opacity: 0 }, transition: { ...REDUCED_FADE, delay } }
    : isPerNode
      ? { initial: { opacity: 0 }, animate: play ? { opacity: 1 } : { opacity: 0 }, transition: { duration: 0.2, delay } }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: play ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 },
          transition: { pathLength: { duration: Math.max(0.3, nodesDone), ease: "linear" as const }, opacity: { duration: 0.01 } },
        };
  return (
    <motion.path
      d={d.d}
      fill="none"
      stroke={d.dashed ? "var(--line)" : "var(--ink-2)"}
      strokeOpacity={d.dashed ? 1 : 0.45}
      strokeWidth={d.dashed ? 1.5 : 1.25}
      strokeLinecap="round"
      strokeDasharray={d.dashed ? "2 6" : undefined}
      {...draw}
    />
  );
}

/* ------------------------------ tap-note chip ------------------------------ */

function NoteChip({ node, note, box, reduced, spring }: { node: LayoutNode; note: string; box: Box; reduced: boolean; spring: Transition }) {
  const width = Math.min(248, box.w - 8);
  const cx = node.x + node.w / 2;
  const left = Math.round(Math.max(4, Math.min(box.w - 4 - width, cx - width / 2)));
  const estLines = Math.max(1, Math.ceil((note.length * 6.6) / (width - 24)));
  const estH = estLines * 17 + 20;
  const below = node.y + node.h + 8 + estH <= box.h;
  const caretX = Math.round(Math.max(12, Math.min(width - 12, cx - left)));
  const pos: CSSProperties = below ? { top: node.y + node.h + 8 } : { bottom: box.h - node.y + 8 };
  return (
    <motion.div
      role="note"
      data-tap-note={node.id}
      initial={{ opacity: 0, y: reduced ? 0 : below ? -4 : 4, scale: reduced ? 1 : 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : below ? -2 : 2, scale: reduced ? 1 : 0.98, transition: { duration: 0.12 } }}
      transition={reduced ? REDUCED_FADE : spring}
      style={{
        position: "absolute",
        left,
        width,
        ...pos,
        zIndex: 3,
        boxSizing: "border-box",
        padding: "9px 12px 10px",
        borderRadius: 12,
        background: "var(--ink)",
        color: "var(--bg)",
        fontFamily: "var(--font-body)",
        fontSize: 12.5,
        lineHeight: "17px",
        letterSpacing: "0.005em",
        boxShadow: "0 8px 24px -8px color-mix(in oklab, var(--ink) 35%, transparent)",
        transformOrigin: below ? `${caretX}px 0%` : `${caretX}px 100%`,
        pointerEvents: "auto",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: caretX - 5,
          [below ? "top" : "bottom"]: -4,
          width: 10,
          height: 10,
          background: "var(--ink)",
          transform: "rotate(45deg)",
          borderRadius: 2,
        }}
      />
      {note}
    </motion.div>
  );
}
