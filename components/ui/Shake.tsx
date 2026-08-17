"use client";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { shakeKeyframes, shakeTransition } from "@/lib/motion";

/**
 * Wrong-answer shake wrapper: whenever `trigger` increments (>0) the children
 * shake x ±6px, 3 cycles. Reduced motion → no shake (the wrong-state border
 * still tells the story).
 */
export function Shake({
  trigger,
  children,
  className,
  style,
}: {
  trigger: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (trigger > 0 && !reduced) void controls.start({ ...shakeKeyframes, transition: shakeTransition });
  }, [trigger, reduced, controls]);
  return (
    <motion.div animate={controls} className={className} style={style}>
      {children}
    </motion.div>
  );
}
