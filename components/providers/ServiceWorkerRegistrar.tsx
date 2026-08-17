"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SESSION_PATH = /^\/s\/([\w-]+)\/?$/;
/** How often to refresh the offline snapshot while a session is open and visible. */
const SNAPSHOT_EVERY_MS = 30_000;

/** Ask the active worker to (re)snapshot a session for offline replay. No-op without a worker. */
export function requestSessionSnapshot(id: string): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const send = (w: ServiceWorker | null) => w?.postMessage({ type: "CACHE_SESSION", id });
  if (navigator.serviceWorker.controller) send(navigator.serviceWorker.controller);
  else navigator.serviceWorker.ready.then((reg) => send(reg.active)).catch(() => {});
}

/**
 * Registers /sw.js in production (and when NEXT_PUBLIC_SW=1 in dev), and keeps
 * the worker's offline copy of the open session fresh: client-side navigation
 * never fetches /s/:id as a document, so the worker can't cache it on its own
 * (spec §12.7 — viewed cards readable offline after a reload/relaunch).
 */
export function ServiceWorkerRegistrar() {
  const pathname = usePathname();
  const sessionId = pathname ? SESSION_PATH.exec(pathname)?.[1] ?? null : null;

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW === "1";
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[sw] register failed", e));
  }, []);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // first snapshot a beat after arrival (lets the page's own requests land first), then periodically while visible,
    // and whenever the page is being backgrounded — that's the copy an offline relaunch will replay.
    let timer: number | null = null;
    const snap = () => requestSessionSnapshot(sessionId);
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState === "visible") snap();
        schedule();
      }, SNAPSHOT_EVERY_MS);
    };
    const first = window.setTimeout(snap, 2_000);
    schedule();
    const onHide = () => {
      if (document.visibilityState === "hidden") snap();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", snap);
    return () => {
      window.clearTimeout(first);
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", snap);
    };
  }, [sessionId]);

  return null;
}
