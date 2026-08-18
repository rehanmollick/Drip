"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AskSheet } from "@/components/ask/AskBar";
import { InlineBubble } from "@/components/ask/InlineBubble";
import type { InteractResult, Slide } from "@/components/cards/types";
import { ThemeRoot } from "@/components/theme/ThemeRoot";
import { api, ApiClientError } from "@/lib/api/client";
import type { z } from "zod";
import type { AskData, FrontierPublic, InteractBody, InteractData, OpenFeedback, SessionPublic } from "@/lib/api/contract";
import type { ChooseData as ChooseDataSchema, DialData as DialDataSchema, GetSessionData as GetSessionDataSchema, RetrySessionData as RetrySessionDataSchema } from "@/lib/api/contract";
import { ticks } from "@/lib/audio/ticks";
import { DwellClock } from "@/lib/dwell";
import { sessionMap } from "@/lib/feed/map";
import type { PseudoKind } from "@/lib/feed/notices";
import { Outbox } from "@/lib/feed/outbox";
import { buildSlides, isPseudoKey, nextPin, runwayAhead, type Pin } from "@/lib/feed/placeholder";
import { calledIt, streakBefore } from "@/lib/feed/progress";
import { dropUnviewedAfter, isRowSlide, isTodayUtc, ordinalOf, toSlides } from "@/lib/feed/slides";
import { timelineModel, type FrontierLike } from "@/lib/feed/timeline";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { SHELL_THEME } from "@/lib/theme/defaults";
import { AskPill, BackChevron } from "./Chrome";
import { FeedSlide, type CrossroadsChoice, type SlideHandlers } from "./FeedSlide";
import { SessionMapSheet } from "./SessionMapSheet";
import { SwipeNudge } from "./SwipeNudge";
import { Timeline } from "./Timeline";
import { Toast } from "./Toast";
import { useFeedCards } from "./useFeedCards";

type GetSessionData = z.infer<typeof GetSessionDataSchema>;
type DialData = z.infer<typeof DialDataSchema>;
type RetrySessionData = z.infer<typeof RetrySessionDataSchema>;
type ChooseData = z.infer<typeof ChooseDataSchema>;

const RUNWAY_TARGET_LOW = 4;   // request the next batch at or below this
const WINDOW = 3;              // slides rendered on either side of the active one
const CHROME_REST_MS = 400;
const TOPIC_LABEL_MS = 2_000;  // "now: <topic>" fades in and back out over ~2s
const TOAST_MS = 2_200;
const POSITION_THROTTLE_MS = 1_000;
const PLANNING_POLL_MS = 1_500;
const REPLAN_POLL_MS = 1_000;  // D3: after the last clarifier answer, watch the session at 1s
const REPLAN_MAX_WAIT_MS = 8_000;

/**
 * The fresher of two counts of the same feed. Both are taken against a runway epoch, and a dial or
 * a re-plan bumps that epoch precisely because it deleted rows the older count still believes in —
 * so the newer epoch wins outright, and an equal one goes to the generate response, which was
 * counted after the session was read, never before.
 */
function fresherCount(fromSession: FrontierPublic | null, fromGenerate: FrontierPublic | null): FrontierPublic | null {
  if (!fromSession) return fromGenerate;
  if (!fromGenerate) return fromSession;
  return fromGenerate.epoch >= fromSession.epoch ? fromGenerate : fromSession;
}

export type FeedProps = {
  session: SessionPublic;
  initialCards: CardRow[];
  /** No network at all: dev showcase / Playwright fixtures. Interactions are local. */
  staticMode?: boolean;
};

/**
 * THE FEED (spec §2, §5, §6.2, §7, §8, §12). Snap-scrolling slides, buffered
 * runway, dwell + viewed reporting, dials, ask/detours, in-feed notices.
 * Card views are rendered by components/cards; this component owns scroll,
 * visibility, persistence and adaptation plumbing.
 */
