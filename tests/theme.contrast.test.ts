import { describe, expect, it, vi } from "vitest";

// next/font only exists inside the Next compiler; the contrast math under test never touches fonts
vi.mock("next/font/google", () => {
  const face = () => ({ variable: "--font-mocked", className: "" });
  const names = [
    "Space_Grotesk", "Bricolage_Grotesque", "Syne", "Unbounded", "Fraunces", "Playfair_Display",
    "Instrument_Serif", "Zilla_Slab", "DM_Sans", "Manrope", "Nunito", "IBM_Plex_Sans",
    "Source_Serif_4", "JetBrains_Mono", "IBM_Plex_Mono", "Fira_Code",
  ];
  return Object.fromEntries(names.map((n) => [n, face]));
});

import { contrastRatio, ensureContrast, mixHex, themeToCssVars } from "@/lib/theme/cssVars";
import type { Theme } from "@/lib/schemas/theme";

/**
 * The contrast gate (lib/theme/cssVars.ts): a planner theme is never rejected,
 * always repaired — ink-on-bg >= 7:1, ink2-on-bg >= 4.5:1,
 * accent-ink-on-accent >= 4.5:1, deterministically and by the smallest nudge
 * that clears the bar.
 */

const theme = (over: Partial<Theme["bg"]> & { ink?: Theme["ink"]; accent?: string } = {}): Theme => ({
  name: "test",
  mood: "test",
  bg: { base: over.base ?? "#0b0e0c", gradientTo: over.gradientTo, texture: "none" },
  ink: over.ink ?? { primary: "#e8ece9", secondary: "#9aa39c" },
  accent: over.accent ?? "#39d353",
  accentAlt: undefined,
  display: "space-grotesk",
  body: "dm-sans",
  mono: "jetbrains-mono",
  motion: "snappy",
  signature: "test",
  signatureKind: "underline-sweep",
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#39d353", "#39d353")).toBe(1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 10);
  });
});

describe("ensureContrast", () => {
  it("returns a compliant color unchanged", () => {
    expect(ensureContrast("#e8ece9", "#0b0e0c", 7)).toBe("#e8ece9");
    expect(ensureContrast("#111111", "#fafafa", 7)).toBe("#111111");
  });

  it("repairs a low-contrast ink to the target ratio", () => {
    const fixed = ensureContrast("#3a4a3e", "#0b0e0c", 7); // dark ink on a dark bg
    expect(contrastRatio(fixed, "#0b0e0c")).toBeGreaterThanOrEqual(7);
  });

  it("nudges by the smallest step: one step back toward the original misses the bar", () => {
    const fg = "#3a4a3e";
    const bg = "#0b0e0c";
    const fixed = ensureContrast(fg, bg, 7);
    // find the t that produced `fixed`, then check t - 1/255 fails
    let t = -1;
    for (let i = 0; i <= 255; i++) {
      if (mixHex(fg, "#ffffff", i / 255) === fixed) { t = i; break; }
    }
    expect(t).toBeGreaterThan(0);
    expect(contrastRatio(mixHex(fg, "#ffffff", (t - 1) / 255), bg)).toBeLessThan(7);
  });

  it("never rejects: an unreachable ratio lands on the best pole", () => {
    // a mid-gray bg caps out below 7:1 against both black and white
    const fixed = ensureContrast("#888888", "#757575", 7);
    expect(["#ffffff", "#000000"]).toContain(fixed);
    const alt = fixed === "#ffffff" ? "#000000" : "#ffffff";
    expect(contrastRatio(fixed, "#757575")).toBeGreaterThanOrEqual(contrastRatio(alt, "#757575"));
  });

  it("repairs a light-on-light ink by darkening (crosses the bg luminance without getting stuck)", () => {
    const fixed = ensureContrast("#f2f2f2", "#fafafa", 7);
    expect(contrastRatio(fixed, "#fafafa")).toBeGreaterThanOrEqual(7);
  });

  it("is deterministic", () => {
    expect(ensureContrast("#3a4a3e", "#0b0e0c", 7)).toBe(ensureContrast("#3a4a3e", "#0b0e0c", 7));
  });
});

describe("themeToCssVars applies the gate", () => {
  it("ink >= 7:1, ink2 >= 4.5:1 on bg; accent-ink >= 4.5:1 on accent", () => {
    // a deliberately murky theme: everything too close to the bg
    const bad = theme({ base: "#1a221c", ink: { primary: "#2c382f", secondary: "#26302a" }, accent: "#3f5a46" });
    const vars = themeToCssVars(bad);
    expect(contrastRatio(vars["--ink"], bad.bg.base)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(vars["--ink-2"], bad.bg.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(vars["--accent-ink"], bad.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a compliant theme's inks byte-for-byte alone", () => {
    const good = theme();
    const vars = themeToCssVars(good);
    expect(vars["--ink"]).toBe(good.ink.primary);
    expect(vars["--ink-2"]).toBe(good.ink.secondary);
  });

  it("derived surfaces mix from the repaired ink, not the planner's", () => {
    const bad = theme({ base: "#101410", ink: { primary: "#1c241d", secondary: "#181f19" } });
    const vars = themeToCssVars(bad);
    expect(vars["--surface"]).toContain(vars["--ink"]);
    expect(vars["--line"]).toContain(vars["--ink"]);
  });
});
