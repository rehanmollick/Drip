"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme/ThemeRoot";
import { useLongPress } from "@/lib/hooks/useLongPress";
import type { Segment, TimelineModel } from "@/lib/feed/timeline";

/**
 * THE TIMELINE — one segment per topic in the outline, in order, pinned above everything.
 *
 * Three layers in the same 3px track, so it stays a hairline and still tells the whole truth:
 *
 *   var(--line)       the topic as planned — the part that does not exist yet
 *   accent, ghosted   BUFFERED: written, ahead of you, waiting
 *   accent, solid     READ: where you actually are
 *
 * The gap between the solid band and the ghost band is your runway. The gap after the ghost band is
 * the part the writer hasn't written. A topic that is still open never lets the ghost reach the end,
 * so "waiting for you" can never be mistaken for "finished".
 *
 * One pulsing nib sits at the buffered edge of the topic being written RIGHT NOW — the difference
 * between "nothing is coming" and "wait a beat". It never appears at a fork: generation stops dead
 * there until the reader picks, so a pulse would be a promise nobody is keeping. A fork instead
 * marks its segment and dims everything downstream of it.
 *
 * Step onto a detour and the current segment switches to the off-thread colour with a cut through
 * it, so "am I still on the main story?" is answered without a word. The bar sits at ~30% opacity at
 * rest and brightens for 1.2s whenever the card under the thumb changes or the feed moves.
 *
 * Long-press → the session map. NO NUMBERS, ever: structure, not grading.
 */

const BRIGHT_MS = 1_200;
const MIN_READ = 0.03;   // a sliver, so the topic you're standing in never reads as untouched
const NIB_PX = 7;

export function Timeline({
  model,
  pulseKey,
  epoch = 0,
  scrolling,
  label,
  onOpenMap,
  refreshing = false,
}: {
  model: TimelineModel;
  /** identity of the card under the thumb — a change pulses the bar */
  pulseKey: string | null;
  /** runway epoch: a dial or a re-plan bumps it and genuinely deletes unviewed rows */
  epoch?: number;
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

  // the READ band never retracts while the reader stands still: a batch landing inside the current
  // topic grows the denominator, and a solid bar sliding backwards reads as losing ground. The
  // BUFFERED band is deliberately not ratcheted — a dial or a re-plan really does delete unviewed
  // rows, and pretending that runway is still there is the lie this whole bar exists to kill. The
  // epoch is in the key so a real deletion resets the ratchet too.
  const held = useRef({ key: "", read: 0 });
  const current = model.segments[model.currentIndex];
  const heldKey = `${epoch}:${model.nodeId ?? ""}:${pulseKey ?? ""}`;
  let read = current?.read ?? 0;
  if (held.current.key === heldKey) read = Math.max(read, held.current.read);
  held.current = { key: heldKey, read };
  // …and it can still only reach as far as what exists: the solid band never overtakes the ghost
  read = Math.min(read, current?.buffered ?? 1);

  let downstream = false;

  return (
    <div
      data-testid="timeline"
      data-gate={model.gate ?? undefined}
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
          const past = downstream;
          if (seg.gate) downstream = true;
          return (
            <Track
              key={`${seg.nodeId}:${i}`}
              seg={seg}
              read={i === model.currentIndex ? Math.max(read, MIN_READ) : seg.read}
              downstream={past}
              refreshing={refreshing}
              reduced={reduced}
              spring={spring}
            />
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

/** One topic: the planned track, the written band, the read band, and at most one nib. */
function Track({
  seg,
  read,
  downstream,
  refreshing,
  reduced,
  spring,
}: {
  seg: Segment;
  read: number;
  /** past the fork the thread is parked at — nothing beyond it is promised yet */
  downstream: boolean;
  refreshing: boolean;
  reduced: boolean;
  spring: ReturnType<typeof useTheme>["spring"];
}) {
  const readPct = Math.round(read * 100);
  const bufferedPct = Math.round(Math.max(seg.buffered, read) * 100);
  return (
    <div
      data-segment={seg.state}
      data-detour={seg.detour ? "true" : undefined}
      data-gate={seg.gate ?? undefined}
      className={"relative h-[3px] flex-1 overflow-hidden rounded-full" + (refreshing ? " shimmer" : "")}
      // off the main thread: the whole segment takes the branch colour, so it reads even when you
      // asked your question two cards into the topic
      style={{
        background: refreshing ? undefined : seg.detour ? "color-mix(in oklab, var(--accent-alt) 60%, transparent)" : "var(--line)",
        opacity: downstream ? 0.4 : 1,
      }}
    >
      {!refreshing && (
        <>
          {/* written and waiting — the runway you can actually swipe into */}
          <motion.span
            aria-hidden
            data-band="buffered"
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: "color-mix(in oklab, var(--accent) 30%, transparent)" }}
            initial={false}
            animate={{ width: `${bufferedPct}%` }}
            transition={reduced ? { duration: 0.15 } : spring}
          />
          {/* where the reader actually is */}
          <motion.span
            aria-hidden
            data-band="read"
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: "var(--accent)", opacity: seg.state === "done" ? 0.8 : 1 }}
            initial={false}
            animate={{ width: `${readPct}%` }}
            transition={reduced ? { duration: 0.15 } : spring}
          />
          {seg.live && <Nib at={bufferedPct} reduced={reduced} />}
          {seg.detour && readPct > 6 && (
            // …and a cut where you stepped off the main thread
            <span aria-hidden className="absolute inset-y-0" style={{ left: `max(2px, calc(${readPct}% - 9px))`, width: 3, background: "var(--bg)" }} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The one moving thing on the bar: a batch is being written into this topic right now. It holds
 * still under reduced motion — a strobing hairline at the top of the screen is exactly the thing
 * that setting exists to switch off.
 */
function Nib({ at, reduced }: { at: number; reduced: boolean }) {
  const style: React.CSSProperties = {
    left: `clamp(0px, calc(${at}% - ${NIB_PX}px), calc(100% - ${NIB_PX}px))`,
    width: NIB_PX,
    background: "var(--accent)",
  };
  if (reduced) return <span aria-hidden data-live="true" className="absolute inset-y-0 rounded-full" style={style} />;
  return (
    <motion.span
      aria-hidden
      data-live="true"
      className="absolute inset-y-0 rounded-full"
      style={style}
      initial={false}
      animate={{ opacity: [1, 0.25, 1] }}
      transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
