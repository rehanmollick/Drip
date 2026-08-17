import type { CSSProperties } from "react";
import type { Theme } from "@/lib/schemas/theme";
import { FONT_FALLBACK, FONT_VAR } from "./fonts";

/**
 * THE CSS variable contract. Card/diagram components consume ONLY these
 * variables — never hardcoded colors or font names. One themed component set,
 * infinite skins.
 *
 *   --bg, --bg-to, --ink, --ink-2, --accent, --accent-alt, --accent-ink
 *   --accent-soft, --surface, --line, --state-correct, --state-wrong
 *   --font-display, --font-body, --font-mono
 *   --shiki-* (code token colors, derived from ink/accent)
 *   data-texture, data-motion, data-signature (attributes on the feed root)
 */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance 0..1 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads on `hex`. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.45 ? "#111111" : "#ffffff";
}

export function isDark(theme: Theme): boolean {
  return luminance(theme.bg.base) < 0.35;
}

export function themeToCssVars(theme: Theme): Record<string, string> {
  const accentAlt = theme.accentAlt ?? theme.accent;
  const display = `var(${FONT_VAR[theme.display]}, ${FONT_FALLBACK[theme.display]})`;
  const body = `var(${FONT_VAR[theme.body]}, ${FONT_FALLBACK[theme.body]})`;
  const mono = `var(${FONT_VAR[theme.mono]}, ${FONT_FALLBACK[theme.mono]})`;
  return {
    "--bg": theme.bg.base,
    "--bg-to": theme.bg.gradientTo ?? theme.bg.base,
    "--ink": theme.ink.primary,
    "--ink-2": theme.ink.secondary,
    "--accent": theme.accent,
    "--accent-alt": accentAlt,
    "--accent-ink": contrastInk(theme.accent),
    "--accent-soft": `color-mix(in oklab, ${theme.accent} 16%, transparent)`,
    "--surface": `color-mix(in oklab, ${theme.ink.primary} 7%, transparent)`,
    "--surface-2": `color-mix(in oklab, ${theme.ink.primary} 12%, transparent)`,
    "--line": `color-mix(in oklab, ${theme.ink.primary} 14%, transparent)`,
    "--state-correct": accentAlt,
    "--state-wrong": `color-mix(in oklab, ${theme.ink.primary} 50%, #e5484d)`,
    "--font-display": display,
    "--font-body": body,
    "--font-mono": mono,
    // shiki css-variables theme hooks
    "--shiki-foreground": theme.ink.primary,
    "--shiki-background": "transparent",
    "--shiki-token-constant": theme.accent,
    "--shiki-token-string": accentAlt,
    "--shiki-token-comment": theme.ink.secondary,
    "--shiki-token-keyword": theme.accent,
    "--shiki-token-parameter": theme.ink.primary,
    "--shiki-token-function": theme.ink.primary,
    "--shiki-token-string-expression": accentAlt,
    "--shiki-token-punctuation": theme.ink.secondary,
    "--shiki-token-link": theme.accent,
  };
}

export function themeStyle(theme: Theme): CSSProperties {
  return themeToCssVars(theme) as CSSProperties;
}

/** Attributes to spread on the feed root alongside the style. */
export function themeDataAttrs(theme: Theme) {
  return {
    "data-texture": theme.bg.texture,
    "data-motion": theme.motion,
    "data-signature": theme.signatureKind,
    "data-scheme": isDark(theme) ? "dark" : "light",
  } as const;
}

/** Framer Motion spring presets per theme.motion. Spec default: {stiffness 380, damping 30}. */
export const MOTION_SPRINGS = {
  snappy: { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.9 },
  fluid: { type: "spring" as const, stiffness: 300, damping: 30, mass: 1 },
  mechanical: { type: "spring" as const, stiffness: 380, damping: 40, mass: 1 },
  bouncy: { type: "spring" as const, stiffness: 380, damping: 22, mass: 1 },
} as const;
export const DEFAULT_SPRING = { type: "spring" as const, stiffness: 380, damping: 30 };
