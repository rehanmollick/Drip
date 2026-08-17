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
 *   - offline: no calls; retries on the `online` event
 *
 * The caller decides WHEN to pump (runway ≤ 4) via `wantMore`; this hook owns
 * HOW. staticMode disables all network.
 */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];

export type FillState = "idle" | "pending" | "failed";

export function useFeedCards({
  sessionId,
  initialCards,
  initialHasMore,
  enabled,
  staticMode,
}: {
  sessionId: string;
  initialCards: CardRow[];
  /** The server had more cards than initialCards (resume deep in a session). */
  initialHasMore: boolean;
  /** Session is active → generation allowed. */
  enabled: boolean;
  staticMode: boolean;
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
      if (serverHasMore.current) {
        const after = lastIdx();
        const qs = new URLSearchParams({ limit: "24" });
        if (after) qs.set("after", after);
        const res = await api.get<ListCardsData>(`/api/sessions/${sessionId}/cards?${qs}`);
        serverHasMore.current = res.hasMore;
        got = res.cards;
      }
      if (got.length === 0) {
        const res = await api.post<GenerateData>(`/api/sessions/${sessionId}/generate`, { after: lastIdx() });
        got = res.cards;
      }
      const fresh = mergeIn(got);
      setFill("idle");
      if (fresh > 0) {
        failures.current = 0;
        // caller's runway effect re-pumps if still short
      } else {
        // pending batch elsewhere / nothing new yet → back off and ask again
        failures.current += 1;
        schedule(BACKOFF_MS[Math.min(failures.current - 1, BACKOFF_MS.length - 1)]);
      }
    } catch {
      setFill("failed");
      failures.current += 1;
      schedule(BACKOFF_MS[Math.min(failures.current - 1, BACKOFF_MS.length - 1)]);
    } finally {
      inFlight.current = false;
    }
  }, [sessionId, lastIdx, mergeIn, schedule]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  /** Tell the loop whether the feed is short on runway; pumps immediately when true. */
  const setWantMore = useCallback((want: boolean) => {
    wantMore.current = want;
    if (want) void pumpRef.current();
    else clearTimer();
  }, []);

  /** Full re-sync from the server (status flip, refresh, re-plan). */
  const refetchAll = useCallback(async () => {
    if (staticMode) return;
    const res = await api.get<ListCardsData>(`/api/sessions/${sessionId}/cards?limit=100`);
    serverHasMore.current = res.hasMore;
    setCards((prev) => mergeCards(prev, res.cards));
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
