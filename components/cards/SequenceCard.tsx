"use client";
import { AnimatePresence, Reorder, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SequenceCard as SequenceCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, bodyStyle, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GhostButton } from "@/components/ui/GhostButton";
import { Shake } from "@/components/ui/Shake";
import { Confetti } from "@/components/ui/Confetti";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { fitFontSize, reserveHeight, sameOrder, shuffleDeterministic } from "./helpers";

/**
 * sequence — drag chips into order. Shuffled deterministically by card id at
 * mount (never the correct order). "lock it in" compares with card.items order:
 * correct → confetti; wrong → shake, misplaced chips tinted, then chips settle
 * into the right order. Both end with revealCopy. onInteract({choice: ids, correct}).
 */
export function SequenceView({ card, entered, interaction, onInteract, onAskAbout }: CardViewProps<SequenceCardT>) {
  const { spring, reduced } = useTheme();
  const correctIds = useMemo(() => card.items.map((i) => i.id), [card.items]);
  const byId = useMemo(() => new Map(card.items.map((i) => [i.id, i])), [card.items]);
  const priorOrder = useMemo(() => {
    const c = interaction?.choice;
    if (Array.isArray(c) && c.length === correctIds.length && c.every((id) => byId.has(id)) && new Set(c).size === c.length) return c as string[];
    return null;
  }, [interaction, correctIds.length, byId]);

  const [order, setOrder] = useState<string[]>(() => priorOrder ?? shuffleDeterministic(correctIds, card.id));
  const [locked, setLocked] = useState<{ order: string[]; correct: boolean } | null>(
    priorOrder ? { order: priorOrder, correct: sameOrder(priorOrder, correctIds) } : null,
  );
  const [live, setLive] = useState(false);
  const [burst, setBurst] = useState(0);
  const [shake, setShake] = useState(0);
  const settleTimer = useRef<number | null>(null);

  useEffect(() => () => { if (settleTimer.current) window.clearTimeout(settleTimer.current); }, []);

  const lock = useCallback(() => {
    if (locked) return;
    const correct = sameOrder(order, correctIds);
    setLocked({ order, correct });
    setLive(true);
    if (correct) {
      setBurst((b) => b + 1);
      ticks.correct();
    } else {
      setShake((s) => s + 1);
      // after the shake, let the chips settle into the right order — the fix is the teaching
      settleTimer.current = window.setTimeout(() => setOrder(correctIds), reduced ? 300 : 900);
    }
    onInteract?.({ choice: order, correct });
  }, [locked, order, correctIds, onInteract, reduced]);

  const promptFs = fitFontSize(card.prompt, [[50, 28], [90, 25], [Infinity, 22]]);
  const revealFs = fitFontSize(card.revealCopy, [[160, 17], [Infinity, 16]]);
  const chipH = card.items.length > 5 ? 44 : 50;

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} align="center" gap={14}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "put it in order"}</Eyebrow>
      </Rise>
      <Rise>
        <h2 style={headlineStyle(promptFs, 1.08)}>{card.prompt}</h2>
      </Rise>
      <Rise>
        <Shake trigger={shake}>
          <Reorder.Group
            axis="y"
            values={order}
            onReorder={locked ? () => {} : setOrder}
            as="ol"
            style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}
          >
            {order.map((id, pos) => {
              const item = byId.get(id);
              if (!item) return null;
              // a chip is "wrong" if the user locked it in at a position that isn't its correct one
              const wasWrongHere = locked && !locked.correct ? locked.order.indexOf(id) !== correctIds.indexOf(id) : false;
              return (
                <SequenceChip
                  key={id}
                  id={id}
                  label={item.label}
                  index={pos}
                  height={chipH}
                  locked={!!locked}
                  state={!locked ? "idle" : locked.correct ? "correct" : wasWrongHere ? "wrong" : "correct"}
                  reduced={reduced}
                />
              );
            })}
          </Reorder.Group>
        </Shake>
      </Rise>
      <div style={{ minHeight: Math.max(48, reserveHeight(card.revealCopy, revealFs, 42)) }}>
        <AnimatePresence initial={live} mode="wait">
          {!locked ? (
            <motion.div key="lock" exit={{ opacity: 0, transition: { duration: 0.12 } }} style={{ position: "relative", display: "inline-flex" }}>
              <GhostButton tone="accent" size="md" onClick={lock} ariaLabel="lock it in">
                lock it in
              </GhostButton>
            </motion.div>
          ) : (
            <motion.div
              key="reveal"
              data-reveal
              initial={live ? { opacity: 0, x: locked.correct || reduced ? 0 : -14, y: locked.correct && !reduced ? 10 : 0 } : false}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={reduced ? { duration: 0.15 } : { ...spring, delay: locked.correct ? 0.1 : 0.3 }}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", position: "relative" }}
            >
              <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: locked.correct ? "var(--state-correct)" : "var(--state-wrong)", flexShrink: 0 }} />
              <p style={bodyStyle(revealFs)}>{card.revealCopy}</p>
              <Confetti burst={burst} count={16} origin={{ x: 20, y: 30 }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CardFrame>
  );
}

function SequenceChip({
  id,
  label,
  index,
  height,
  locked,
  state,
  reduced,
}: {
  id: string;
  label: string;
  index: number;
  height: number;
  locked: boolean;
  state: "idle" | "correct" | "wrong";
  reduced: boolean;
}) {
  const border = state === "correct" ? "var(--state-correct)" : state === "wrong" ? "var(--state-wrong)" : "var(--line)";
  const bg = state === "correct" ? "color-mix(in oklab, var(--state-correct) 12%, transparent)" : state === "wrong" ? "color-mix(in oklab, var(--state-wrong) 10%, transparent)" : "var(--surface)";
  return (
    <Reorder.Item
      value={id}
      as="li"
      dragListener={!locked}
      layout
      transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 500, damping: 34 }}
      whileDrag={reduced ? undefined : { scale: 1.03, boxShadow: "0 12px 30px -12px rgba(0,0,0,0.5)", zIndex: 5 }}
      // stop the frame's long-press from arming while the user grabs a chip
      onPointerDown={(e) => e.stopPropagation()}
      className="font-body"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: height,
        padding: "8px 14px 8px 12px",
        borderRadius: 14,
        border: `1.5px solid ${border}`,
        background: bg,
        color: "var(--ink)",
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.2,
        cursor: locked ? "default" : "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        transition: "border-color 200ms ease, background-color 200ms ease",
      }}
    >
      <span
        aria-hidden
        className="font-mono"
        style={{ width: 22, textAlign: "center", fontSize: 12, color: state === "idle" ? "var(--ink-2)" : border, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      {!locked ? (
        <span aria-hidden className="font-mono" style={{ color: "var(--ink-2)", opacity: 0.7, fontSize: 14, letterSpacing: "-0.1em", flexShrink: 0 }}>
          ⋮⋮
        </span>
      ) : (
        <span aria-hidden className="font-mono" style={{ color: border, fontSize: 15, flexShrink: 0 }}>
          {state === "correct" ? "✓" : "✕"}
        </span>
      )}
    </Reorder.Item>
  );
}
