"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { FrontierPublic, GenerateData, ListCardsData } from "@/lib/api/contract";
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
 *       wrapped     → TERMINAL: the reader ended the thread. there is nothing left to ask for
 *       awaiting_choice → TERMINAL: a fork is parked on them; their tap is what restarts the loop
 *   - offline: no calls; retries on the `online` event
 *
 * Every generate response also carries the frontier the writer stood at when it answered, so the
 * timeline is fed by work the client was already doing. Nothing here polls for it.
 *
 * The caller decides WHEN to pump (runway ≤ 4) via `wantMore`; this hook owns
 * HOW. staticMode disables all network.
 */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];
const SUPERSEDED_RETRY_MS = 300;
const BUDGET_RETRY_CAP_MS = 60 * 60_000;

export type FillState = "idle" | "pending" | "failed";

/**
 * Reasons the deck stops here and staying quiet is the correct answer: the thread was wrapped on
 * request, or a crossroads is parked on the reader. Both used to fall into the generic backoff and
 * were harmless only by accident — the retries were pointless, not wrong.
 */
export const TERMINAL_REASONS = ["wrapped", "awaiting_choice"] as const;
export type TerminalReason = (typeof TERMINAL_REASONS)[number];
const isTerminal = (reason: string | null): reason is TerminalReason =>
  (TERMINAL_REASONS as readonly string[]).includes(reason ?? "");

const PSEUDO_REASONS = new Set(["runway_full", "budget", "superseded", "pending_plan", ...TERMINAL_REASONS]);

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

/**
 * What a generate response means for the loop — the ONE place "do we ask again, and when" is
 * decided, so the answer is readable and unit-testable instead of buried in a chain of else-ifs.
 *
 *   fresh    → cards landed; the caller's runway effect decides whether to ask again
 *   terminal → stop. nothing changes until the reader does something
 *   wait     → nothing is wrong, we just know when to ask again (the daily cap resets at midnight)
 *   again    → our own dial/re-plan invalidated that batch; ask straight back, it isn't a failure
 *   backoff  → nothing new yet: 2s → 4s → 8s → 15s
 *
 * Pure + unit-tested (tests/feed.pump.test.ts).
 */
export type PumpOutcome =
  | { kind: "fresh" }
  | { kind: "terminal"; reason: TerminalReason }
  | { kind: "wait"; ms: number }
  | { kind: "again"; ms: number }
  | { kind: "backoff" };

export function pumpOutcome(reason: string | null, fresh: number, now = Date.now()): PumpOutcome {
  if (fresh > 0) return { kind: "fresh" };
  if (isTerminal(reason)) return { kind: "terminal", reason };
  if (reason === "budget") return { kind: "wait", ms: msUntilUtcMidnight(now) };
  if (reason === "superseded") return { kind: "again", ms: SUPERSEDED_RETRY_MS };
  return { kind: "backoff" };
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
  // the frontier the last generate answered with — the timeline's live count, arriving on a request
  // the feed was making anyway. A response that couldn't count it says null, and "we didn't look"
  // is not news: we keep the last count we were given rather than blanking the bar.
  const [frontier, setFrontier] = useState<FrontierPublic | null>(null);
  const [terminal, setTerminal] = useState<TerminalReason | null>(null);

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
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;

  const mergeIn = useCallback((incoming: CardRow[]): number => {
    if (incoming.length === 0) return 0;
    const known = new Set(cardsRef.current.map((c) => c.id));
    const fresh = incoming.filter((c) => !known.has(c.id)).length;
    setCards((prev) => mergeCards(prev, incoming));
    // a card arriving from anywhere — a batch, a detour splice, a crossroads pick — means the
    // thread moved, so whatever terminal answer we were sitting on stopped being true
    if (fresh > 0) setTerminal(null);
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

  /**
   * Ask for more. `forced` marks the asks a reader action caused (a fork answered, a dial, a tap on
   * a fallback) — those go through even from a terminal state, because that action is exactly what
   * changes the answer. The automatic ones (runway pressure, the retry timer, coming back online)
   * stay quiet: scrolling into the end of a wrapped deck must not re-ask forever.
   */
  const pump = useCallback(async (forced = false) => {
    if (!enabledRef.current || inFlight.current) return;
    if (terminalRef.current) {
      if (!forced) return;
      // a forced ask IS the reader doing the thing that unsticks the deck, so the old answer is void
      // from here — otherwise a "nothing yet" reply would schedule a retry that the stale terminal
      // then swallows, and the feed would sit waiting for a second tap that never comes
      terminalRef.current = null;
      setTerminal(null);
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOnline(false);
      return;
    }
    inFlight.current = true;
    setFill("pending");
    try {
      let got: CardRow[] = [];
      let reason: string | null = null;
      let counted: FrontierPublic | null = null;
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
        counted = res.frontier ?? null;
      }
      const fresh = mergeIn(got);
      setFill("idle");
      if (counted) setFrontier(counted);
      const outcome = pumpOutcome(reason, fresh);
      if (outcome.kind === "fresh") {
        failures.current = 0; // caller's runway effect re-pumps if still short
      } else if (outcome.kind === "terminal") {
        failures.current = 0; // nothing failed here — the deck simply ends, and asking again can't move it
        setTerminal(outcome.reason);
      } else if (outcome.kind === "wait") {
        failures.current = 0;
        schedule(outcome.ms); // nothing more today; the feed shows the budget notice, no catching-up tail
      } else if (outcome.kind === "again") {
        schedule(outcome.ms); // our own dial/re-plan invalidated that batch — ask again right away
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
    // a full re-sync follows a dial / re-plan / status flip: the runway we were told was over may
    // not be the runway that exists now, so the loop gets to ask again
    setTerminal(null);
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
    () => ({
      cards, setCards, mergeIn, patchCard, fill, frontier, terminal, online, setWantMore,
      // every pump the feed asks for by name is a reader action; those are allowed out of a terminal state
      pump: () => void pumpRef.current(true),
      refetchAll,
    }),
    [cards, mergeIn, patchCard, fill, frontier, terminal, online, setWantMore, refetchAll],
  );
}
