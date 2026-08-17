"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AskSheet } from "@/components/ask/AskBar";
import { InlineBubble } from "@/components/ask/InlineBubble";
import type { InteractResult, Slide } from "@/components/cards/types";
import { ThemeRoot } from "@/components/theme/ThemeRoot";
import { api } from "@/lib/api/client";
import type { z } from "zod";
import type { AskData, InteractBody, InteractData, SessionPublic } from "@/lib/api/contract";
import type { DialData as DialDataSchema, GetSessionData as GetSessionDataSchema, RetrySessionData as RetrySessionDataSchema } from "@/lib/api/contract";
import { ticks } from "@/lib/audio/ticks";
import { DwellClock } from "@/lib/dwell";
import { pseudoSlide, type PseudoKind } from "@/lib/feed/notices";
import { streakBefore, topicProgress } from "@/lib/feed/progress";
import { dropUnviewedAfter, isRowSlide, ordinalOf, toSlides } from "@/lib/feed/slides";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { SHELL_THEME } from "@/lib/theme/defaults";
import { AskPill, BackChevron } from "./Chrome";
import { FeedSlide, type SlideHandlers } from "./FeedSlide";
import { ProgressHairline } from "./ProgressHairline";
import { Toast } from "./Toast";
import { useFeedCards } from "./useFeedCards";

type GetSessionData = z.infer<typeof GetSessionDataSchema>;
type DialData = z.infer<typeof DialDataSchema>;
type RetrySessionData = z.infer<typeof RetrySessionDataSchema>;

