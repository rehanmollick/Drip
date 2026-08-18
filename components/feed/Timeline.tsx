"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeRoot";
import { useLongPress } from "@/lib/hooks/useLongPress";
import type { TimelineModel } from "@/lib/feed/timeline";

/**
 * THE TIMELINE — one segment per topic in the outline, in order, pinned above everything.
 *
 * Behind you: solid. Where you are: filling. Ahead: faint. Step onto a detour and the current
 * segment switches to the off-thread colour with a cut through it, so "am I still on the main
 * story?" is answered without a word. It sits at ~30% opacity at rest and brightens for 1.2s
 * whenever the card under the thumb changes or the feed moves — orientation when you want it,
 * invisible when you don't.
 *
 * Long-press → the session map. NO NUMBERS, ever: structure, not grading.
 */

const BRIGHT_MS = 1_200;

export function Timeline({
  model,
  pulseKey,
  scrolling,
  label,
  onOpenMap,
  refreshing = false,
}: {
  model: TimelineModel;
  /** identity of the card under the thumb — a change pulses the bar */
  pulseKey: string | null;
  scrolling: boolean;
  /** transient "now: <topic>" line, owned by the feed */
  label: string | null;
  onOpenMap: () => void;
  refreshing?: boolean;
}) {
  const { spring, reduced } = useTheme();
  const press = useLongPress(onOpenMap, { ms: 550 });
  const [bright, setBright] = useState(true);

  useEffect(() => {
    setBright(true);
    if (scrolling) return;
    const t = window.setTimeout(() => setBright(false), BRIGHT_MS);
    return () => window.clearTimeout(t);
  }, [pulseKey, scrolling]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpenMap();
      }
    },
    [onOpenMap],
  );

  // the fill never retracts while the reader stands still: a batch landing inside the current topic
  // grows the denominator, and a bar that slides backwards reads as losing ground.
  const held = useRef({ key: "", fill: 0 });
  const current = model.segments[model.currentIndex];
  const heldKey = `${model.nodeId ?? ""}:${pulseKey ?? ""}`;
  let fill = current?.fill ?? 0;
  if (held.current.key === heldKey) fill = Math.max(fill, held.current.fill);
  held.current = { key: heldKey, fill };

  return (
    <div
      data-testid="timeline"
      role="button"
      tabIndex={0}
      aria-label="the thread"
      className="no-select fixed inset-x-0 top-0 z-50"
      style={{ height: "calc(env(safe-area-inset-top, 0px) + 22px)", touchAction: "pan-y" }}
      onKeyDown={onKeyDown}
      {...press}
    >
      <motion.div
        className="flex items-stretch gap-[3px] px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 7px)" }}
        animate={{ opacity: bright || refreshing ? 1 : 0.3 }}
        transition={{ duration: reduced ? 0.15 : 0.25, ease: "easeOut" }}
      >
        {model.segments.map((seg, i) => {
          const pct = seg.state === "done" ? 100 : seg.state === "ahead" ? 0 : Math.round(Math.max(fill, 0.03) * 100);
          return (
            <div
              key={`${seg.nodeId}:${i}`}
              data-segment={seg.state}
              data-detour={seg.detour ? "true" : undefined}
              className={"relative h-[3px] flex-1 overflow-hidden rounded-full" + (refreshing ? " shimmer" : "")}
              // off the main thread: the whole segment takes the branch colour, so it reads even
              // when you asked your question two cards into the topic
              style={{ background: refreshing ? undefined : seg.detour ? "color-mix(in oklab, var(--accent-alt) 60%, transparent)" : "var(--line)" }}
            >
              {pct > 0 && !refreshing && (
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: "var(--accent)", opacity: seg.state === "done" ? 0.8 : 1 }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={reduced ? { duration: 0.15 } : spring}
                />
              )}
              {seg.detour && pct > 6 && !refreshing && (
                // …and a cut where you stepped off it
                <span aria-hidden className="absolute inset-y-0" style={{ left: `max(2px, calc(${pct}% - 9px))`, width: 3, background: "var(--bg)" }} />
              )}
            </div>
          );
        })}
      </motion.div>

      <div
        className="pointer-events-none absolute inset-x-0 flex justify-center px-14"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
      >
        <AnimatePresence>
          {label && (
            <motion.span
              key={label}
              data-testid="topic-label"
              className="max-w-full truncate font-body text-[12px] tracking-wide"
              style={{ color: "var(--accent)" }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 0.9, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.15 : 0.28, ease: "easeOut" }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
