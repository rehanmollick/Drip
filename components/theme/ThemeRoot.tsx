"use client";
import { createContext, useContext, useMemo } from "react";
import { useReducedMotion, type Transition } from "framer-motion";
import type { Theme } from "@/lib/schemas/theme";
import { DEFAULT_SPRING, MOTION_SPRINGS, themeDataAttrs, themeStyle } from "@/lib/theme/cssVars";
import { SHELL_THEME } from "@/lib/theme/defaults";

type ThemeCtx = {
  theme: Theme;
  /** Spring for the theme's motion personality (or a 150ms tween under reduced motion). */
  spring: Transition;
  reduced: boolean;
  /** Stagger between staggered children (ms). 60ms per spec; 0 under reduced motion. */
  staggerMs: number;
};

const Ctx = createContext<ThemeCtx>({ theme: SHELL_THEME, spring: DEFAULT_SPRING, reduced: false, staggerMs: 60 });

export function useTheme() {
  return useContext(Ctx);
}

/**
 * Applies a session theme as CSS variables + data attributes on a root element
 * and provides { theme, spring, reduced } to descendants. Components below this
 * consume ONLY the variables.
 */
export function ThemeRoot({
  theme,
  className,
  children,
  as: Tag = "div",
  ...rest
}: {
  theme: Theme;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "main" | "section";
} & Omit<React.HTMLAttributes<HTMLElement>, "style">) {
  const reduced = !!useReducedMotion();
  const value = useMemo<ThemeCtx>(() => {
    const spring: Transition = reduced ? { duration: 0.15, ease: "easeOut" } : MOTION_SPRINGS[theme.motion] ?? DEFAULT_SPRING;
    return { theme, spring, reduced, staggerMs: reduced ? 0 : 60 };
  }, [theme, reduced]);
  const style = themeStyle(theme);
  const attrs = themeDataAttrs(theme);
  return (
    <Ctx.Provider value={value}>
      <Tag className={className} style={style} {...attrs} {...rest}>
        {children}
      </Tag>
    </Ctx.Provider>
  );
}
