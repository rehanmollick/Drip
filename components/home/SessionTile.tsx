"use client";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { SessionPublic } from "@/lib/api/contract";
import type { Theme } from "@/lib/schemas/theme";
import { findBannedWord } from "@/lib/copy/banned";
import { hashString, hexAddress, seededRandom } from "@/components/cards/helpers";
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

type SigKind = Theme["signatureKind"];

/**
 * The stamp/ticker echoes put the theme's NAME on screen — the first place it
 * ever renders as copy — so it gets the same banned-word guarantee as every
 * other user-facing string. A missing or school-flavored name stamps "drip".
 */
export function echoName(name?: string | null): string {
  return !name || findBannedWord(name) ? "drip" : name;
}

/**
 * Where each signature device echoes on a cover: above the title (label-like
 * devices), below it (underline-like), inline in the title text, or behind it.
 */
export function echoSlot(kind: SigKind): "above" | "below" | "inline" | "behind" {
  switch (kind) {
    case "hex-addresses":
    case "stamp":
    case "ticker":
      return "above";
    case "underline-sweep":
    case "water-lines":
    case "waveform":
      return "below";
    case "brackets":
    case "cursor-blink":
      return "inline";
    case "constellation":
    case "ruled-notes":
      return "behind";
  }
}

/**
 * Covers wear their texture a notch louder than the feed does — a cover can
 * shout where a page whispers. Rendered ONCE by the shelf, not per tile.
 */
export function CoverTextureBoost() {
  return (
    <style>{`
      .cover-tile[data-texture="grain"]::before { opacity: 0.5; }
      .cover-tile[data-texture="grid"]::before { opacity: 0.7; background-size: 22px 22px; }
      .cover-tile[data-texture="scanlines"]::before { opacity: 0.55; }
      .cover-tile[data-texture="dots"]::before { opacity: 0.85; background-size: 14px 14px; }
    `}</style>
  );
}

/**
 * A cheap, STATIC echo of the session's signature device — the one accent
 * element a covered tile carries. No animation on the shelf: many tiles, and
 * the covers should invite, not flicker. The feed does the full version.
 */
function CoverEcho({ kind, seed, name, color }: { kind: SigKind; seed: string; name: string; color: string }) {
  if (kind === "hex-addresses") {
    return (
      <span className="font-mono text-[11px]" style={{ letterSpacing: "0.14em", color }}>
        {hexAddress(seed)}
      </span>
    );
  }
  if (kind === "stamp") {
    return (
      <span
        aria-hidden
        className="font-mono uppercase"
        style={{
          alignSelf: "flex-start",
          display: "inline-block",
          fontSize: 9,
          letterSpacing: "0.16em",
          lineHeight: 1,
          padding: "4px 7px",
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          color,
          transform: "rotate(-4deg)",
          maxWidth: "94%",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    );
  }
  if (kind === "ticker") {
    const run = Array.from({ length: 6 }, () => name.toUpperCase()).join("  ✦  ");
    return (
      <span
        aria-hidden
        className="font-mono"
        style={{
          display: "block",
          overflow: "hidden",
          whiteSpace: "nowrap",
          borderTop: `1px solid ${color}`,
          borderBottom: `1px solid ${color}`,
          padding: "3px 0",
          fontSize: 8.5,
          letterSpacing: "0.18em",
          lineHeight: 1.2,
          color,
          maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
        }}
      >
        {run}
      </span>
    );
  }
  if (kind === "underline-sweep") {
    return <span aria-hidden style={{ display: "block", height: 3, width: 44, marginTop: 9, borderRadius: 2, background: color }} />;
  }
  if (kind === "water-lines") {
    return (
      <svg aria-hidden viewBox="0 0 200 18" preserveAspectRatio="none" style={{ display: "block", width: "min(62%, 110px)", height: 14, marginTop: 8, overflow: "visible" }}>
        {[14, 9, 4].map((y, i) => (
          <path
            key={y}
            d={`M0 ${y} q 12 -${3 + i} 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0 t 25 0`}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.9 - i * 0.28}
          />
        ))}
      </svg>
    );
  }
  if (kind === "waveform") {
    const rnd = seededRandom(hashString(seed) ^ 0x9e37);
    const bars = Array.from({ length: 18 }, (_, i) => {
      const env = Math.sin((i / 17) * Math.PI);
      return 3 + Math.round((0.35 + rnd() * 0.65) * env * 11);
    });
    return (
      <span aria-hidden style={{ display: "flex", alignItems: "center", gap: 2.5, height: 15, marginTop: 8 }}>
        {bars.map((h, i) => (
          <span key={i} style={{ width: 2, height: h, borderRadius: 2, background: color, opacity: 0.85 }} />
        ))}
      </span>
    );
  }
  if (kind === "constellation") {
    const rnd = seededRandom(hashString(seed));
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: 4 + ((i + rnd() * 0.9) / 6) * 92, y: 8 + rnd() * 84 }));
    const lines: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 3], [2, 5]];
    return (
      <svg aria-hidden style={{ position: "absolute", inset: "-6% -2%", width: "104%", height: "112%", pointerEvents: "none", overflow: "visible", zIndex: 0, opacity: 0.55 }}>
        {lines.map(([a, b], i) => (
          <line key={i} x1={`${pts[a].x}%`} y1={`${pts[a].y}%`} x2={`${pts[b].x}%`} y2={`${pts[b].y}%`} stroke={color} strokeWidth={0.75} opacity={0.4} />
        ))}
        {pts.map((p, i) => (
          <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r={i % 3 === 0 ? 2.4 : 1.6} fill={color} opacity={0.75} />
        ))}
      </svg>
    );
  }
  return null;
}

