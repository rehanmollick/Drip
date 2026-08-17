"use client";
import { motion } from "framer-motion";
import { useTheme } from "@/components/theme/ThemeRoot";
import { useLongPress } from "@/lib/hooks/useLongPress";

/**
 * 2px accent hairline at the very top: fill = position within the current
 * topic. Long-press (600ms) → in-app refresh (standalone PWAs have no
 * pull-to-refresh). No numbers, ever.
 */
export function ProgressHairline({ fraction, onRefresh, refreshing }: { fraction: number; onRefresh: () => void; refreshing: boolean }) {
  const { spring, reduced } = useTheme();
  const press = useLongPress(onRefresh, { ms: 600 });
  const f = Math.max(0.02, Math.min(1, fraction || 0));
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 touch-none"
      style={{ height: "calc(env(safe-area-inset-top, 0px) + 18px)" }}
      aria-hidden
      {...press}
    >
      <div className="absolute inset-x-0 top-0 hairline" style={{ background: "var(--line)" }}>
        <motion.div
          className={"h-full origin-left" + (refreshing ? " shimmer" : "")}
          style={{ background: refreshing ? undefined : "var(--accent)" }}
          initial={false}
          animate={{ scaleX: refreshing ? 1 : f }}
          transition={reduced ? { duration: 0.15 } : spring}
        />
      </div>
    </div>
  );
}
