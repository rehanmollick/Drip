"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SessionPublic } from "@/lib/api/contract";
import { useLongPress } from "@/lib/hooks/useLongPress";
import { luminance, themeStyle } from "@/lib/theme/cssVars";
import { useTheme } from "@/components/theme/ThemeRoot";

/** cards written below the last one the reader saw */
export function unviewedRunway(s: SessionPublic): number {
  return Math.max(0, (s.cardCount ?? 0) - (s.position + 1));
}

/** a wrap archives the session but the thread stays on the shelf */
export function isWrapped(s: SessionPublic): boolean {
  return s.frontier?.gate === "wrap" || s.status === "archived";
}

/** the one state line a cover carries — feed-native, lowercase, never a count */
export function coverState(s: SessionPublic): string {
  if (s.status === "planning") return "still brewing…";
  if (s.status === "error") return "needs a retry";
  if (isWrapped(s)) return "wrapped — the thread's still there";
  if (s.progress?.awaitingChoice) return "parked at a fork";
  if (unviewedRunway(s) > 0) return "fresh cards waiting";
  return "picks up where you left off";
}

/** relative recency for the cover ("2 days ago") — time words, not progress numbers */
export function agoLine(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (w === 1) return "last week";
  if (d < 30) return `${w} weeks ago`;
  const mo = Math.floor(d / 30);
  return mo <= 1 ? "last month" : `${mo} months ago`;
}

/**
 * The shelf guarantees ink-on-bg even if a stored theme doesn't: below ~3:1
 * the tile falls back to shell surface + ink instead of wearing the theme.
 */
export function coverLegible(ink: string, bg: string): boolean {
  const a = luminance(ink);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3;
}

/** resume intent: mid-thread most recent first, wrapped threads shelved last */
export function sortShelf(sessions: SessionPublic[]): SessionPublic[] {
  return [...sessions].sort((a, b) => {
    if (isWrapped(a) !== isWrapped(b)) return isWrapped(a) ? 1 : -1;
    return (Date.parse(b.lastOpenedAt) || 0) - (Date.parse(a.lastOpenedAt) || 0);
  });
}

/** how deep the reader is vs what's written, as a fraction for the rail sliver */
export function depthFraction(s: SessionPublic): number {
  const total = s.cardCount ?? 0;
  if (total <= 1) return 0;
  return Math.max(0, Math.min(1, s.position / (total - 1)));
}

/**
 * Home grid tile as a COVER: the session wears its own theme — bg, ink, accent,
 * display font, texture — so the shelf reads as a stack of different magazines.
 * Tap → resume. Long-press → menu sheet.
 */
export function SessionTile({ session, onMenu }: { session: SessionPublic; onMenu: (s: SessionPublic) => void }) {
  const router = useRouter();
  const { spring, reduced } = useTheme();
  const open = useCallback(() => router.push(`/s/${session.id}`), [router, session.id]);
  const press = useLongPress(() => onMenu(session), { ms: 450, onTap: open });

  const t = session.theme;
  const covered = !!t && coverLegible(t.ink.primary, t.bg.base);
  const style = covered
    ? {
        ...themeStyle(t),
        background: t.bg.gradientTo ? `linear-gradient(160deg, ${t.bg.base}, ${t.bg.gradientTo})` : t.bg.base,
        border: "1px solid var(--line)",
        touchAction: "manipulation" as const,
      }
    : { background: "var(--surface)", border: "1px solid var(--line)", touchAction: "manipulation" as const };

  const planning = session.status === "planning";
  const rail = depthFraction(session);
  // the state line rides the session's accent, but only when the accent itself reads on this bg
  const stateColor = covered && !coverLegible(t.accent, t.bg.base) ? "var(--ink-2)" : "var(--accent)";

  return (
    <motion.div
      role="link"
      tabIndex={0}
      aria-label={session.title || "untitled"}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={spring}
      className="no-select relative flex aspect-[4/5] cursor-pointer flex-col overflow-hidden rounded-3xl p-4 text-left"
      style={style}
      data-texture={covered ? t.bg.texture : undefined}
      {...press}
    >
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <span className="font-mono text-[10px] tracking-wide text-ink-2">{agoLine(session.lastOpenedAt)}</span>
          {/* depth rail sliver: how deep they are vs what's written — wordless, numberless */}
          {!planning && (session.cardCount ?? 0) > 1 && (
            <span aria-hidden className="relative h-9 w-[3px] shrink-0 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <span className="absolute inset-x-0 top-0 rounded-full" style={{ background: "var(--accent)", height: `${Math.max(8, Math.round(rail * 100))}%` }} />
            </span>
          )}
        </div>

        <div className="mt-auto min-h-0">
          <p
            className="font-display text-[19px] leading-[1.12] text-ink text-balance"
            style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {session.title || "untitled"}
          </p>
          {planning ? (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="shimmer h-1.5 w-10 rounded-full" />
              <span className="font-body text-[11px] leading-snug text-ink-2">{coverState(session)}</span>
            </div>
          ) : (
            <p className="mt-2 font-body text-[11px] leading-snug" style={{ color: stateColor }}>
              {coverState(session)}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