export function Feed({ session: initialSession, initialCards, staticMode = false }: FeedProps) {
  const qc = useQueryClient();
  const sessionId = initialSession.id;

  // ── replan watch (D3): set when the last clarifier is answered; cleared once the server's re-plan
  //    landed (pendingReplan false + epoch moved) or REPLAN_MAX_WAIT_MS passed, and we re-synced.
  const [replanning, setReplanning] = useState<{ epochBefore: number; startedAt: number } | null>(null);
  const replanningRef = useRef(replanning);
  replanningRef.current = replanning;

  // ── session ─────────────────────────────────────────────────────────────
  // Two polls, both bounded, both for a state change only the SERVER can announce: it is still
  // planning, or it is re-planning behind our backs. Everything else the feed needs from the
  // session arrives on requests it is already making — every generate response carries the
  // frontier, every dial/choose response carries the session — so there is nothing here on a clock
  // for the timeline. A frontier poll costs a full card scan plus two session reads per tick, per
  // reader, forever, to learn what the next POST would have said anyway.
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => (await api.get<GetSessionData>(`/api/sessions/${sessionId}`)).session,
    initialData: initialSession,
    enabled: !staticMode,
    refetchInterval: (q) => {
      if (staticMode) return false;
      const d = q.state.data;
      if (d?.status === "planning") return PLANNING_POLL_MS;
      if (replanningRef.current || d?.progress?.pendingReplan) return REPLAN_POLL_MS;
      return false;
    },
    staleTime: 10_000,
  });
  const session = sessionQuery.data ?? initialSession;
  const status = session.status;
  const active = status === "active" || status === "archived";
  // a crossroads card is the frontier: generation stops dead until the reader picks a direction.
  // No pump, no "catching up" tail — the deck ends here on purpose (their ask: stop autogenerating).
  const awaitingChoice = !!session.progress?.awaitingChoice;

  // ── cards + generation loop ─────────────────────────────────────────────
  const syncBeforeGenerate = useRef<() => Promise<void>>(async () => {});
  const landViewedUpToHere = useRef<() => Promise<void>>(async () => {});
  const feed = useFeedCards({
    sessionId,
    initialCards,
    initialHasMore: initialCards.length < (initialSession.cardCount ?? 0),
    enabled: active && !awaitingChoice,
    staticMode,
    beforeGenerate: () => syncBeforeGenerate.current(),
    onRunwayFull: () => landViewedUpToHere.current(),
  });
  const { cards, mergeIn, patchCard, setCards, fill, frontier: counted, terminal, online, setWantMore, pump, refetchAll } = feed;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // status flip planning → active: pull the real cards, theme re-applies via session.theme
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current !== "active" && status === "active" && !staticMode) void refetchAll().catch(() => {});
    prevStatus.current = status;
  }, [status, staticMode, refetchAll]);

  // epoch (D1/D2): the server bumps progress.epoch whenever it drops the unviewed runway (dial,
  // re-plan, chill toggle). Whenever we learn of a newer epoch than the one we last synced to,
  // re-pull the cards so ghost rows the server no longer has get pruned. Our own dial pre-marks
  // the epoch it returned (we already mirrored the drop); the replan watch below does its own sync.
  const seenEpoch = useRef(initialSession.progress?.epoch ?? 0);
  const epoch = session.progress?.epoch ?? 0;
  useEffect(() => {
    if (staticMode || epoch <= seenEpoch.current) return;
    seenEpoch.current = epoch;
    if (replanningRef.current) return;
    void refetchAll().catch(() => {});
  }, [epoch, staticMode, refetchAll]);

  // replan watch (D3): once the last clarifier is answered the server re-plans; poll the session
  // until pendingReplan clears AND the epoch moved (or REPLAN_MAX_WAIT_MS pass), then re-sync and
  // prune whatever the server dropped. Meanwhile the unviewed runway is hidden (rowSlides) and a
  // themed "shaping your feed…" tail sits after the last viewed card.
  const pendingReplan = !!session.progress?.pendingReplan;
  useEffect(() => {
    if (!replanning || staticMode) return;
    let cancelled = false;
    const finish = () => {
      seenEpoch.current = Math.max(seenEpoch.current, epoch);
      void refetchAll()
        .catch(() => {})
        .finally(() => { if (!cancelled) setReplanning(null); });
    };
    if (!pendingReplan && epoch > replanning.epochBefore) {
      finish();
      return () => { cancelled = true; };
    }
    const left = REPLAN_MAX_WAIT_MS - (Date.now() - replanning.startedAt);
    const t = window.setTimeout(finish, Math.max(0, left));
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [replanning, staticMode, epoch, pendingReplan, refetchAll]);

  // teasers (D5): while planning the engine may already have written a couple of cards — show them
  // behind the planning notice instead of one static screen for the whole plan.
  const teaserFetch = useRef(false);
  const cardCount = session.cardCount ?? 0;
  useEffect(() => {
    if (staticMode || status !== "planning" || teaserFetch.current) return;
    if (cardCount <= cardsRef.current.length) return;
    teaserFetch.current = true;
    refetchAll()
      .catch(() => {})
      .finally(() => { teaserFetch.current = false; });
  }, [staticMode, status, cardCount, refetchAll]);

  // ── slides ──────────────────────────────────────────────────────────────
  // While a re-plan is pending the server drops every unviewed row; hide ours right away so the
  // user can't scroll into cards that are about to vanish (viewed history stays — it's history).
  const rowSlides = useMemo(() => toSlides(replanning ? cards.filter((c) => c.viewedAt !== null) : cards), [cards, replanning]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [entered, setEntered] = useState<Set<string>>(() => new Set());
  const [scrolling, setScrolling] = useState(false);
  const scrollingRef = useRef(false);

  const activeIndexRef = useRef(0);
  const slidesRef = useRef<Slide[]>([]);

  // ── the pin (bug 5) ──────────────────────────────────────────────────────
  // Whatever pseudo the reader is standing on keeps its key AND its slot until they scroll off it
  // and the scroll settles. Cards that land while they wait go after it — whatever idx they carry —
  // and nothing is ever swapped into the slot under their thumb.
  const pinRef = useRef<Pin | null>(null);
  pinRef.current = nextPin(pinRef.current, { activeKey, slides: slidesRef.current, settled: !scrolling });
  const pin = pinRef.current;

  // the head placeholder is "reading your stuff…" for the whole wait: it stays until real cards are
  // actually in hand, so status flipping to active mid-wait can never swap it for "catching up…".
  const everPlanned = useRef(initialSession.status === "planning");
  if (status === "planning") everPlanned.current = true;
  const head: PseudoKind | null =
    status === "planning" ? "planning"
    : status === "error" ? "error"
    : !replanning && active && everPlanned.current && rowSlides.length === 0 ? "planning"
    : null;

  // real-card slides still ahead of the reader (measured from the pin when they're on a placeholder)
  const runway = useMemo(() => {
    const n = runwayAhead({ rowSlides, activeKey, pin });
    return n ?? Math.max(0, rowSlides.length - 1 - activeIndexRef.current);
  }, [rowSlides, activeKey, pin]);

  // today's budget notice at the end of the deck means nothing more is coming until midnight —
  // no "on its way" tail behind it (the notice itself says when it resets)
  const budgetCapped = useMemo(() => {
    const last = cards[cards.length - 1];
    if (!last) return false;
    const p = last.payload as Card;
    return p.type === "notice" && p.kind === "budget" && isTodayUtc(last.createdAt);
  }, [cards]);

  const tail: PseudoKind | null = useMemo(() => {
    if (!active || staticMode) return null;
    if (replanning) return "replanning";
    if (awaitingChoice) return null;   // the crossroads IS the end of the deck until they pick
    if (head === "planning") return null; // one placeholder at a time — never two waits in a row
    if (runway > 0) return null;
    // the thread was wrapped on request: nothing is catching up, and a tail promising otherwise
    // would undo the ending the reader just asked for
    if (terminal === "wrapped") return null;
    if (!online) return "offline";
    if (budgetCapped) return null;
    return "catching_up"; // a generate is pending / scheduled — never an error string
  }, [active, staticMode, replanning, awaitingChoice, head, runway, terminal, online, budgetCapped]);

  const slides: Slide[] = useMemo(() => buildSlides({ head, rowSlides, tail, pin }), [head, rowSlides, tail, pin]);
  slidesRef.current = slides;

  // If the active key vanished (a pseudo tail replaced by real cards) keep the last index: never jump.
  const foundIndex = activeKey ? slides.findIndex((s) => s.key === activeKey) : -1;
  const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(activeIndexRef.current, Math.max(0, slides.length - 1));
  activeIndexRef.current = activeIndex;
  const activeSlide = slides[activeIndex];
  const activeRowId = activeSlide && isRowSlide(activeSlide) ? activeSlide.rowId : null;
  const activeRowIdRef = useRef<string | null>(null);
  activeRowIdRef.current = activeRowId;

  // ask for more whenever runway is short (pump is idempotent + backoff-aware). Keyed on the slide
  // count too: a one-card batch landing on the tail hands the active key over and leaves `runway`
  // numerically unchanged (0 → 0) — the deck still grew, so ask again. Never during a re-plan.
  const rowCount = rowSlides.length;
  useEffect(() => {
    if (!active || staticMode) return;
    setWantMore(!replanning && !awaitingChoice && runway <= RUNWAY_TARGET_LOW);
  }, [runway, rowCount, replanning, awaitingChoice, active, staticMode, setWantMore]);

  // ── visibility: IntersectionObserver @ 0.6 ──────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elKeys = useRef(new Map<Element, string>());
  const pendingObserve = useRef<Array<[HTMLElement, string]>>([]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        let best: { key: string; ratio: number } | null = null;
        for (const e of entries) {
          const key = elKeys.current.get(e.target);
          if (!key) continue;
          if (e.isIntersecting && e.intersectionRatio >= 0.6 && (!best || e.intersectionRatio > best.ratio)) best = { key, ratio: e.intersectionRatio };
        }
        if (best) {
          const k = best.key;
          setEntered((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
          setActiveKey(k);
        }
      },
      { root, threshold: [0.6] },
    );
    observerRef.current = io;
    for (const [el, key] of pendingObserve.current) elKeys.current.set(el, key);
    pendingObserve.current = [];
    // (re)observe everything registered so far — slides may have mounted before the observer existed
    for (const el of elKeys.current.keys()) io.observe(el);
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, []);

  const observe = useCallback((el: HTMLElement | null, key: string) => {
    if (el) {
      const io = observerRef.current;
      if (io) {
        elKeys.current.set(el, key);
        io.observe(el);
      } else pendingObserve.current.push([el, key]);
    } else {
      for (const [node, k] of elKeys.current) {
        if (k === key) {
          observerRef.current?.unobserve(node);
          elKeys.current.delete(node);
        }
      }
    }
  }, []);

  // ── scroll helpers ──────────────────────────────────────────────────────
  const restTimer = useRef<number | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const scrollToIndex = useCallback((i: number, smooth: boolean) => {
    const root = containerRef.current;
    if (!root) return;
    const top = Math.max(0, i) * root.clientHeight;
    root.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // resume position on mount (only when the feed is real and active)
  const resumed = useRef(false);
  useLayoutEffect(() => {
    if (resumed.current || staticMode || !active) return;
    resumed.current = true;
    const pos = initialSession.position;
    if (pos > 0) {
      const target = cardsRef.current[Math.min(pos, cardsRef.current.length - 1)];
      const idx = target ? slidesRef.current.findIndex((s) => isRowSlide(s) && s.rowId === target.id) : -1;
      if (idx > 0) {
        scrollToIndex(idx, false);
        setActiveKey(slidesRef.current[idx].key);
        setEntered((p) => new Set(p).add(slidesRef.current[idx].key));
      }
    }
  }, [staticMode, active, initialSession.position, scrollToIndex]);

  // Keep THE SAME SLIDE under the thumb whenever the list changes shape (the container has
  // overflow-anchor: none, so the browser never does this for us). Cards landing above the active
  // slide, the pin being released above it — the reader must not feel any of it. Never while a
  // scroll is in flight: we'd be yanking a moving thumb.
  const lastActiveIndex = useRef(activeIndex);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root || scrollingRef.current) {
      lastActiveIndex.current = activeIndex;
      return;
    }
    if (foundIndex < 0 && isPseudoKey(activeKey)) {
      // safety net: a pinned pseudo should never vanish under the reader, but if it somehow does,
      // adopt whatever now sits at that index rather than teleporting them somewhere else
      const landed = slides[activeIndex];
      if (landed) {
        setActiveKey(landed.key);
        setEntered((p) => (p.has(landed.key) ? p : new Set(p).add(landed.key)));
        root.scrollTo({ top: activeIndex * root.clientHeight });
      }
      lastActiveIndex.current = activeIndex;
      return;
    }
    if (foundIndex >= 0 && lastActiveIndex.current !== foundIndex) {
      root.scrollTo({ top: foundIndex * root.clientHeight });
    }
    lastActiveIndex.current = activeIndex;
  }, [activeIndex, foundIndex, activeKey, slides]);

  // ── chrome fade on scroll ───────────────────────────────────────────────
  const onScroll = useCallback(() => {
    if (!scrollingRef.current) {
      scrollingRef.current = true;
      setScrolling(true);
    }
    setBubble(null);
    if (restTimer.current) window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => {
      scrollingRef.current = false;
      setScrolling(false);
    }, CHROME_REST_MS);
  }, []);
  useEffect(() => () => { if (restTimer.current) window.clearTimeout(restTimer.current); }, []);

  // ── sound ───────────────────────────────────────────────────────────────
  useEffect(() => {
    ticks.enable(!!session.settings?.soundOn);
  }, [session.settings?.soundOn]);

  // ── toast ───────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // ── network helpers (no-ops in static mode) ─────────────────────────────
  const post = useCallback(
    async <T,>(url: string, body: unknown): Promise<T | null> => {
      if (staticMode) return null;
      return api.post<T>(url, body);
    },
    [staticMode],
  );

  // Interacts that fail (offline, blip) wait in an outbox and drain on `online` / before the next
  // generate: the server's runway math counts unviewed rows, so `viewed` must eventually land.
  // A report that can never land (404: the server dropped that card under a dial / re-plan) is
  // discarded and the ghost row pruned — it must never block the reports queued behind it.
  // rows the SERVER has confirmed viewed (initial rows + successful interacts). `viewedSent` below is
  // what we've reported/queued; the gap between the two is what runway_full re-sends (D6).
  const viewedConfirmed = useRef<Set<string>>(new Set(initialCards.filter((c) => c.viewedAt).map((c) => c.id)));
  const sendInteract = useCallback(
    async (rowId: string, body: InteractBody) => {
      const res = await api.post<InteractData>(`/api/cards/${rowId}/interact`, body);
      if (res?.card?.viewedAt) viewedConfirmed.current.add(rowId);
      if (res?.inserted?.length) mergeIn(res.inserted);
    },
    [mergeIn],
  );
  const sendInteractRef = useRef(sendInteract);
  sendInteractRef.current = sendInteract;
  const outbox = useRef<Outbox | null>(null);
  if (!outbox.current) {
    outbox.current = new Outbox((rowId, body) => sendInteractRef.current(rowId, body), {
      onDrop: (item, err) => {
        if (err instanceof ApiClientError && err.status === 404 && item.rowId !== activeRowIdRef.current) {
          // the server no longer has this card — neither should we (unless the user is looking at it)
          setCards((prev) => (prev.some((c) => c.id === item.rowId) ? prev.filter((c) => c.id !== item.rowId) : prev));
        }
      },
    });
  }
  const drainOutbox = useCallback((): Promise<void> => {
    if (staticMode) return Promise.resolve();
    return outbox.current!.drain();
  }, [staticMode]);
  // reports queued for rows we no longer have (pruned after a re-sync / dial) can only 404 — drop them
  useEffect(() => {
    const ob = outbox.current;
    if (!ob || !ob.size) return;
    ob.retain(new Set(cards.map((c) => c.id)));
  }, [cards]);
  const interact = useCallback(
    (rowId: string, body: InteractBody, keepalive = false) => {
      if (staticMode) return;
      if (keepalive) {
        try {
          void fetch(`/api/cards/${rowId}/interact`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        } catch { /* best effort */ }
        return;
      }
      // keep order: everything goes through the outbox; an empty queue sends immediately
      outbox.current!.push(rowId, body);
      void drainOutbox();
    },
    [staticMode, drainOutbox],
  );

  // ── position (throttled ~1/s, keepalive on hide) ────────────────────────
  const positionPending = useRef<number | null>(null);
  const positionTimer = useRef<number | null>(null);
  const positionSent = useRef<number>(initialSession.position);
  const flushPosition = useCallback(async (keepalive = false) => {
    const p = positionPending.current;
    if (positionTimer.current) { window.clearTimeout(positionTimer.current); positionTimer.current = null; }
    if (p === null || staticMode) return;
    if (p === positionSent.current) { positionPending.current = null; return; }
    if (keepalive) {
      positionSent.current = p;
      positionPending.current = null;
      try { void fetch(`/api/sessions/${sessionId}`, { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ position: p }) }); } catch { /* best effort */ }
      return;
    }
    try {
      await api.patch(`/api/sessions/${sessionId}`, { position: p });
      positionSent.current = p;
      if (positionPending.current === p) positionPending.current = null;
    } catch { /* stays pending; re-sent on the next report / before generate */ }
  }, [sessionId, staticMode]);
  const reportPosition = useCallback((ordinal: number) => {
    positionPending.current = ordinal;
    if (positionTimer.current !== null) return;
    positionTimer.current = window.setTimeout(() => {
      positionTimer.current = null;
      void flushPosition(false);
    }, POSITION_THROTTLE_MS);
  }, [flushPosition]);

  // Resume catch-up: rows before the saved position that the server still thinks are unviewed
  // (a lost `viewed` call, a hard close) get marked, oldest first, through the outbox.
  const caughtUp = useRef(false);
  useEffect(() => {
    if (caughtUp.current || staticMode || !active) return;
    caughtUp.current = true;
    const pos = initialSession.position;
    const stale = cardsRef.current.slice(0, pos).filter((c) => !c.viewedAt);
    if (!stale.length) return;
    for (const c of stale) {
      viewedSent.current.add(c.id);
      outbox.current!.push(c.id, { viewed: true });
    }
    void drainOutbox();
  }, [staticMode, active, initialSession.position, drainOutbox]);

  // before every generate: land what the server needs for its runway math
  syncBeforeGenerate.current = async () => {
    await Promise.all([drainOutbox(), flushPosition(false)]);
  };
  // runway_full (D6): the server counts ≥16 unviewed rows — everything at/before where the user is
  // has been seen; (re)post `viewed` for every such row the server hasn't confirmed, flush, and the
  // loop retries generate exactly once.
  landViewedUpToHere.current = async () => {
    if (staticMode) return;
    const cs = cardsRef.current;
    const ob = outbox.current!;
    const here = activeRowIdRef.current ? ordinalOf(cs, activeRowIdRef.current) : cs.length - 1;
    for (const c of cs.slice(0, here + 1)) {
      if (viewedConfirmed.current.has(c.id) || ob.hasViewed(c.id)) continue;
      viewedSent.current.add(c.id);
      if (!c.viewedAt) patchCard(c.id, { viewedAt: new Date().toISOString() });
      ob.push(c.id, { viewed: true });
    }
    await Promise.all([drainOutbox(), flushPosition(false)]);
  };
  useEffect(() => {
    if (staticMode) return;
    const onOnline = () => {
      void drainOutbox();
      void flushPosition(false);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [staticMode, drainOutbox, flushPosition]);

  // ── dwell + viewed + scroll-back (spec §8) ──────────────────────────────
  const clock = useRef<DwellClock | null>(null);
  if (!clock.current) clock.current = new DwellClock();
  const viewedSent = useRef<Set<string>>(new Set(initialCards.filter((c) => c.viewedAt).map((c) => c.id)));
  const dwellAcc = useRef(new Map<string, number>());
  const prevActive = useRef<{ rowId: string | null; ordinal: number } | null>(null);

  const flushDwell = useCallback(
    (rowId: string, ms: number, keepalive = false) => {
      const firstView = !viewedSent.current.has(rowId);
      if (!firstView && ms <= 0) return;
      viewedSent.current.add(rowId);
      const row = cardsRef.current.find((c) => c.id === rowId);
      if (row && !row.viewedAt) patchCard(rowId, { viewedAt: new Date().toISOString() });
      const body: InteractBody = { dwellMs: Math.min(60_000, Math.round(ms)) };
      if (firstView) body.viewed = true;
      interact(rowId, body, keepalive);
    },
    [interact, patchCard],
  );

  useEffect(() => {
    const c = clock.current!;
    c.attach();
    return () => c.detach();
  }, []);

  useEffect(() => {
    if (!activeKey) return;
    const c = clock.current!;
    const slide = slidesRef.current.find((s) => s.key === activeKey);
    if (!slide) return;
    const prev = prevActive.current;
    const ms = c.stop();
    const nowRowId = isRowSlide(slide) ? slide.rowId : null;
    const nowOrdinal = nowRowId ? ordinalOf(cardsRef.current, nowRowId) : prev?.ordinal ?? 0;

    if (prev?.rowId) {
      const acc = (dwellAcc.current.get(prev.rowId) ?? 0) + ms;
      if (prev.rowId !== nowRowId) {
        dwellAcc.current.delete(prev.rowId);
        flushDwell(prev.rowId, acc);
      } else {
        dwellAcc.current.set(prev.rowId, acc); // question → reveal of the same predict: one dwell
      }
    }
    if (nowRowId && prev?.rowId && nowRowId !== prev.rowId && nowOrdinal < prev.ordinal) {
      interact(nowRowId, { scrollBack: true });
    }
    if (nowRowId) {
      c.start(nowRowId);
      reportPosition(nowOrdinal);
    }
    prevActive.current = { rowId: nowRowId, ordinal: nowOrdinal };
  }, [activeKey, flushDwell, interact, reportPosition]);

  // hide/pagehide: flush what we have with keepalive, then restart the clock for the same card
  useEffect(() => {
    if (staticMode) return;
    const onHide = () => {
      const c = clock.current!;
      const rowId = c.current;
      if (rowId) {
        const ms = (dwellAcc.current.get(rowId) ?? 0) + c.stop();
        dwellAcc.current.delete(rowId);
        flushDwell(rowId, ms, true);
        c.start(rowId);
      }
      void flushPosition(true);
    };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [staticMode, flushDwell, flushPosition]);

  // ── card handlers ───────────────────────────────────────────────────────
  const [askOpen, setAskOpen] = useState(false);
  const [askAbout, setAskAbout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [topicLabel, setTopicLabel] = useState<string | null>(null);

  const onInteract = useCallback(
    (rowId: string, r: InteractResult) => {
      const row = cardsRef.current.find((c) => c.id === rowId);
      if (!row) return;
      const now = new Date().toISOString();
      const interaction = { ...(row.interaction ?? {}), ...r, at: now };
      // the server marks any interacted card viewed — mirror it so a re-plan's "unviewed goes" never hides this one
      patchCard(rowId, { interaction, viewedAt: row.viewedAt ?? now });
      if (staticMode) return;
      const body: InteractBody = { choice: r.choice, correct: r.correct, value: r.value };
      interact(rowId, body);
      const card = row.payload as Card;
      if (card.type === "clarify" && r.choice !== undefined && !replanningRef.current && session.sourceMeta?.replannedAt === undefined) {
        // D3: the tap IS the answer (one path: interact). Once every clarify card has one, the
        // server re-plans; watch the session until the new runway landed, then re-sync.
        const allAnswered = cardsRef.current
          .filter((c) => (c.payload as Card).type === "clarify")
          .every((c) => c.id === rowId || c.interaction?.choice !== undefined);
        if (allAnswered) setReplanning({ epochBefore: session.progress?.epoch ?? 0, startedAt: Date.now() });
      }
    },
    [patchCard, staticMode, interact, session.progress?.epoch, session.sourceMeta?.replannedAt],
  );

  const onDial = useCallback(
    async (rowId: string, direction: "simpler" | "deeper") => {
      const res = await post<DialData>(`/api/sessions/${sessionId}/dial`, { direction, currentCardId: rowId }).catch(() => null);
      if (!res) {
        showToast(direction === "simpler" ? "couldn't rewind that. one more tap?" : "couldn't go deeper just now. one more tap?");
        return;
      }
      // one toast, in the persona's voice (the server always sends one)
      showToast(res.toast || (direction === "simpler" ? "say less. rewinding the jargon." : "bet. going a layer deeper."));
      // mirror the server exactly: every unviewed row after this card is gone, on every thread (D1)
      setCards((prev) => dropUnviewedAfter(prev, res.removedAfter));
      seenEpoch.current = Math.max(seenEpoch.current, res.session.progress?.epoch ?? 0);
      qc.setQueryData(["session", sessionId], res.session);
      pump();
    },
    [post, sessionId, showToast, setCards, qc, pump],
  );

  /** fallback card "pull to retry": mark it seen (the server won't regenerate behind an unviewed fallback), then generate. */
  const onRetryFrom = useCallback(
    (rowId: string) => {
      if (!viewedSent.current.has(rowId)) {
        viewedSent.current.add(rowId);
        patchCard(rowId, { viewedAt: new Date().toISOString() });
        if (!staticMode) {
          outbox.current!.push(rowId, { viewed: true });
          void drainOutbox();
        }
      }
      pump();
    },
    [patchCard, staticMode, pump, drainOutbox],
  );

  const onAskAbout = useCallback(() => {
    setAskAbout(true);
    setAskOpen(true);
  }, []);
  const openAsk = useCallback(() => {
    setAskAbout(false);
    setAskOpen(true);
  }, []);
  const onAsk = useCallback(
    async (question: string) => {
      const rowId = activeRowId;
      if (!rowId) throw new Error("no card");
      if (staticMode) {
        setBubble("static showcase — the real feed answers here.");
        return;
      }
      const res = await api.post<AskData>(`/api/sessions/${sessionId}/ask`, { question, currentCardId: rowId });
      if (res.kind === "inline") {
        setBubble(res.answer);
        return;
      }
      mergeIn(res.cards);
      const ids = new Set(res.cards.map((c) => c.id));
      const from = slidesRef.current.findIndex((s) => s.key === activeKey);
      window.setTimeout(() => {
        // land on the detour's opener (first spliced slide), not blindly on idx+1 — a predict's
        // reveal slide sits between the question and the detour marker
        const target = slidesRef.current.findIndex((s) => isRowSlide(s) && ids.has(s.rowId));
        scrollToIndex(target >= 0 ? target : from + 1, true);
      }, 120);
    },
    [activeRowId, staticMode, sessionId, mergeIn, activeKey, scrollToIndex],
  );

  /** optimistic gate on the crossroads: flip it locally so the runway resumes/stops without a round trip. */
  const setAwaitingChoice = useCallback(
    (v: boolean) => {
      qc.setQueryData<SessionPublic>(["session", sessionId], (s) => (s ? { ...s, progress: { ...s.progress, awaitingChoice: v } } : s));
    },
    [qc, sessionId],
  );

  /** Record a crossroads pick and let the runway go again. Optimistic — never a spinner on a fork. */
  const postChoice = useCallback(
    async (rowId: string, kind: CrossroadsChoice) => {
      const row = cardsRef.current.find((c) => c.id === rowId);
      const now = new Date().toISOString();
      patchCard(rowId, { interaction: { ...(row?.interaction ?? {}), choice: kind, at: now }, viewedAt: row?.viewedAt ?? now });
      setAwaitingChoice(false);
      if (staticMode) return;
      try {
        const res = await api.post<ChooseData>(`/api/sessions/${sessionId}/choose`, { cardId: rowId, choice: kind });
        seenEpoch.current = Math.max(seenEpoch.current, res.session.progress?.epoch ?? 0);
        qc.setQueryData(["session", sessionId], res.session);
        if (res.cards.length) mergeIn(res.cards);
        pump();
      } catch {
        setAwaitingChoice(true); // the fork is still there — nothing was generated behind their back
        showToast("that didn't take. tap it again?");
      }
    },
    [patchCard, setAwaitingChoice, staticMode, sessionId, qc, mergeIn, pump, showToast],
  );

  /**
   * Crossroads (their ask: "ask before generating more"). The card is the end of the deck until the
   * reader picks. "ask" opens the ask sheet instead of posting; the fork is settled when that sheet
   * closes, asked or not, so the feed can never park itself on an unanswered question.
   */
  const crossroadsAsk = useRef<string | null>(null);
  const onChoose = useCallback(
    (rowId: string, kind: CrossroadsChoice) => {
      if (kind === "ask") {
        crossroadsAsk.current = rowId;
        setAskAbout(false);
        setAskOpen(true);
        return;
      }
      void postChoice(rowId, kind);
    },
    [postChoice],
  );

  const closeAsk = useCallback(() => {
    setAskOpen(false);
    const rowId = crossroadsAsk.current;
    crossroadsAsk.current = null;
    if (rowId) void postChoice(rowId, "ask");
  }, [postChoice]);

  /** `open` card: what they typed goes up, the reply comes back written against it. */
  const onAnswer = useCallback(
    async (rowId: string, text: string): Promise<OpenFeedback | null> => {
      const row = cardsRef.current.find((c) => c.id === rowId);
      const now = new Date().toISOString();
      const base = { ...(row?.interaction ?? {}), text, at: now };
      patchCard(rowId, { interaction: base, viewedAt: row?.viewedAt ?? now });
      if (staticMode) return null;
      viewedSent.current.add(rowId);
      try {
        await drainOutbox().catch(() => {}); // keep report order for this row
        const res = await api.post<InteractData>(`/api/cards/${rowId}/interact`, { text, viewed: true });
        viewedConfirmed.current.add(rowId);
        if (res.feedback) patchCard(rowId, { interaction: { ...base, feedback: res.feedback } });
        if (res.inserted?.length) mergeIn(res.inserted);
        return res.feedback ?? null;
      } catch {
        showToast("couldn't get a reply on that one. give it a sec.");
        return null;
      }
    },
    [patchCard, staticMode, drainOutbox, mergeIn, showToast],
  );

  /** Session map: jump back to a topic (or detour) the reader has already been through. */
  const onGoTo = useCallback(
    (rowId: string) => {
      const i = slidesRef.current.findIndex((s) => isRowSlide(s) && s.rowId === rowId);
      if (i < 0) return;
      const key = slidesRef.current[i].key;
      setActiveKey(key);
      setEntered((p) => (p.has(key) ? p : new Set(p).add(key)));
      scrollToIndex(i, false);
    },
    [scrollToIndex],
  );

  const onRetrySession = useCallback(async () => {
    const res = await post<RetrySessionData>(`/api/sessions/${sessionId}/retry`, {}).catch(() => null);
    if (res) qc.setQueryData(["session", sessionId], res.session);
    else void qc.invalidateQueries({ queryKey: ["session", sessionId] });
  }, [post, sessionId, qc]);

  const onRefresh = useCallback(async () => {
    if (staticMode) return;
    setRefreshing(true);
    try {
      await Promise.all([qc.invalidateQueries({ queryKey: ["session", sessionId] }), refetchAll()]);
      window.setTimeout(() => setRefreshing(false), 500);
    } catch {
      window.location.reload();
    }
  }, [staticMode, qc, sessionId, refetchAll]);

  // ── derived UI bits ─────────────────────────────────────────────────────
  const rowsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  // the timeline reads from the last REAL card the reader stood on: standing on a placeholder
  // must not blank the bar out from under them
  const anchorRowId = useRef<string | null>(null);
  if (activeRowId) anchorRowId.current = activeRowId;
  const anchor = anchorRowId.current;

  // what the server counted, from whichever of its two mouths spoke last: the session (first paint,
  // a dial, a choose) or the generate that just answered. Absent (an older session row, a response
  // that didn't count) means nobody counted, and the bar falls back to saying only what the local
  // rows can prove.
  const census = useMemo(() => fresherCount(session.frontier ?? null, counted), [session.frontier, counted]);
  // …and the cached session carries it too, so anything else reading ['session', id] — a remount,
  // the map sheet — gets the count the last batch reported instead of the one the page shipped with
  useEffect(() => {
    if (!counted) return;
    qc.setQueryData<SessionPublic>(["session", sessionId], (s) => (s && (s.frontier?.epoch ?? -1) <= counted.epoch ? { ...s, frontier: counted } : s));
  }, [counted, qc, sessionId]);

  // The nib answers one question — "is anything actually coming?" — and this device knows the
  // answer first: `fill` flips the moment the POST leaves, a round trip before the server could
  // tell us. …but only while the reader is pressed against the written edge. A top-up that fires
  // with runway to spare is housekeeping, and pulsing the top of the screen for it is noise.
  const barLive = fill === "pending";
  const pressure = runway <= RUNWAY_TARGET_LOW;
  // (with nobody's count to hang it on, the pulse stays off: a bar drawing a live edge it cannot
  // place would be inventing the one thing this whole surface exists to stop guessing about)
  const frontier = useMemo((): FrontierLike | undefined => {
    if (!census || !barLive || !pressure) return census ?? undefined;
    return { ...census, live: census.live ?? { nodeIdx: census.nodeIdx } };
  }, [census, barLive, pressure]);

  const timeline = useMemo(() => timelineModel(cards, session.outline, anchor, frontier), [cards, session.outline, anchor, frontier]);
  const mapTopics = useMemo(() => (mapOpen ? sessionMap(cards, session.outline, anchor, frontier) : []), [mapOpen, cards, session.outline, anchor, frontier]);

  // ── topic transitions: "now: why pods get evicted" for ~2s when the topic changes ────────
  // This is what stops a long session feeling like the same topic forever.
  const lastTopic = useRef<{ nodeId: string | null; detour: boolean } | null>(null);
  useEffect(() => {
    if (!activeRowId || !timeline.nodeId || !timeline.title) return;
    const prev = lastTopic.current;
    lastTopic.current = { nodeId: timeline.nodeId, detour: timeline.detour };
    if (prev && prev.nodeId === timeline.nodeId && prev.detour === timeline.detour) return;
    // stepping onto a detour: the marker card already says where you went, and a stale
    // "now: <topic>" over it would be a lie
    if (timeline.detour) {
      setTopicLabel(null);
      return;
    }
    const back = !!prev && prev.nodeId === timeline.nodeId && prev.detour;
    setTopicLabel(`${back ? "back to" : "now"}: ${timeline.title}`);
  }, [activeRowId, timeline.nodeId, timeline.title, timeline.detour]);
  // …and it always fades back out on its own clock, whatever happens above
  useEffect(() => {
    if (!topicLabel) return;
    const t = window.setTimeout(() => setTopicLabel(null), TOPIC_LABEL_MS);
    return () => window.clearTimeout(t);
  }, [topicLabel]);

  const chromeHidden = scrolling || askOpen;
  const showAsk = !!activeRowId && status !== "planning";
  // standing on a placeholder that already has real cards below it: nudge them, never yank them
  const nudgeSwipe = isPseudoKey(activeKey) && !!pin && pin.key === activeKey && runway > 0;

  const handlersFor = useCallback(
    (slide: Slide): SlideHandlers | undefined => {
      if (slide.kind === "pseudo") {
        const kind = slide.card.type === "notice" ? slide.card.kind : null;
        if (kind === "error") return { onAction: () => void onRetrySession() };
        if (kind === "catching_up" || kind === "offline") return { onAction: pump };
        return undefined;
      }
      if (slide.kind === "predict_reveal") return { onAskAbout };
      const rowId = slide.rowId;
      return {
        onInteract: (r) => onInteract(rowId, r),
        onDial: (dir) => void onDial(rowId, dir),
        onAskAbout,
        onRetry: () => onRetryFrom(rowId),
        onAction: pump,
        onChoose: (kind) => void onChoose(rowId, kind),
        onAnswer: (text) => onAnswer(rowId, text),
      };
    },
    [onInteract, onDial, onAskAbout, onRetryFrom, pump, onRetrySession, onChoose, onAnswer],
  );

  return (
    <ThemeRoot theme={session.theme ?? SHELL_THEME} className="feed-root app-shell" data-status={status}>
      <Timeline
        model={timeline}
        pulseKey={activeKey}
        epoch={epoch}
        scrolling={scrolling}
        label={topicLabel}
        onOpenMap={() => setMapOpen(true)}
        refreshing={refreshing}
      />
      <div ref={containerRef} className="feed relative z-[1]" style={{ overflowAnchor: "none" }} onScroll={onScroll} data-testid="feed">
        {slides.map((slide, i) => {
          const near = Math.abs(i - activeIndex) <= WINDOW;
          const row = isRowSlide(slide) ? rowsById.get(slide.rowId) : undefined;
          const streak = slide.kind === "card" && slide.card.type === "checkpoint" ? streakBefore(cards, slide.rowId) : undefined;
          const called = slide.kind === "predict_reveal" ? calledIt(cards, slide.rowId) : undefined;
          return (
            <FeedSlide
              key={slide.key}
              slide={slide}
              observe={observe}
              mounted={near}
              entered={entered.has(slide.key)}
              active={i === activeIndex}
              interaction={row?.interaction ?? null}
              streak={streak}
              called={called}
              handlers={near ? handlersFor(slide) : undefined}
              overlay={nudgeSwipe && slide.key === activeKey ? <SwipeNudge /> : undefined}
            />
          );
        })}
      </div>
      <BackChevron hidden={chromeHidden} />
      {showAsk && <AskPill hidden={chromeHidden} onOpen={openAsk} />}
      <InlineBubble text={bubble} onDismiss={() => setBubble(null)} />
      <Toast text={toast} />
      <AskSheet open={askOpen} aboutCard={askAbout} onClose={closeAsk} onSubmit={onAsk} />
      <SessionMapSheet
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        topics={mapTopics}
        onGoTo={onGoTo}
        onRefresh={() => void onRefresh()}
        refreshing={refreshing}
      />
    </ThemeRoot>
  );
}
