"use client";
import { useEffect } from "react";

/** Registers /sw.js in production (and when NEXT_PUBLIC_SW=1 in dev). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_SW === "1";
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[sw] register failed", e));
  }, []);
  return null;
}
