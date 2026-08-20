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

/** WCAG contrast ratio 1..21 between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Linear sRGB channel mix of `a` toward `b` by t (0..1), back to hex. */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return toHex([0, 1, 2].map((i) => ra[i] + (rb[i] - ra[i]) * t) as [number, number, number]);
}

/**
 * The contrast gate: a planner theme is never rejected, always repaired. If
 * `fg` on `bg` misses `ratio`, nudge `fg` toward whichever pole (black/white)
 * reads better on `bg` — by the SMALLEST step that clears the bar, so the
 * theme keeps as much of its own color as legibility allows. When even the
 * pole can't hit the ratio (a mid-gray bg caps out below 7:1), the pole is the
 * best anyone can do, so that's the answer. Pure and deterministic: the same
 * theme always renders the same skin.
 */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (contrastRatio(fg, bg) >= ratio) return fg;
  const pole = contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg) ? "#ffffff" : "#000000";
  if (contrastRatio(mixHex(fg, pole, 1), bg) < ratio) return pole;
  // minimal 1/255 step that clears the bar; the predicate flips false→true once
  // along the path to the pole, so a binary search finds the exact crossing
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (contrastRatio(mixHex(fg, pole, mid / 255), bg) >= ratio) hi = mid;
    else lo = mid + 1;
  }
  return mixHex(fg, pole, lo / 255);
}

export function isDark(theme: Theme): boolean {
  return luminance(theme.bg.base) < 0.35;
}

export function themeToCssVars(theme: Theme): Record<string, string> {
  const accentAlt = theme.accentAlt ?? theme.accent;
  const display = `var(${FONT_VAR[theme.display]}, ${FONT_FALLBACK[theme.display]})`;
  const body = `var(${FONT_VAR[theme.body]}, ${FONT_FALLBACK[theme.body]})`;
  const mono = `var(${FONT_VAR[theme.mono]}, ${FONT_FALLBACK[theme.mono]})`;
  // the contrast gate: whatever palette the planner dreamt up, the words stay readable
  const ink = ensureContrast(theme.ink.primary, theme.bg.base, 7);
  const ink2 = ensureContrast(theme.ink.secondary, theme.bg.base, 4.5);
  return {
    "--bg": theme.bg.base,
    "--bg-to": theme.bg.gradientTo ?? theme.bg.base,
    "--ink": ink,
    "--ink-2": ink2,
    "--accent": theme.accent,
    "--accent-alt": accentAlt,
    "--accent-ink": ensureContrast(contrastInk(theme.accent), theme.accent, 4.5),
    "--accent-soft": `color-mix(in oklab, ${theme.accent} 16%, transparent)`,
    "--surface": `color-mix(in oklab, ${ink} 7%, transparent)`,
    "--surface-2": `color-mix(in oklab, ${ink} 12%, transparent)`,
    "--line": `color-mix(in oklab, ${ink} 14%, transparent)`,
    "--state-correct": accentAlt,
    "--state-wrong": `color-mix(in oklab, ${ink} 50%, #e5484d)`,
    "--font-display": display,
    "--font-body": body,
    "--font-mono": mono,
    // shiki css-variables theme hooks
    "--shiki-foreground": ink,
    "--shiki-background": "transparent",
    "--shiki-token-constant": theme.accent,
    "--shiki-token-string": accentAlt,
    "--shiki-token-comment": ink2,
    "--shiki-token-keyword": theme.accent,
    "--shiki-token-parameter": ink,
    "--shiki-token-function": ink,
    "--shiki-token-string-expression": accentAlt,
    "--shiki-token-punctuation": ink2,
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
