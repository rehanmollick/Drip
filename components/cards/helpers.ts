/**
 * Pure helpers for card views (no React). Tested in tests/cards.helpers.test.ts.
 */

/** Small string hash → uint32 (FNV-1a). Deterministic across sessions/devices. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG seeded by a uint32. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic shuffle keyed by `seed` (the card id) that is NEVER the input
 * order (for length ≥ 2). Same card → same shuffle on every mount/device.
 */
export function shuffleDeterministic<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  if (out.length < 2) return out;
  const rnd = seededRandom(hashString(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  const same = out.every((v, i) => v === items[i]);
  if (same) {
    // rotate by one so the answer is never handed over
    out.push(out.shift() as T);
  }
  return out;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "0x1F"-style hex address derived from a stable seed, for the hex-addresses signature. */
export function hexAddress(seed: string, width = 2): string {
  const n = hashString(seed) % Math.pow(16, width);
  return `0x${n.toString(16).toUpperCase().padStart(width, "0")}`;
}

/**
 * Pick a font size (px) that keeps long copy inside one viewport: falls through
 * `steps` ([maxLength, px]) in order; the last step is the floor.
 */
export function fitFontSize(text: string, steps: ReadonlyArray<readonly [number, number]>): number {
  const len = text.length;
  for (const [max, px] of steps) if (len <= max) return px;
  return steps[steps.length - 1][1];
}

/** Estimated rendered line count for code at ~`cols` monospace columns per row (long lines wrap). */
export function estimateCodeRows(code: string, cols = 44): number {
  return code.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / cols)), 0);
}

/** Choose the code font size so a worst-case block still fits one phone viewport. */
export function codeFontSize(code: string): number {
  const rows = estimateCodeRows(code);
  if (rows <= 16) return 13;
  if (rows <= 22) return 12;
  if (rows <= 28) return 11;
  return 10;
}

/** Normalize a slider value to 0..1 for the track fill. */
export function fraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Points for a sparkline polyline in a 0..w × 0..h box. */
export function sparkPoints(values: readonly number[], w = 100, h = 32, pad = 2): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2),
    y: pad + (1 - (v - lo) / span) * (h - pad * 2),
  }));
}

export function pointsToString(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** Rough rendered line count for body copy at ~`cols` characters per line (word-wrapped). */
export function estimateLines(text: string, cols = 40): number {
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = 0;
  for (const w of words) {
    const len = w.length + (cur ? 1 : 0);
    if (cur + len > cols && cur > 0) { lines++; cur = w.length; }
    else cur += len;
  }
  return lines;
}

/** Reserved height (px) for copy that appears later, so the layout never jumps when it lands. */
export function reserveHeight(text: string, fontPx: number, cols = 40, lineHeight = 1.4, extra = 8): number {
  return Math.ceil(estimateLines(text, cols) * fontPx * lineHeight + extra);
}
