"use client";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * Bottom sheet primitive: backdrop + drag-to-dismiss panel. Themed via CSS
 * vars only. Used by the new-session sheet, the tile menu, and the ask bar.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  label,
  tall,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  /** Let the panel take most of the screen (textarea sheets). */
  tall?: boolean;
}) {
  const { spring, reduced } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[60]"
            style={{ background: "color-mix(in oklab, var(--bg) 55%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-[61] flex flex-col rounded-t-3xl"
            style={{
              background: "var(--bg-to)",
              borderTop: "1px solid var(--line)",
              maxHeight: tall ? "88dvh" : "70dvh",
              paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
              boxShadow: "0 -20px 60px color-mix(in oklab, var(--bg) 60%, transparent)",
            }}
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={reduced ? { duration: 0.15 } : spring}
            drag={reduced ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={onDragEnd}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-10 rounded-full" style={{ background: "var(--line)" }} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Segmented pills (depth preset etc). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { spring, reduced } = useTheme();
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full p-1" style={{ background: "var(--surface)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            transition={spring}
            className="flex-1 rounded-full px-3 py-1.5 font-body text-sm"
            style={{ background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-ink)" : "var(--ink-2)", fontWeight: on ? 600 : 500 }}
          >
            {o.label}
          </motion.button>
        );
      })}
    </div>
  );
}

/** Pill toggle. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  const { spring, reduced } = useTheme();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-7 w-12 shrink-0 rounded-full"
      style={{ background: on ? "var(--accent)" : "var(--surface-2)", transition: "background 180ms ease" }}
    >
      <motion.span
        className="absolute top-0.5 h-6 w-6 rounded-full"
        style={{ background: on ? "var(--accent-ink)" : "var(--ink)" }}
        animate={{ left: on ? 22 : 2 }}
        transition={reduced ? { duration: 0.15 } : spring}
      />
    </button>
  );
}