/**
 * Home grid tile as a COVER: the session wears its own theme — bg, ink, accent,
 * display font, texture, and a static echo of its signature device — so the
 * shelf reads as a stack of different magazines, each unmistakably its own.
 * One accent element per cover: the signature echo carries the accent on
 * themed tiles, the state line carries it on fallback tiles — never both.
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
  const kind: SigKind | null = covered ? t.signatureKind : null;
  const slot = kind ? echoSlot(kind) : null;
  // the echo rides the session's accent, stepping down to secondary ink when the accent can't read on this bg
  const accentOk = covered && coverLegible(t.accent, t.bg.base);
  const echoColor = accentOk ? "var(--accent)" : "var(--ink-2)";
  // one accent element per cover: themed tiles spend it on the echo, fallback tiles on the state line
  const stateColor = covered ? "var(--ink-2)" : "var(--accent)";
  const title = session.title || "untitled";
  const themeName = echoName(t?.name);

  return (
    <motion.div
      role="link"
      tabIndex={0}
      aria-label={session.title || "untitled"}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={spring}
      className="cover-tile no-select relative flex aspect-[4/5] cursor-pointer flex-col overflow-hidden rounded-3xl p-4 text-left"
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

        {/* the title takes the stage: big display type in the tile's middle, wearing the signature */}
        <div className="relative flex min-h-0 flex-1 flex-col justify-center py-2">
          {kind && slot === "above" && (
            <div className="mb-2.5 flex">
              <CoverEcho kind={kind} seed={session.id} name={themeName} color={echoColor} />
            </div>
          )}
          {kind === "constellation" && <CoverEcho kind={kind} seed={session.id} name={themeName} color={echoColor} />}
          <p
            className={`font-display text-[22px] leading-[1.1] text-ink text-balance${kind === "cursor-blink" && accentOk ? " cursor-blink" : ""}`}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              position: "relative",
              zIndex: 1,
              ...(kind === "ruled-notes"
                ? {
                    paddingBlock: "0.12em",
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.1em - 1px), color-mix(in oklab, ${echoColor} 40%, transparent) calc(1.1em - 1px), color-mix(in oklab, ${echoColor} 40%, transparent) 1.1em)`,
                    backgroundSize: "100% 1.1em",
                    backgroundPosition: "0 0.12em",
                  }
                : null),
            }}
          >
            {kind === "brackets" ? (
              <>
                <span aria-hidden style={{ color: echoColor, fontWeight: 800, marginRight: "0.08em" }}>[</span>
                {title}
                <span aria-hidden style={{ color: echoColor, fontWeight: 800, marginLeft: "0.08em" }}>]</span>
              </>
            ) : (
              title
            )}
            {kind === "cursor-blink" && !accentOk && <span aria-hidden style={{ color: echoColor }}>▍</span>}
          </p>
          {kind && slot === "below" && <CoverEcho kind={kind} seed={session.id} name={themeName} color={echoColor} />}
        </div>

        {planning ? (
          <div className="flex items-center gap-2">
            <span className="shimmer h-1.5 w-10 rounded-full" />
            <span className="font-body text-[11px] leading-snug text-ink-2">{coverState(session)}</span>
          </div>
        ) : (
          <p className="font-body text-[11px] leading-snug" style={{ color: stateColor }}>
            {coverState(session)}
          </p>
        )}
      </div>
    </motion.div>
  );
}
