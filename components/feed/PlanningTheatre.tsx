"use client";
import { motion } from "framer-motion";
import { createContext, useContext } from "react";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * The planning reveal (the single biggest anticipation moment in the app, formerly spent on grey
 * shimmer rectangles). The feed provides what the session poll has learned so far; the planning
 * notice card renders it as a narrated arrival:
 *
 *   - the palette surfaces on its own: the whole feed is themed by session.theme, so the pseudo
 *     repaints the instant the plan lands (ThemeRoot does that part)
 *   - the persona introduces itself in one line
 *   - the first outline stops appear one after another as ticks on a proto-rail — the same
 *     vertical-line-and-ticks language the depth rail speaks, so this literally becomes that
 *
 * Never a progress bar, never a percent. The reveal ACCELERATES toward the end (Harrison: the
 * finish should feel closer than it is). Reduced motion: everything appears, nothing animates.
 */

export type PlanTheatre = {
  /** the plan is in hand: theme applied, outline + persona known. */
  planned: boolean;
  title: string;
  personaName: string | null;
  /** one line in the persona's own voice, if it gave us one. */
  voiceLine: string | null;
  /** outline stop titles, in order. */
  stops: string[];
};

export const PlanTheatreContext = createContext<PlanTheatre | null>(null);

export function usePlanTheatre(): PlanTheatre | null {
  return useContext(PlanTheatreContext);
}

/** How many stops the reveal shows — a card is complete on one screen, a 24-node outline is not. */
const MAX_STOPS = 5;

/** Accelerating arrival: gaps shrink as the list lands (s). */
function stopDelay(i: number): number {
  // first gap ~0.4s, each one ~70% of the last — the end rushes toward you
  let t = 0;
  for (let k = 0; k < i; k++) t += 0.4 * Math.pow(0.7, k);
  return Math.min(t, 1.6);
}

/** The pre-plan proto-rail: a breathing vertical hairline. Motion without a claim — no fake bars. */
export function ProtoRail() {
  const { reduced } = useTheme();
  return (
    <div aria-hidden data-testid="proto-rail" className="relative mx-auto" style={{ height: 96, width: 3 }}>
      <span className="absolute inset-0 rounded-full" style={{ background: "var(--line)" }} />
      {reduced ? (
        <span className="absolute inset-x-0 rounded-full" style={{ top: 0, height: "40%", background: "var(--accent)", opacity: 0.7 }} />
      ) : (
        <motion.span
          className="absolute inset-x-0 rounded-full"
          style={{ height: 26, background: "linear-gradient(180deg, transparent, var(--accent), transparent)" }}
          initial={false}
          animate={{ top: ["100%", "-30%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />
      )}
    </div>
  );
}

/**
 * The post-plan reveal: persona line, then the thread's first stops ticking in down a proto-rail.
 * Text appears by OPACITY ONLY (the one-screen rule owns transforms on text).
 */
export function PlanReveal({ theatre }: { theatre: PlanTheatre }) {
  const { reduced } = useTheme();
  const stops = theatre.stops.slice(0, MAX_STOPS);
  const overflow = theatre.stops.length > stops.length;
  const appear = (delay: number) =>
    reduced
      ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
      : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.35, ease: "easeOut" as const, delay } };

  return (
    <div data-testid="plan-reveal" className="flex w-full flex-col items-center" style={{ gap: 14 }}>
      {(theatre.personaName || theatre.voiceLine) && (
        <motion.p
          className="font-body"
          style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: "var(--ink-2)", maxWidth: 320, textWrap: "pretty", textAlign: "center" }}
          {...appear(0)}
        >
          {theatre.personaName && <span style={{ color: "var(--accent)", fontWeight: 600 }}>{theatre.personaName}</span>}
          {theatre.personaName && theatre.voiceLine && <span> — </span>}
          {theatre.voiceLine && <span>“{theatre.voiceLine}”</span>}
        </motion.p>
      )}

      <div className="flex w-full justify-center">
        <ol className="relative flex flex-col" style={{ gap: 10, listStyle: "none", margin: 0, paddingLeft: 18, maxWidth: 300 }}>
          {/* the proto-rail the stops hang off — the same line the depth rail becomes */}
          <motion.span
            aria-hidden
            className="absolute rounded-full"
            style={{ left: 3, top: 4, bottom: overflow ? -8 : 4, width: 2.5, background: "color-mix(in oklab, var(--accent) 40%, transparent)" }}
            {...appear(0.1)}
          />
          {stops.map((stop, i) => (
            <motion.li key={`${i}:${stop}`} data-plan-stop className="relative flex items-baseline gap-3" {...appear(0.25 + stopDelay(i))}>
              <span
                aria-hidden
                className="absolute rounded-full"
                style={{ left: -18, top: 4, width: 8, height: 8, marginLeft: 0.25, background: "var(--accent)" }}
              />
              <span className="min-w-0 flex-1 truncate font-body" style={{ fontSize: 15, color: "var(--ink)" }}>
                {stop}
              </span>
            </motion.li>
          ))}
          {overflow && (
            // the line runs on past the last stop: there is more, unnumbered on purpose
            <motion.span
              aria-hidden
              className="absolute"
              style={{
                left: 3,
                bottom: -22,
                height: 18,
                width: 2.5,
                background: "linear-gradient(180deg, color-mix(in oklab, var(--accent) 40%, transparent), transparent)",
              }}
              {...appear(0.25 + stopDelay(stops.length))}
            />
          )}
        </ol>
      </div>
    </div>
  );
}
