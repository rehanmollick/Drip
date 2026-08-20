"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import type { SessionPublic } from "@/lib/api/contract";
import { SHELL_THEME } from "@/lib/theme/defaults";
import { ThemeRoot, useTheme } from "@/components/theme/ThemeRoot";
import { HowItWorksSheet } from "./HowItWorksSheet";
import { NewSessionSheet } from "./NewSessionSheet";
import { SessionMenuSheet } from "./SessionMenuSheet";
import { SessionTile, sortShelf } from "./SessionTile";
import { Splash } from "./Splash";
import { daySeed, suggestionsAt } from "./suggestions";

/**
 * HOME (spec §2): a shelf of covers + big "+". Supabase cold-start rule: the
 * list query retries once after 3s while the shell splash shows (not an error).
 */
export function HomeScreen() {
  return (
    <ThemeRoot theme={SHELL_THEME} className="app-shell home-root">
      <HomeInner />
    </ThemeRoot>
  );
}

function HomeInner() {
  const { spring, reduced } = useTheme();
  const [sheet, setSheet] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [menuFor, setMenuFor] = useState<SessionPublic | null>(null);

  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.get<{ sessions: SessionPublic[] }>("/api/sessions")).sessions,
    retry: 1,
    retryDelay: 3_000,
    staleTime: 3_000,
    refetchOnMount: "always",
  });
  const refresh = useCallback(() => void q.refetch(), [q]);
  const openSheet = useCallback((fill?: string) => {
    setSeed(fill ?? null);
    setSheet(true);
  }, []);

  // wrapped threads stay on the shelf (archived by the wrap, still scrollable), shelved last
  const sessions = useMemo(() => sortShelf(q.data ?? []), [q.data]);
  const chips = useMemo(() => suggestionsAt(daySeed()), []);

  if (q.isPending) return <Splash className="h-full w-full" />;

  const empty = !q.isError && sessions.length === 0;

  return (
    <div className="relative h-full w-full">
      {/* bottom padding clears the 64px FAB so the last row never hides under it */}
      <div className="h-full overflow-y-auto" style={{ overscrollBehaviorY: "contain", paddingTop: "max(env(safe-area-inset-top), 16px)", paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 120px)" }}>
        <header className="flex items-center justify-between px-5 pt-3 pb-4">
          <span className="font-display text-2xl tracking-tight text-ink">drip</span>
          <span className="font-mono text-[11px] uppercase tracking-wide text-ink-2">{sessions.length ? "your feeds" : ""}</span>
        </header>

        {q.isError && (
          <button type="button" onClick={refresh} className="mx-5 mb-4 w-[calc(100%-2.5rem)] rounded-2xl px-4 py-3 text-left font-body text-sm text-ink-2" style={{ background: "var(--surface)" }}>
            couldn&apos;t wake the shelf. tap to try again.
          </button>
        )}

        {empty ? (
          <div className="flex h-[60dvh] flex-col items-center justify-center gap-6 px-8 text-center">
            <div>
              <p className="font-display text-2xl leading-tight text-ink text-balance">paste anything. scroll it in.</p>
              <p className="mt-2 font-body text-sm text-ink-2">a question, a link, a wall of text — try one:</p>
            </div>
            <div className="flex w-full flex-col items-stretch gap-2">
              {chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => openSheet(c.fill)}
                  className="truncate rounded-full px-4 py-2.5 font-body text-sm text-ink"
                  style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4">
            {sessions.map((s) => (
              <SessionTile key={s.id} session={s} onMenu={setMenuFor} />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setHow(true)}
          className="mx-auto mt-7 block font-body text-sm text-ink-2"
          style={{ textDecoration: "underline", textDecorationColor: "var(--line)", textUnderlineOffset: 4 }}
        >
          how this works
        </button>
      </div>

      <motion.button
        type="button"
        aria-label="new session"
        onClick={() => openSheet()}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={spring}
        className="fixed right-5 z-40 flex h-16 w-16 items-center justify-center rounded-full font-display text-3xl leading-none shadow-xl"
        style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 8px)", background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 12px 40px var(--accent-soft)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </motion.button>

      <NewSessionSheet open={sheet} seed={seed} onClose={() => { setSheet(false); setSeed(null); }} />
      <HowItWorksSheet open={how} onClose={() => setHow(false)} />
      <SessionMenuSheet
        session={menuFor}
        onClose={() => setMenuFor(null)}
        onChanged={refresh}
        onHowItWorks={() => { setMenuFor(null); setHow(true); }}
      />
    </div>
  );
}
