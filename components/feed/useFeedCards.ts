"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { GenerateData, ListCardsData } from "@/lib/api/contract";
import type { CardRow } from "@/lib/schemas/session";
import { mergeCards, sortCards } from "@/lib/feed/slides";

/**
 * Cards state + the buffered generation loop (spec §6.2, §12).
 *
 *   - keeps the local card list merged by id and sorted by idx
 *   - `pump()` fills runway: first drains cards the server already has
 *     (GET /cards?after=), then POST /generate. Never more than one in flight.
 *   - empty/failed responses back off 2s → 4s → 8s → 15s (cap) and retry
 *   - a `done` batch with no cards carries a `reason` (lib/api/contract.ts):
 *       runway_full → the server counts ≥16 unviewed rows: land viewed marks (onRunwayFull),
 *                     then retry ONCE immediately — no backoff, no catching-up card unless
 *                     the runway is truly empty
 *       budget      → today's cap is hit: stop asking until the UTC day rolls over
 *       superseded  → the batch was invalidated by a dial/re-plan mid-flight: ask again soon
 *       pending_plan→ a re-plan is running: normal backoff, the feed's replan watch resyncs
 *   - offline: no calls; retries on the `online` event
 *
 * The caller decides WHEN to pump (runway ≤ 4) via `wantMore`; this hook owns
 * HOW. staticMode disables all network.
 */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];
const SUPERSEDED_RETRY_MS = 300;
const BUDGET_RETRY_CAP_MS = 60 * 60_000;

export type FillState = "idle" | "pending" | "failed";

const PSEUDO_REASONS = new Set(["runway_full", "budget", "superseded", "pending_plan"]);

/** Why a batch carried nothing new — batch.reason, or inferred from the pseudo batch id (older servers). */
export function batchReason(res: GenerateData): string | null {
  if (res.batch.reason) return res.batch.reason;
  if (PSEUDO_REASONS.has(res.batch.id)) return res.batch.id;
  return null;
}

/** ms until the next UTC midnight (the daily cap resets then), capped so a sleeping tab still re-checks. */
export function msUntilUtcMidnight(now = Date.now(), cap = BUDGET_RETRY_CAP_MS): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1_000, Math.min(cap, next - now));
}

