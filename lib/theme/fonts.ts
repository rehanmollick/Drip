/**
 * Curated self-hosted faces (next/font/google → self-hosted at build, zero
 * runtime font jank). Each exposes a CSS variable; themes map display/body/mono
 * onto these variables (see cssVars.ts). preload is off: a session only uses
 * three of these and the browser fetches faces on first use.
 *
 * next/font requires literal option objects (no spreads / computed values).
 */
import {
  Space_Grotesk, Bricolage_Grotesque, Syne, Unbounded, Fraunces, Playfair_Display,
  Instrument_Serif, Zilla_Slab, DM_Sans, Manrope, Nunito, IBM_Plex_Sans,
  Source_Serif_4, JetBrains_Mono, IBM_Plex_Mono, Fira_Code,
} from "next/font/google";
import type { FontKey } from "@/lib/schemas/theme";

export const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-space-grotesk" });
export const bricolage = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-bricolage-grotesque" });
export const syne = Syne({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-syne" });
export const unbounded = Unbounded({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-unbounded" });
export const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-fraunces" });
export const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-playfair-display" });
export const instrumentSerif = Instrument_Serif({ subsets: ["latin"], display: "swap", preload: false, weight: ["400"], style: ["normal", "italic"], variable: "--font-instrument-serif" });
export const zillaSlab = Zilla_Slab({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-zilla-slab" });
export const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-dm-sans" });
export const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-manrope" });
export const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-nunito" });
export const ibmPlexSans = IBM_Plex_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-ibm-plex-sans" });
export const sourceSerif = Source_Serif_4({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-serif-4" });
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-jetbrains-mono" });
export const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--font-ibm-plex-mono" });
export const firaCode = Fira_Code({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-fira-code" });

export const ALL_FONT_OBJECTS = [
  spaceGrotesk, bricolage, syne, unbounded, fraunces, playfair, instrumentSerif, zillaSlab,
  dmSans, manrope, nunito, ibmPlexSans, sourceSerif, jetbrainsMono, ibmPlexMono, firaCode,
];

/** className to put on <html> so every --font-* variable is defined app-wide. */
export const fontVariableClassName = ALL_FONT_OBJECTS.map((f) => f.variable).join(" ");

/** FontKey → CSS variable name (kept in sync with `variable:` above). */
export const FONT_VAR: Record<FontKey, string> = {
  "space-grotesk": "--font-space-grotesk",
  "bricolage-grotesque": "--font-bricolage-grotesque",
  "syne": "--font-syne",
  "unbounded": "--font-unbounded",
  "fraunces": "--font-fraunces",
  "playfair-display": "--font-playfair-display",
  "instrument-serif": "--font-instrument-serif",
  "zilla-slab": "--font-zilla-slab",
  "dm-sans": "--font-dm-sans",
  "manrope": "--font-manrope",
  "nunito": "--font-nunito",
  "ibm-plex-sans": "--font-ibm-plex-sans",
  "source-serif-4": "--font-source-serif-4",
  "jetbrains-mono": "--font-jetbrains-mono",
  "ibm-plex-mono": "--font-ibm-plex-mono",
  "fira-code": "--font-fira-code",
};

/** Generic fallback stacks per face family (used inside var(--font-x, fallback)). */
export const FONT_FALLBACK: Record<FontKey, string> = {
  "space-grotesk": "system-ui, sans-serif",
  "bricolage-grotesque": "system-ui, sans-serif",
  "syne": "system-ui, sans-serif",
  "unbounded": "system-ui, sans-serif",
  "fraunces": "Georgia, serif",
  "playfair-display": "Georgia, serif",
  "instrument-serif": "Georgia, serif",
  "zilla-slab": "Georgia, serif",
  "dm-sans": "system-ui, sans-serif",
  "manrope": "system-ui, sans-serif",
  "nunito": "system-ui, sans-serif",
  "ibm-plex-sans": "system-ui, sans-serif",
  "source-serif-4": "Georgia, serif",
  "jetbrains-mono": "ui-monospace, monospace",
  "ibm-plex-mono": "ui-monospace, monospace",
  "fira-code": "ui-monospace, monospace",
};
