"use client";
import { motion } from "framer-motion";
import { BottomSheet } from "@/components/home/BottomSheet";
import { GhostButton } from "@/components/ui/GhostButton";
import { useTheme } from "@/components/theme/ThemeRoot";
import type { MapTopic } from "@/lib/feed/map";

/**
 * THE SESSION MAP — long-press the timeline.
 *
 * The whole thread at a glance: every topic in order, the detours you took hanging off the topic
 * they branched from, and a mark on where you are right now. Tap something you have already been
 * through to go back to it; anything still ahead is inert — the map orients you, it never skips
 * you forward past what has been written. The in-app refresh lives here too (a standalone PWA has
 * no pull-to-refresh).
 *
 * No counters, no percentages, no "3 of 8". Structure only.
 */
export function SessionMapSheet({
  open,
  onClose,
  topics,
  onGoTo,
  onRefresh,
  refreshing,
}: {
  open: boolean;
  onClose: () => void;
  topics: MapTopic[];
  onGoTo: (rowId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { reduced } = useTheme();
  const go = (rowId: string | null) => {
    if (!rowId) return;
    onGoTo(rowId);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} label="the thread">
      <div className="flex items-center justify-between pb-1">
        <h2 className="font-display text-[22px] font-bold" style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}>
          the thread
        </h2>
        <GhostButton size="sm" onClick={onRefresh} ariaLabel="refresh this feed" disabled={refreshing}>
          <span aria-hidden>⟳</span> {refreshing ? "refreshing…" : "refresh"}
        </GhostButton>
      </div>

      {topics.length === 0 ? (
        <p className="pb-6 font-body text-[15px]" style={{ color: "var(--ink-2)" }}>
          still shaping this one. the map fills in as it goes.
        </p>
      ) : (
        <ol className="flex flex-col pb-4" data-testid="session-map">
          {topics.map((t, i) => (
            <li key={t.nodeId}>
              <Row
                label={t.title}
                state={t.state}
                reachable={t.reachable}
                last={i === topics.length - 1 && t.detours.length === 0}
                reduced={reduced}
                onTap={() => go(t.firstRowId)}
              />
              {t.detours.map((d) => (
                <Row
                  key={d.detourId}
                  branch
                  label={d.label || "your question"}
                  state={d.state}
                  reachable={d.reachable}
                  last={false}
                  reduced={reduced}
                  onTap={() => go(d.firstRowId)}
                />
              ))}
            </li>
          ))}
        </ol>
      )}
    </BottomSheet>
  );
}

function Row({
  label,
  state,
  reachable,
  branch = false,
  last,
  reduced,
  onTap,
}: {
  label: string;
  state: "done" | "current" | "ahead";
  reachable: boolean;
  branch?: boolean;
  last: boolean;
  reduced: boolean;
  onTap: () => void;
}) {
  const here = state === "current";
  const dim = state === "ahead";
  const color = here ? "var(--accent)" : state === "done" ? "var(--ink)" : "var(--ink-2)";
  return (
    <motion.button
      type="button"
      data-map-row={state}
      data-branch={branch ? "true" : undefined}
      disabled={!reachable}
      aria-current={here ? "true" : undefined}
      onClick={reachable ? onTap : undefined}
      whileTap={reduced || !reachable ? undefined : { scale: 0.985 }}
      className="flex w-full items-start gap-3 py-2 text-left"
      style={{ paddingLeft: branch ? 22 : 0, cursor: reachable ? "pointer" : "default", opacity: dim ? 0.45 : 1 }}
    >
      <span className="relative flex w-4 shrink-0 justify-center self-stretch" aria-hidden>
        {!last && (
          <span
            className="absolute top-3 bottom-0 w-px"
            style={{ background: "var(--line)", left: "50%" }}
          />
        )}
        <span
          className="relative mt-[7px] rounded-full"
          style={{
            width: here ? 9 : 7,
            height: here ? 9 : 7,
            background: here ? "var(--accent)" : state === "done" ? "color-mix(in oklab, var(--accent) 55%, transparent)" : "var(--line)",
            boxShadow: here ? "0 0 0 4px var(--accent-soft)" : undefined,
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-body text-[15px]" style={{ color, fontWeight: here ? 600 : 500 }}>
            {branch ? `↳ ${label}` : label}
          </span>
          {here && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--accent)" }}>
              you’re here
            </span>
          )}
        </span>
        {branch && state !== "ahead" && (
          <span className="mt-0.5 block font-body text-[11px]" style={{ color: "var(--ink-2)" }}>
            off the main thread
          </span>
        )}
      </span>
    </motion.button>
  );
}
