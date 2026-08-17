"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import type { SessionPublic } from "@/lib/api/contract";
import { SHELL_THEME } from "@/lib/theme/defaults";
import { ThemeRoot, useTheme } from "@/components/theme/ThemeRoot";
import { NewSessionSheet } from "./NewSessionSheet";
import { SessionMenuSheet } from "./SessionMenuSheet";
import { SessionTile } from "./SessionTile";
import { Splash } from "./Splash";

/**
 * HOME (spec §2): session grid + big "+". Supabase cold-start rule: the list
 * query retries once after 3s while the shell splash shows (not an error).
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

  if (q.isPending) return <Splash className="h-full w-full" />;

  const sessions = (q.data ?? []).filter((s) => s.status !== "archived");
  const empty = !q.isError && sessions.length === 0;

  return (
    <div className="relative h-full w-full">
      <div className="h-full overflow-y-auto" style={{ overscrollBehaviorY: "contain", paddingTop: "max(env(safe-area-inset-top), 16px)", paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 96px)" }}>
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
          <div className="flex h-[60dvh] flex-col items-center justify-center px-8 text-center">
            <p className="font-display text-2xl leading-tight text-ink text-balance">paste anything. scroll it in.</p>
            <p className="mt-2 font-body text-sm text-ink-2">tap + to start.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 px-4">
            {sessions.map((s) => (
              <SessionTile key={s.id} session={s} onMenu={setMenuFor} />
            ))}
          </div>
        )}
      </div>

      <motion.button
        type="button"
        aria-label="new session"
        onClick={() => setSheet(true)}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={spring}
        className="fixed right-5 z-40 flex h-16 w-16 items-center justify-center rounded-full font-display text-3xl leading-none shadow-xl"
        style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 8px)", background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 12px 40px var(--accent-soft)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </motion.button>

      <NewSessionSheet open={sheet} onClose={() => setSheet(false)} />
      <SessionMenuSheet session={menuFor} onClose={() => setMenuFor(null)} onChanged={refresh} />
    </div>
  );
}
