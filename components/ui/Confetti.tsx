"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

/**
 * LOCAL confetti burst (spec §5): ~14 particles spring out from the center of
 * the parent (which must be `position: relative`) and fade. Never full-screen.
 * Re-fires whenever `burst` increments; 0 renders nothing. Reduced motion → a
 * single soft accent flash instead of particles.
 */
export function Confetti({ burst, count = 14, origin }: { burst: number; count?: number; origin?: { x: number; y: number } }) {
  const reduced = useReducedMotion();
  const particles = useMemo(() => {
    if (!burst) return [];
    const out: { id: number; dx: number; dy: number; rot: number; size: number; color: string; shape: "dot" | "bar" }[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = 42 + Math.random() * 46;
      out.push({
        id: burst * 100 + i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 12,
        rot: (Math.random() - 0.5) * 300,
        size: 4 + Math.random() * 4,
        color: i % 3 === 0 ? "var(--accent-alt)" : i % 3 === 1 ? "var(--accent)" : "var(--ink)",
        shape: i % 2 === 0 ? "dot" : "bar",
      });
    }
    return out;
  }, [burst, count]);

  if (!burst) return null;
  const ox = origin?.x ?? 50;
  const oy = origin?.y ?? 50;

  if (reduced) {
    return (
      <motion.span
        key={burst}
        aria-hidden
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        style={{ position: "absolute", inset: 0, borderRadius: "inherit", background: "var(--accent-soft)", pointerEvents: "none" }}
      />
    );
  }

  return (
    <span aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{ x: p.dx, y: p.dy, opacity: [1, 1, 0], scale: 1, rotate: p.rot }}
          transition={{
            x: { type: "spring", stiffness: 260, damping: 18 },
            y: { type: "spring", stiffness: 260, damping: 18 },
            rotate: { type: "spring", stiffness: 200, damping: 20 },
            scale: { type: "spring", stiffness: 400, damping: 20 },
            opacity: { duration: 0.75, times: [0, 0.55, 1], ease: "easeOut" },
          }}
          style={{
            position: "absolute",
            left: `${ox}%`,
            top: `${oy}%`,
            width: p.shape === "bar" ? p.size * 1.8 : p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            borderRadius: p.shape === "dot" ? 999 : 2,
            background: p.color,
          }}
        />
      ))}
    </span>
  );
}
