"use client";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/home/BottomSheet";
import { useTheme } from "@/components/theme/ThemeRoot";

/**
 * Ask-anything sheet (spec §7). Opened from the bottom pill or from a card's
 * long-press ("about this card"). Loading = a shimmer line, never a spinner.
 * Errors read like the persona shrugging, never like a stack trace.
 */
export function AskSheet({
  open,
  aboutCard,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Opened via long-press on a card: tag the question as being about it. */
  aboutCard: boolean;
  onClose: () => void;
  /** Resolves when the answer has been handled (bubble shown / detour merged). Reject → soft in-sheet nudge. */
  onSubmit: (question: string) => Promise<void>;
}) {
  const { spring, reduced } = useTheme();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setNudge(null);
      const t = window.setTimeout(() => ref.current?.focus(), 250);
      return () => window.clearTimeout(t);
    }
    setQ("");
    setBusy(false);
  }, [open]);

  const send = useCallback(async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setNudge(null);
    try {
      await onSubmit(question);
      setQ("");
      onClose();
    } catch {
      setNudge("that one didn't land. one more go?");
    } finally {
      setBusy(false);
    }
  }, [q, busy, onSubmit, onClose]);

  return (
    <BottomSheet open={open} onClose={onClose} label="ask anything">
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg text-ink">ask anything</span>
          {aboutCard && (
            <span className="rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              about this card
            </span>
          )}
        </div>
        <textarea
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          maxLength={500}
          placeholder={aboutCard ? "what's up with this one?" : "wait, why…?"}
          className="w-full resize-none rounded-2xl px-4 py-3 font-body text-base text-ink outline-none placeholder:text-ink-2"
          style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          disabled={busy}
        />
        {busy && <div className="shimmer h-1.5 w-full rounded-full" aria-label="thinking" />}
        {nudge && !busy && <p className="font-body text-sm text-ink-2">{nudge}</p>}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 font-body text-sm text-ink-2">
            nvm
          </button>
          <motion.button
            type="button"
            onClick={() => void send()}
            disabled={busy || !q.trim()}
            whileTap={reduced ? undefined : { scale: 0.97 }}
            transition={spring}
            className="rounded-full px-5 py-2.5 font-body text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            {busy ? "asking…" : "ask"}
          </motion.button>
        </div>
      </div>
    </BottomSheet>
  );
}
