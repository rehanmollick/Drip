"use client";
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import type { CrossroadsCard as CrossroadsCardT } from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { CardFrame, Rise, headlineStyle } from "./CardFrame";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { useTheme } from "@/components/theme/ThemeRoot";
import { ticks } from "@/lib/audio/ticks";
import { usePressable } from "@/lib/motion";
import { fitFontSize } from "./helpers";

type Kind = CrossroadsCardT["choices"][number]["kind"];

const MARK: Record<Kind, string> = { continue: "→", deeper: "↓", ask: "?", wrap: "✕" };
const AFTER: Record<Kind, string> = {
  continue: "on it — keep scrolling",
  deeper: "going deeper — keep scrolling",
  ask: "ask away",
  wrap: "wrapping it up",
};

/**
 * crossroads — the feed asking permission instead of running on forever.
 * Generation is STOPPED behind this card (progress.awaitingChoice), so it has
 * to read like a breath, not a dialog: what just closed, then four big calm
 * targets. The continue target names what's next so "am I still on the same
 * thing?" is answered before it's asked.
 */
export function CrossroadsView({ card, entered, interaction, onChoose, onInteract, onAskAbout }: CardViewProps<CrossroadsCardT>) {
  const { spring, reduced } = useTheme();
  const pressable = usePressable();
  const prior = typeof interaction?.choice === "string" ? (interaction.choice as Kind) : null;
  const [picked, setPicked] = useState<Kind | null>(prior);

  const pick = useCallback(
    (kind: Kind) => {
      if (picked) return;
      setPicked(kind);
      ticks.reveal();
      onInteract?.({ choice: kind });   // so scrolling back replays the resolved state
      void onChoose?.(kind);
    },
    [picked, onChoose, onInteract],
  );

  const headFs = fitFontSize(card.headline, [[40, 32], [60, 28], [Infinity, 25]]);

  return (
    <CardFrame card={card} entered={entered} onAskAbout={onAskAbout} gap={16}>
      <Rise>
        <Eyebrow>{card.eyebrow ?? "you pick"}</Eyebrow>
      </Rise>

      <Rise>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={headlineStyle(headFs, 1.08)}>{card.headline}</h2>
          <span
            data-crossroads-finished
            className="font-mono"
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              maxWidth: "100%",
              fontSize: 11.5,
              letterSpacing: "0.06em",
              padding: "4px 12px",
              borderRadius: 999,
              color: "var(--accent)",
              background: "var(--accent-soft)",
              border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)",
              overflowWrap: "anywhere",
            }}
          >
            <span aria-hidden>✓</span> that&apos;s {card.finished}
          </span>
        </div>
      </Rise>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {card.choices.map((c, i) => {
          const chosen = picked === c.kind;
          const dim = !!picked && !chosen;
          const sub = c.kind === "continue" && card.upNext ? card.upNext : null;
          return (
            <Rise key={`${c.kind}-${i}`}>
              <motion.button
                type="button"
                data-choice={c.kind}
                aria-pressed={chosen}
                disabled={!!picked}
                onClick={() => pick(c.kind)}
                whileTap={picked ? undefined : pressable.whileTap}
                initial={false}
                animate={{ opacity: dim ? 0.35 : 1 }}
                transition={reduced ? { duration: 0.15 } : spring}
                className="font-body"
                style={{
                  width: "100%",
                  minHeight: 58,
                  padding: "12px 16px",
                  borderRadius: 18,
                  border: `1.5px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                  background: chosen ? "var(--accent-soft)" : "var(--surface)",
                  transition: "border-color 200ms ease, background-color 200ms ease",
                  color: "var(--ink)",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: picked ? "default" : "pointer",
                  WebkitTapHighlightColor: "transparent",
                  touchAction: "manipulation",
                }}
              >
                <span
                  className="font-mono"
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    color: chosen ? "var(--accent)" : "var(--ink-2)",
                    border: `1px solid ${chosen ? "var(--accent)" : "var(--line)"}`,
                  }}
                >
                  {MARK[c.kind]}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2, overflowWrap: "anywhere" }}>{c.label}</span>
                  {sub && (
                    <span style={{ fontSize: 13, lineHeight: 1.25, color: "var(--ink-2)", overflowWrap: "anywhere" }}>
                      next up · {sub}
                    </span>
                  )}
                </span>
              </motion.button>
            </Rise>
          );
        })}
      </div>

      {picked && (
        <motion.span
          key="locked"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0.15 } : spring}
          className="font-mono uppercase"
          style={{ fontSize: 10.5, letterSpacing: "0.16em", color: "var(--ink-2)" }}
        >
          {AFTER[picked]}
        </motion.span>
      )}
    </CardFrame>
  );
}
