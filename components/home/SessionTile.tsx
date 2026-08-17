"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SessionPublic } from "@/lib/api/contract";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { useTheme } from "@/components/theme/ThemeRoot";

/** position/cardCount as a ring. No numbers, ever. */
export function ProgressRing({ fraction, size = 30 }: { fraction: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 400ms ease" }}
      />
    </svg>
  );
}

export function sessionFraction(s: SessionPublic): number {
  const total = s.cardCount ?? 0;
  if (total <= 1) return 0;
  return Math.min(1, s.position / (total - 1));
}

/**
 * Home grid tile: title, theme swatch (bg→accent strip + accent dot), progress
 * ring. Tap → resume. Long-press → menu sheet.
 */
export function SessionTile({ session, onMenu }: { session: SessionPublic; onMenu: (s: SessionPublic) => void }) {
  const router = useRouter();
  const { spring, reduced } = useTheme();
  const open = useCallback(() => router.push(`/s/${session.id}`), [router, session.id]);
  const press = useLongPress(() => onMenu(session), { ms: 450, onTap: open });
  const t = session.theme;
  const swatch = t ? `linear-gradient(90deg, ${t.bg.base} 0%, ${t.bg.gradientTo ?? t.bg.base} 55%, ${t.accent} 100%)` : undefined;
  const planning = session.status === "planning";
  const errored = session.status === "error";

  return (
    <motion.div
      role="link"
      tabIndex={0}
      aria-label={session.title || "untitled"}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={spring}
      className="no-select flex aspect-[4/5] cursor-pointer flex-col justify-between overflow-hidden rounded-3xl p-4 text-left"
      style={{ background: "var(--surface)", border: "1px solid var(--line)", touchAction: "manipulation" }}
      {...press}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={"h-2.5 w-full max-w-[60%] rounded-full" + (t ? "" : " shimmer")} style={{ background: swatch }} />
        <ProgressRing fraction={sessionFraction(session)} />
      </div>
      <div className="min-h-0">
        <p className="font-display text-[17px] leading-tight text-ink text-balance" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {session.title || "untitled"}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t?.accent ?? "var(--ink-2)" }} />
          <span className="truncate font-mono text-[11px] uppercase tracking-wide text-ink-2">
            {planning ? "brewing…" : errored ? "needs a retry" : t?.name ?? session.sourceKind}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