const RUNWAY_TARGET_LOW = 4;   // request the next batch at or below this
const WINDOW = 3;              // slides rendered on either side of the active one
const CHROME_REST_MS = 400;
const TOAST_MS = 2_200;
const POSITION_THROTTLE_MS = 1_000;

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

  // ── session (polls while planning) ──────────────────────────────────────
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => (await api.get<GetSessionData>(`/api/sessions/${sessionId}`)).session,
    initialData: initialSession,
    enabled: !staticMode,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return !staticMode && s === "planning" ? 1_500 : false;
    },
    staleTime: 10_000,
  });
  const session = sessionQuery.data ?? initialSession;
  const status = session.status;
  const active = status === "active" || status === "archived";

  // ── cards + generation loop ─────────────────────────────────────────────
  const syncBeforeGenerate = useRef<() => Promise<void>>(async () => {});
  const feed = useFeedCards({
    sessionId,
    initialCards,
    initialHasMore: initialCards.length < (initialSession.cardCount ?? 0),
    enabled: active,
    staticMode,
    beforeGenerate: () => syncBeforeGenerate.current(),
  });
  const { cards, mergeIn, patchCard, setCards, online, setWantMore, pump, refetchAll } = feed;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // status flip planning → active: pull the real cards, theme re-applies via session.theme
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current !== "active" && status === "active" && !staticMode) void refetchAll().catch(() => {});
    prevStatus.current = status;
  }, [status, staticMode, refetchAll]);

  // ── slides ──────────────────────────────────────────────────────────────
  const rowSlides = useMemo(() => toSlides(cards), [cards]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [entered, setEntered] = useState<Set<string>>(() => new Set());

  const headCount = (status === "planning" ? 1 : 0) + (status === "error" ? 1 : 0);
  const activeIndexRef = useRef(0);
  // real-card slides still ahead of the active position (pseudo tail active → 0; head notice active → all)
  const runway = useMemo(() => {
    if (!activeKey) return rowSlides.length;
    if (activeKey.startsWith("pseudo:")) return activeKey === "pseudo:planning" || activeKey === "pseudo:error" ? rowSlides.length : 0;
    const i = rowSlides.findIndex((s) => s.key === activeKey);
    if (i >= 0) return rowSlides.length - 1 - i;
    return Math.max(0, rowSlides.length - 1 - (activeIndexRef.current - headCount));
  }, [rowSlides, activeKey, headCount]);

  const tail: PseudoKind | null = useMemo(() => {
    if (!active || staticMode) return null;
    if (runway > 0) return null;
    if (!online) return "offline";
    return "catching_up"; // a generate is pending / scheduled — never an error string
  }, [active, staticMode, runway, online]);

  const slides: Slide[] = useMemo(() => {
    const out: Slide[] = [];
    if (status === "planning") out.push(pseudoSlide("planning"));
    if (status === "error") out.push(pseudoSlide("error"));
    out.push(...rowSlides);
    if (tail) out.push(pseudoSlide(tail));
    return out;
  }, [status, rowSlides, tail]);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  // If the active key vanished (a pseudo tail replaced by real cards) keep the last index: never jump.
  const foundIndex = activeKey ? slides.findIndex((s) => s.key === activeKey) : -1;
  const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(activeIndexRef.current, Math.max(0, slides.length - 1));
  activeIndexRef.current = activeIndex;
  const activeSlide = slides[activeIndex];
  const activeRowId = activeSlide && isRowSlide(activeSlide) ? activeSlide.rowId : null;

  // ask for more whenever runway is short (pump is idempotent + backoff-aware)
  useEffect(() => {
    if (!active || staticMode) return;
    setWantMore(runway <= RUNWAY_TARGET_LOW);
  }, [runway, active, staticMode, setWantMore]);

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
  const [scrolling, setScrolling] = useState(false);
  const scrollingRef = useRef(false);
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

  // Keep the active slide under the thumb if slides get spliced above it (the container has
  // overflow-anchor: none, so the browser never does this for us). A pseudo tail is the exception:
  // when real cards land they push the tail down and the first new card is now under the thumb —
  // hand the active key over to it so runway/dwell continue without waiting on the observer.
  const lastActiveIndex = useRef(activeIndex);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (root && foundIndex >= 0 && lastActiveIndex.current !== foundIndex && !scrollingRef.current) {
      if (activeKey?.startsWith("pseudo:") && foundIndex > lastActiveIndex.current) {
        const landed = slides[lastActiveIndex.current];
        if (landed && isRowSlide(landed)) {
          setActiveKey(landed.key);
          setEntered((p) => (p.has(landed.key) ? p : new Set(p).add(landed.key)));
          root.scrollTo({ top: lastActiveIndex.current * root.clientHeight });
          return;
        }
      }
      const expected = foundIndex * root.clientHeight;
      if (Math.abs(root.scrollTop - expected) > root.clientHeight * 0.5) root.scrollTo({ top: expected });
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
  const outbox = useRef<Array<{ rowId: string; body: InteractBody }>>([]);
  const draining = useRef(false);
  const sendInteract = useCallback(
    async (rowId: string, body: InteractBody) => {
      const res = await api.post<InteractData>(`/api/cards/${rowId}/interact`, body);
      if (res?.inserted?.length) mergeIn(res.inserted);
    },
    [mergeIn],
  );
  const drainOutbox = useCallback(async () => {
    if (draining.current || staticMode) return;
    draining.current = true;
    try {
      while (outbox.current.length) {
        const next = outbox.current[0];
        try {
          await sendInteract(next.rowId, next.body);
          outbox.current.shift();
        } catch {
          break; // still down; try again later
        }
      }
    } finally {
      draining.current = false;
    }
  }, [sendInteract, staticMode]);
  const interact = useCallback(
    (rowId: string, body: InteractBody, keepalive = false) => {
      if (staticMode) return;
      if (keepalive) {
        try {
          void fetch(`/api/cards/${rowId}/interact`, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        } catch { /* best effort */ }
        return;
      }
      if (outbox.current.length) {
        outbox.current.push({ rowId, body }); // keep order while something older is stuck
        void drainOutbox();
        return;
      }
      sendInteract(rowId, body).catch(() => {
        outbox.current.push({ rowId, body });
      });
    },
    [staticMode, sendInteract, drainOutbox],
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
      outbox.current.push({ rowId: c.id, body: { viewed: true } });
    }
    void drainOutbox();
  }, [staticMode, active, initialSession.position, drainOutbox]);

  // before every generate: land what the server needs for its runway math
  syncBeforeGenerate.current = async () => {
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

  const onInteract = useCallback(
    (rowId: string, r: InteractResult) => {
      const row = cardsRef.current.find((c) => c.id === rowId);
      if (!row) return;
      const now = new Date().toISOString();
      patchCard(rowId, { interaction: { ...(row.interaction ?? {}), ...r, at: now } });
      if (r.correct === true) ticks.correct();
      if (staticMode) return;
      const body: InteractBody = { choice: r.choice, correct: r.correct, value: r.value };
      const card = row.payload as Card;
      if (card.type === "clarify" && typeof r.choice === "number") {
        const answer = card.options[r.choice];
        api
          .patch(`/api/sessions/${sessionId}`, { clarifierAnswers: { [card.key]: answer } })
          .then(async () => {
            await qc.invalidateQueries({ queryKey: ["session", sessionId] });
            await refetchAll();
          })
          .catch(() => {});
      }
      interact(rowId, body);
    },
    [patchCard, staticMode, sessionId, interact, qc, refetchAll],
  );

  const onDial = useCallback(
    async (rowId: string, direction: "simpler" | "deeper") => {
      showToast(direction === "simpler" ? "say less. rewinding the jargon." : "bet. going a layer deeper.");
      const res = await post<DialData>(`/api/sessions/${sessionId}/dial`, { direction, currentCardId: rowId }).catch(() => null);
      if (!res) return;
      if (res.toast) showToast(res.toast);
      setCards((prev) => dropUnviewedAfter(prev, res.removedAfter));
      qc.setQueryData(["session", sessionId], res.session);
      pump();
    },
    [post, sessionId, showToast, setCards, qc, pump],
  );

  const onAskAbout = useCallback(() => {
    setAskAbout(true);
    setAskOpen(true);
  }, []);
  const openAsk = useCallback(() => {
    setAskAbout(false);
    setAskOpen(true);
  }, []);
  const closeAsk = useCallback(() => setAskOpen(false), []);

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
      const idx = slidesRef.current.findIndex((s) => s.key === activeKey);
      window.setTimeout(() => scrollToIndex(idx + 1, true), 120);
    },
    [activeRowId, staticMode, sessionId, mergeIn, activeKey, scrollToIndex],
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
  const lastProgress = useRef(0);
  const progress = activeRowId ? topicProgress(cards, activeRowId) : lastProgress.current;
  lastProgress.current = progress;

  const chromeHidden = scrolling || askOpen;
  const showAsk = !!activeRowId && status !== "planning";

  const handlersFor = useCallback(
    (slide: Slide): SlideHandlers | undefined => {
      if (slide.kind === "pseudo") {
        const kind = slide.card.type === "notice" ? slide.card.kind : null;
        if (kind === "error") return { onAction: () => void onRetrySession() };
        if (kind === "catching_up" || kind === "offline") return { onAction: pump };
        return undefined;
      }
      if (slide.kind === "predict_reveal") return undefined;
      const rowId = slide.rowId;
      return {
        onInteract: (r) => onInteract(rowId, r),
        onDial: (dir) => void onDial(rowId, dir),
        onAskAbout,
        onRetry: pump,
        onAction: pump,
      };
    },
    [onInteract, onDial, onAskAbout, pump, onRetrySession],
  );

  return (
    <ThemeRoot theme={session.theme ?? SHELL_THEME} className="feed-root app-shell" data-status={status}>
      <ProgressHairline fraction={progress} onRefresh={() => void onRefresh()} refreshing={refreshing} />
      <div ref={containerRef} className="feed relative z-[1]" style={{ overflowAnchor: "none" }} onScroll={onScroll} data-testid="feed">
        {slides.map((slide, i) => {
          const near = Math.abs(i - activeIndex) <= WINDOW;
          const row = isRowSlide(slide) ? rowsById.get(slide.rowId) : undefined;
          const streak = slide.kind === "card" && slide.card.type === "checkpoint" ? streakBefore(cards, slide.rowId) : undefined;
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
              handlers={near ? handlersFor(slide) : undefined}
            />
          );
        })}
      </div>
      <BackChevron hidden={chromeHidden} />
      {showAsk && <AskPill hidden={chromeHidden} onOpen={openAsk} />}
      <InlineBubble text={bubble} onDismiss={() => setBubble(null)} />
      <Toast text={toast} />
      <AskSheet open={askOpen} aboutCard={askAbout} onClose={closeAsk} onSubmit={onAsk} />
    </ThemeRoot>
  );
}