export function useFeedCards({
  sessionId,
  initialCards,
  initialHasMore,
  enabled,
  staticMode,
  beforeGenerate,
  onRunwayFull,
}: {
  sessionId: string;
  initialCards: CardRow[];
  /** The server had more cards than initialCards (resume deep in a session). */
  initialHasMore: boolean;
  /** Session is active → generation allowed. */
  enabled: boolean;
  staticMode: boolean;
  /** Awaited right before POST /generate — the feed flushes viewed/position so the server's runway math is current. */
  beforeGenerate?: () => Promise<void>;
  /** The server answered runway_full: post `viewed` for everything at/before the active position, then we retry once. */
  onRunwayFull?: () => Promise<void>;
}) {
  const [cards, setCards] = useState<CardRow[]>(() => sortCards(initialCards));
  const [fill, setFill] = useState<FillState>("idle");
  const [online, setOnline] = useState(true);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const inFlight = useRef(false);
  const failures = useRef(0);
  const timer = useRef<number | null>(null);
  const wantMore = useRef(false);
  const serverHasMore = useRef(initialHasMore);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled && !staticMode;
  const beforeGenerateRef = useRef(beforeGenerate);
  beforeGenerateRef.current = beforeGenerate;
  const onRunwayFullRef = useRef(onRunwayFull);
  onRunwayFullRef.current = onRunwayFull;

  const mergeIn = useCallback((incoming: CardRow[]): number => {
    if (incoming.length === 0) return 0;
    const known = new Set(cardsRef.current.map((c) => c.id));
    const fresh = incoming.filter((c) => !known.has(c.id)).length;
    setCards((prev) => mergeCards(prev, incoming));
    return fresh;
  }, []);

  const patchCard = useCallback((id: string, patch: Partial<CardRow>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const lastIdx = useCallback(() => {
    const cs = cardsRef.current;
    return cs.length ? cs[cs.length - 1].idx : null;
  }, []);

  const schedule = useCallback((ms: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (wantMore.current) void pumpRef.current();
    }, ms);
  }, []);

  const backoff = useCallback(() => {
    failures.current += 1;
    schedule(BACKOFF_MS[Math.min(failures.current - 1, BACKOFF_MS.length - 1)]);
  }, [schedule]);

  const pump = useCallback(async () => {
    if (!enabledRef.current || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOnline(false);
      return;
    }
    inFlight.current = true;
    setFill("pending");
    try {
      let got: CardRow[] = [];
      let reason: string | null = null;
      if (serverHasMore.current) {
        const after = lastIdx();
        const qs = new URLSearchParams({ limit: "24" });
        if (after) qs.set("after", after);
        const res = await api.get<ListCardsData>(`/api/sessions/${sessionId}/cards?${qs}`);
        serverHasMore.current = res.hasMore;
        got = res.cards;
      }
      if (got.length === 0) {
        await beforeGenerateRef.current?.().catch(() => {});
        let res = await api.post<GenerateData>(`/api/sessions/${sessionId}/generate`, { after: lastIdx() });
        reason = batchReason(res);
        if (reason === "runway_full" && res.cards.length === 0) {
          // the server thinks ≥16 rows are unviewed: land our viewed marks and ask exactly once more
          await onRunwayFullRef.current?.().catch(() => {});
          res = await api.post<GenerateData>(`/api/sessions/${sessionId}/generate`, { after: lastIdx() });
          reason = batchReason(res);
        }
        got = res.cards;
      }
      const fresh = mergeIn(got);
      setFill("idle");
      if (fresh > 0) {
        failures.current = 0;
        // caller's runway effect re-pumps if still short
      } else if (reason === "budget") {
        failures.current = 0;
        schedule(msUntilUtcMidnight()); // nothing more today; the feed shows the budget notice, no catching-up tail
      } else if (reason === "superseded") {
        schedule(SUPERSEDED_RETRY_MS); // our own dial/re-plan invalidated that batch — ask again right away
      } else {
        // pending batch elsewhere / runway still full / nothing new yet → back off and ask again
        backoff();
      }
    } catch {
      setFill("failed");
      backoff();
    } finally {
      inFlight.current = false;
    }
  }, [sessionId, lastIdx, mergeIn, schedule, backoff]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  /** Tell the loop whether the feed is short on runway; pumps immediately when true. */
  const setWantMore = useCallback((want: boolean) => {
    wantMore.current = want;
    if (want) void pumpRef.current();
    else clearTimer();
  }, []);

  /** Full re-sync from the server (status flip, refresh, re-plan). Prunes local rows the server no longer has. */
  const refetchAll = useCallback(async () => {
    if (staticMode) return;
    const res = await api.get<ListCardsData>(`/api/sessions/${sessionId}/cards?limit=100`);
    serverHasMore.current = res.hasMore;
    // the server is the truth for the window it returned (a re-plan may have dropped unviewed
    // runway); local rows beyond that window survive only if the server says there is more
    const serverIds = new Set(res.cards.map((c) => c.id));
    const lastServerIdx = res.cards.length ? res.cards[res.cards.length - 1].idx : null;
    setCards((prev) => {
      const beyond = prev.filter((c) => !serverIds.has(c.id) && res.hasMore && lastServerIdx !== null && c.idx > lastServerIdx);
      return mergeCards(beyond, res.cards);
    });
    failures.current = 0;
  }, [sessionId, staticMode]);

  // online / offline
  useEffect(() => {
    if (staticMode) return;
    const onOnline = () => {
      setOnline(true);
      failures.current = 0;
      if (wantMore.current) void pumpRef.current();
    };
    const onOffline = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimer();
    };
  }, [staticMode]);

  // status flip → allowed now → pump if wanted
  useEffect(() => {
    if (enabled && !staticMode && wantMore.current) void pumpRef.current();
  }, [enabled, staticMode]);

  return useMemo(
    () => ({ cards, setCards, mergeIn, patchCard, fill, online, setWantMore, pump: () => void pumpRef.current(), refetchAll }),
    [cards, mergeIn, patchCard, fill, online, setWantMore, refetchAll],
  );
}
