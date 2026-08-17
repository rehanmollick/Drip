"use client";
import { useCallback, useRef } from "react";

/**
 * Pointer-based long-press (works for touch + mouse; iOS Safari has no
 * contextmenu on touch). Cancels on move > 8px or pointer up before `ms`.
 */
export function useLongPress(onLongPress: () => void, { ms = 450, onTap }: { ms?: number; onTap?: () => void } = {}) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    [clear, ms, onLongPress],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear();
    },
    [clear],
  );
  const onPointerUp = useCallback(() => {
    const wasPending = timer.current !== null;
    clear();
    if (wasPending && !fired.current) onTap?.();
    start.current = null;
  }, [clear, onTap]);
  const onPointerCancel = useCallback(() => {
    clear();
    start.current = null;
  }, [clear]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu: (e: React.MouseEvent) => e.preventDefault() };
}
