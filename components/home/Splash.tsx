"use client";
import { motion, useReducedMotion } from "framer-motion";

/** App-shell splash: a single blinking wordmark. Never a spinner. */
export function Splash({ className = "app-shell" }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className={`${className} flex items-center justify-center`} role="status" aria-label="loading">
      <motion.span
        className="font-display text-4xl tracking-tight text-ink"
        animate={reduced ? { opacity: 1 } : { opacity: [1, 0.25, 1] }}
        transition={reduced ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        drip
      </motion.span>
    </div>
  );
}
