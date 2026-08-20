"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeRoot";
import { useLongPress } from "@/lib/hooks/useLongPress";
import type { RailModel } from "@/lib/feed/rail";

/**
 * THE DEPTH RAIL — a vertical hairline hugging the right edge, spanning most of the viewport.
 * The feed is vertical, so the rail maps position to geometry 1:1. Top to bottom:
 *
 *   solid accent          read — behind the thumb
 *   ● the thumb           the reader (never at zero: the plan itself was distance)
 *   half-lit solid        cards that EXIST below, exact
 *
 * The rail's whole span is cards that exist — no dashed continuation, no laid-out path for topics
 * that are only headings yet. New rail appears when cards actually land (the arrival beat + the
 * renormalising springs ARE the "more is coming" signal); while the thread is open the bottom edge
 * fades out instead of promising anything. Topic boundaries are ticks, spans proportional to each
 * topic's written card count. The bottom edge carries the pulse only while a batch is genuinely in
 * flight (static under reduced motion); a slow upward-drifting shimmer rides the waiting zone
 * while it writes. A fork is a gate mark where the rail stops — no pulse there, nothing below to
 * dim. A wrap is a hard end cap. A detour doubles the rail beside itself for the detour's span.
 *
 * iOS-scrollbar discipline: a 2.5px hairline at low opacity at rest; swells to 5px and brightens
 * while scrolling, while writing, and for a beat when new cards land below. Long-press → the
 * session map. NEVER a number on the rail: geometry only. The transient "now: <topic>" label lives
 * OUTSIDE the rail node so the ambient indicator carries no text at all.
 */

const BRIGHT_MS = 1_200;
const REST_W = 2.5;
const AWAKE_W = 5;

