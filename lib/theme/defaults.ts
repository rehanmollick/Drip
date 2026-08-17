import type { Theme } from "@/lib/schemas/theme";

/** App-shell theme (home screen, sheets, splash) — deliberately quiet so session themes pop. */
export const SHELL_THEME: Theme = {
  name: "drip shell",
  mood: "quiet dark shell; the sessions bring the color",
  bg: { base: "#0b0b0f", gradientTo: "#111118", texture: "none" },
  ink: { primary: "#f2f2f5", secondary: "#8f8fa3" },
  accent: "#c8f542",
  accentAlt: "#5ee1ff",
  display: "bricolage-grotesque",
  body: "dm-sans",
  mono: "jetbrains-mono",
  motion: "snappy",
  signature: "accent underline sweeps in under headlines",
  signatureKind: "underline-sweep",
};

/** Sample theme used by the hardcoded phase-1 feed and Playwright fixtures. */
export const SAMPLE_THEME_TERMINAL_NOIR: Theme = {
  name: "terminal noir",
  mood: "late-night ops console; phosphor on black, everything addressed in hex",
  bg: { base: "#07090b", gradientTo: "#0d1117", texture: "scanlines" },
  ink: { primary: "#e6edf3", secondary: "#8b949e" },
  accent: "#3fb950",
  accentAlt: "#f0883e",
  display: "space-grotesk",
  body: "ibm-plex-sans",
  mono: "jetbrains-mono",
  motion: "mechanical",
  signature: "section numbers rendered as hex addresses; hooks get a blinking cursor",
  signatureKind: "hex-addresses",
};

export const SAMPLE_THEME_FIELD_NOTES: Theme = {
  name: "field notes",
  mood: "waterproof notebook on a tide-pool survey; ruled paper, pencil ink, kelp-green accent",
  bg: { base: "#f4efe3", gradientTo: "#ece5d3", texture: "grain" },
  ink: { primary: "#22261f", secondary: "#6b705f" },
  accent: "#2f6b4f",
  accentAlt: "#c9743a",
  display: "fraunces",
  body: "source-serif-4",
  mono: "ibm-plex-mono",
  motion: "fluid",
  signature: "accent underlines drawn like water levels rising under headlines",
  signatureKind: "water-lines",
};