export function DepthRail({
  model,
  pulseKey,
  epoch = 0,
  deckSize = 0,
  scrolling,
  label,
  onOpenMap,
  refreshing = false,
}: {
  model: RailModel;
  /** identity of the card under the thumb — a change brightens the rail */
  pulseKey: string | null;
  /** runway epoch: a dial or a re-plan bumps it and genuinely deletes unviewed rows */
  epoch?: number;
  /** row count — growth means new cards landed below, worth a beat of brightness */
  deckSize?: number;
  scrolling: boolean;
  /** transient "now: <topic>" line, owned by the feed */
  label: string | null;
  onOpenMap: () => void;
  refreshing?: boolean;
}) {
  const { spring, reduced } = useTheme();
  const press = useLongPress(onOpenMap, { ms: 550 });
  const [bright, setBright] = useState(true);

  // brighten on movement AND on arrival: a new card under the thumb, or new cards landing below
  useEffect(() => {
    setBright(true);
    if (scrolling) return;
    const t = window.setTimeout(() => setBright(false), BRIGHT_MS);
    return () => window.clearTimeout(t);
  }, [pulseKey, scrolling, deckSize, model.live]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpenMap();
      }
    },
    [onOpenMap],
  );

  // the thumb never slides back up while the reader stands still: a batch landing below grows the
  // denominators and would pull every fraction down, and a marker drifting backwards reads as
  // losing ground. Re-keyed on the card under the thumb (moving IS allowed to re-place you) and on
  // the epoch (a dial / re-plan really deletes runway — pretending otherwise is the lie the rail
  // exists to kill).
  const held = useRef({ key: "", thumb: 0 });
  const heldKey = `${epoch}:${pulseKey ?? ""}`;
  let thumb = model.thumb;
  if (held.current.key === heldKey) thumb = Math.max(thumb, held.current.thumb);
  held.current = { key: heldKey, thumb };

  const awake = bright || refreshing || model.live;
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

  return (
    <>
      <div
        data-testid="depth-rail"
        data-live={model.live ? "true" : undefined}
        data-gate={model.gate?.kind ?? undefined}
        data-wrapped={model.wrapped ? "true" : undefined}
        data-open={model.open ? "true" : undefined}
        data-detour={model.onDetour ? "true" : undefined}
        role="button"
        tabIndex={0}
        aria-label="the thread"
        className="no-select fixed z-50"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 64px)",
          bottom: "calc(max(env(safe-area-inset-bottom, 0px), 16px) + 88px)",
          right: "max(env(safe-area-inset-right, 0px), 0px)",
          width: 24,
          touchAction: "pan-y",
        }}
        onKeyDown={onKeyDown}
        {...press}
      >
        <motion.div
          className="absolute inset-y-0"
          style={{ right: 7 }}
          initial={false}
          animate={{ opacity: awake ? 1 : 0.35, width: awake ? AWAKE_W : REST_W }}
          transition={{ duration: reduced ? 0.15 : 0.3, ease: "easeOut" }}
        >
          <div
            className="relative h-full w-full"
            style={
              model.open
                ? // the thread is still open: the bottom edge fades out — "it keeps going", said
                  // without laying out a single pixel of rail nobody has written
                  { maskImage: "linear-gradient(180deg, black 0%, black 86%, transparent 100%)", WebkitMaskImage: "linear-gradient(180deg, black 0%, black 86%, transparent 100%)" }
                : undefined
            }
          >
            {/* re-planning: the old geometry is stale, so only a faint neutral base line remains */}
            {refreshing && <span aria-hidden className="absolute inset-x-0 rounded-full" style={{ top: 0, bottom: 0, background: "var(--line)", opacity: 0.35 }} />}

            {/* cards that EXIST, span by span — exact, and the ONLY thing the rail is made of */}
            {!refreshing &&
              model.spans.map(
                (s) =>
                  s.writtenTo > s.from && (
                    <span
                      key={s.nodeId || "solo"}
                      aria-hidden
                      data-band="exists"
                      className="absolute inset-x-0"
                      style={{
                        top: pct(s.from),
                        height: pct(Math.max(0, s.writtenTo - s.from)),
                        background: "color-mix(in oklab, var(--accent) 45%, transparent)",
                      }}
                    />
                  ),
              )}

            {/* the waiting zone breathes upward while a batch writes: backward drift reads faster */}
            {!refreshing && model.live && !reduced && thumb < model.written && (
              <span aria-hidden className="absolute inset-x-0 overflow-hidden" style={{ top: pct(thumb), height: pct(Math.max(0, model.written - thumb)) }}>
                <motion.span
                  className="absolute inset-x-0"
                  style={{ height: 26, background: "linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 55%, transparent), transparent)" }}
                  initial={false}
                  animate={{ top: ["110%", "-30%"] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
                />
              </span>
            )}

            {/* goal gradient: the last sliver of the topic underway brightens, quietly */}
            {!refreshing && model.goal && (
              <span
                aria-hidden
                data-band="goal"
                className="absolute inset-x-0"
                style={{
                  top: pct(model.goal.from),
                  height: pct(Math.max(0, model.goal.to - model.goal.from)),
                  background: "color-mix(in oklab, var(--accent) 22%, transparent)",
                }}
              />
            )}

            {/* read: where the reader has actually been */}
            {!refreshing && (
              <motion.span
                aria-hidden
                data-band="read"
                className="absolute inset-x-0 rounded-full"
                style={{ top: 0, background: "var(--accent)" }}
                initial={false}
                animate={{ height: pct(thumb) }}
                transition={reduced ? { duration: 0.15 } : spring}
              />
            )}

            {/* topic boundaries: ticks, spans proportional to each topic's written card count */}
            {model.ticks.map((t, i) => (
              <span
                key={`${i}:${t}`} // two zero-width topics can share a boundary value — the index keeps keys unique
                aria-hidden
                data-tick
                className="absolute"
                style={{ top: pct(t), left: -3, right: -1, height: 2, background: "var(--bg)", borderBottom: "1px solid color-mix(in oklab, var(--ink-2) 55%, transparent)" }}
              />
            ))}

            {refreshing && <span aria-hidden className="shimmer absolute inset-0 rounded-full" />}
          </div>

          {/* the pulse: a batch is being written into the frontier RIGHT NOW. holds still under
              reduced motion — a strobing edge is exactly what that setting switches off */}
          {model.live && !refreshing && <Pulse at={model.written} reduced={reduced} />}

          {/* the gate: the rail stops here until the reader picks a direction */}
          {model.gate && !model.wrapped && (
            <span
              aria-hidden
              data-gate-mark
              className="absolute"
              style={{
                top: `calc(${pct(model.gate.at)} - 4px)`,
                left: "50%",
                width: 8,
                height: 8,
                marginLeft: -4,
                transform: "rotate(45deg)",
                background: "var(--bg)",
                border: "1.5px solid var(--accent)",
              }}
            />
          )}

          {/* the wrap: a hard end cap — the thread ended, nothing below is coming */}
          {model.wrapped && (
            <span aria-hidden data-cap className="absolute rounded-full" style={{ top: `calc(${pct(model.written)} - 1px)`, left: -3, right: -3, height: 2.5, background: "var(--accent)" }} />
          )}

          {/* the reader */}
          {!refreshing && (
            <motion.span
              aria-hidden
              data-thumb
              className="absolute rounded-full"
              style={{ left: -2.5, right: -2.5, height: 10, marginTop: -5, background: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-soft)" }}
              initial={false}
              animate={{ top: pct(thumb) }}
              transition={reduced ? { duration: 0.15 } : spring}
            />
          )}

          {/* the doubled track: the reader is off the main thread, visibly beside it */}
          {model.detour && !refreshing && (
            <span
              aria-hidden
              data-band="detour"
              className="absolute rounded-full"
              style={{
                left: -7,
                width: REST_W,
                top: pct(model.detour.at),
                height: pct(Math.max(0.02, model.detour.span)),
                background: "color-mix(in oklab, var(--accent-alt, var(--accent)) 75%, transparent)",
              }}
            />
          )}
        </motion.div>
      </div>

      {/* "now: <topic>" — outside the rail node on purpose: the ambient indicator carries no text */}
      <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-14" style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}>
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
    </>
  );
}

/** The one repeating motion on the rail: the written edge, while a batch is in flight. */
function Pulse({ at, reduced }: { at: number; reduced: boolean }) {
  const style: React.CSSProperties = {
    top: `calc(${(at * 100).toFixed(3)}% - 4px)`,
    left: "50%",
    width: 7,
    height: 7,
    marginLeft: -3.5,
    borderRadius: 9999,
    background: "var(--accent)",
  };
  if (reduced) return <span aria-hidden data-pulse="true" className="absolute" style={style} />;
  return (
    <motion.span
      aria-hidden
      data-pulse="true"
      className="absolute"
      style={style}
      initial={false}
      animate={{ opacity: [1, 0.25, 1], scale: [1, 1.5, 1] }}
      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
