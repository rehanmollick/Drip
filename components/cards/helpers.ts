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

// ── inline glossary (cards carrying `terms`) ────────────────────────────────

export type GlossSegment = {
  text: string;
  /** set when this segment is a matched glossary term */
  term?: string;
  gloss?: string;
};

/** Escape a term for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORDISH = /[\p{L}\p{N}_]/u;

/** Ranges of `text` that sit inside backticks — code, never glossed. */
function codeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /`[^`\n]*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Split `text` into plain + glossed segments. Matching rules (tested in
 * tests/cards.glossary.test.ts):
 *   - whole words only (a term never matches inside a longer word)
 *   - case-insensitive, but the ORIGINAL casing of the text is preserved
 *   - FIRST occurrence of each term only — a card underlines a word once
 *   - never inside `code spans`
 *   - overlapping terms: the earlier match in the text wins
 */
export function splitGlossed(
  text: string,
  terms?: ReadonlyArray<{ term: string; gloss: string }> | null,
): GlossSegment[] {
  if (!text) return [];
  const list = (terms ?? []).filter((t) => t && t.term.trim().length > 0);
  if (list.length === 0) return [{ text }];

  const skip = codeRanges(text);
  const inCode = (a: number, b: number) => skip.some(([s, e]) => a < e && b > s);

  type Hit = { start: number; end: number; term: string; gloss: string };
  const hits: Hit[] = [];
  for (const { term, gloss } of list) {
    const needle = term.trim();
    // a term the writer gave as "TTL" still has to catch "TTLs" in the copy
    const plural = WORDISH.test(needle[needle.length - 1]) ? "(?:['\u2019]s|es|s)?" : "";
    const re = new RegExp(escapeRe(needle) + plural, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (re.lastIndex === m.index) re.lastIndex++;         // zero-length guard
      const before = start > 0 ? text[start - 1] : "";
      const after = end < text.length ? text[end] : "";
      const boundaryOk =
        (!WORDISH.test(needle[0]) || !before || !WORDISH.test(before)) &&
        (!WORDISH.test(needle[needle.length - 1]) || !after || !WORDISH.test(after));
      if (!boundaryOk || inCode(start, end)) continue;
      hits.push({ start, end, term: needle, gloss });
      break;                                                 // first occurrence only
    }
  }
  if (hits.length === 0) return [{ text }];

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: GlossSegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;                          // overlapped by an earlier hit
    if (h.start > cursor) out.push({ text: text.slice(cursor, h.start) });
    out.push({ text: text.slice(h.start, h.end), term: h.term, gloss: h.gloss });
    cursor = h.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

// ── stat card sizing + scale ────────────────────────────────────────────────

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/**
 * Parse a schema `value` string ("80%", "1.2M", "0.2ms", "$4.5k", "10x") into a
 * number plus the unit that survives it. k/M/B/T fold into the number so
 * "1.2M" and "300k" are directly comparable.
 */
export function parseStatValue(raw: string): { n: number; unit: string } | null {
  const s = raw.trim().replace(/,/g, "");
  const m = /^([^\d.\-+]*)([-+]?\d*\.?\d+)\s*([a-zA-Z%µ/]*)$/.exec(s);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  let unit = (m[3] ?? "").trim();
  let mult = 1;
  if (unit.length > 0) {
    const head = unit[0].toLowerCase();
    const isBare = unit.length === 1;
    const isMag = MAGNITUDE[head] !== undefined;
    // "1.2M" → magnitude; "3ms" → milliseconds (m followed by more letters is a unit, not a magnitude)
    if (isMag && (isBare || (head !== "m" && head !== "b" && head !== "t"))) {
      mult = MAGNITUDE[head];
      unit = unit.slice(1);
    }
  }
  return { n: n * mult, unit: unit.toLowerCase() };
}

/**
 * Bar fractions (0..1) for a stat and its comparison, or null when the two
 * numbers aren't comparable (different units / unparseable / non-positive).
 * The smaller bar keeps a visible sliver so a 1000× gap still reads as a bar.
 */
export function statBars(value: string, compare: string): { value: number; compare: number } | null {
  const a = parseStatValue(value);
  const b = parseStatValue(compare);
  if (!a || !b || a.unit !== b.unit) return null;
  if (!(a.n > 0) || !(b.n > 0)) return null;
  const max = Math.max(a.n, b.n);
  const floor = 0.04;
  return {
    value: Math.max(floor, Math.min(1, a.n / max)),
    compare: Math.max(floor, Math.min(1, b.n / max)),
  };
}

/**
 * Font size (px) for the huge number on a stat card. The unit rides beside the
 * number at ~0.34em, so it counts as roughly a third of a character each.
 */
export function statFontSize(value: string, unit?: string): number {
  const len = value.length + (unit ? unit.length * 0.42 : 0);
  return fitFontSize("x".repeat(Math.ceil(len)), [
    [2, 140], [3, 124], [4, 108], [5, 94], [6, 82], [7, 74], [8, 66], [10, 56], [12, 47], [Infinity, 42],
  ]);
}

// ── sentence pieces (prose that arrives a beat at a time) ───────────────────

/**
 * Words that end in a period and keep going. Deliberately short: a missed split
 * just means a longer piece, while splitting "e.g. redis" mid-thought reads
 * like a stutter.
 */
const ABBREV = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "approx", "fig", "vol", "est", "cf", "al", "inc", "ltd", "dept", "aka", "ca",
]);

const TERMINATOR = /[.!?…]/;
const TRAILING = /[.!?…"'”’)\]]/;

/** Whether the terminator at `i` really ends a sentence (vs "3.5", "e.g.", "U.S."). */
function endsSentence(text: string, i: number): boolean {
  if (text[i] !== ".") return true;
  const before = text.slice(0, i);
  const word = /([A-Za-z]+)$/.exec(before);
  if (word) {
    const w = word[1].toLowerCase();
    if (ABBREV.has(w)) return false;
    // a lone letter before the dot is an initial ("e.g", "U.S", "a. big") — but
    // "1.2M." is a number wearing a letter, and that really can end a sentence
    if (w.length === 1) {
      const prev = before[before.length - 2];
      if (prev === undefined || prev === "." || /\s/.test(prev)) return false;
    }
  }
  return true;
}

/**
 * Split prose into sentence pieces for a cascade. LOSSLESS: the pieces rejoin
 * to the input byte for byte (`splitSentences(t).join("") === t`), so nothing
 * the writer wrote can go missing between the schema and the screen. Trailing
 * whitespace rides with the piece it follows; no piece is ever empty.
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!TERMINATOR.test(text[i])) continue;
    let end = i;
    while (end + 1 < text.length && TRAILING.test(text[end + 1])) end++;
    const after = text[end + 1];
    if (after !== undefined && !/\s/.test(after)) { i = end; continue; }
    if (!endsSentence(text, i)) { i = end; continue; }
    let cut = end + 1;
    while (cut < text.length && /\s/.test(text[cut])) cut++;
    out.push(text.slice(start, cut));
    start = cut;
    i = cut - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

// ── counting up to an authored value (components/ui/Odometer) ───────────────

export type Countable = {
  /** the magnitude the count travels to */
  to: number;
  /** what to paint at `n` — exactly the authored string once it lands */
  at: (n: number) => string;
};

/**
 * Plan a count-up for an authored value ("1.2M", "$0.02", "80%"). Only the
 * digits move: the prefix, the unit and the writer's own thousands separators
 * ride along verbatim, so the number that lands is byte for byte the number the
 * card claims.
 *
 * null when there is nothing honest to count to — an approximation ("~3"), a
 * bound ("<1ms"), a range, a zero, or any shape we can't reproduce exactly.
 * Those render at once instead of rolling.
 */
export function countTo(raw: string): Countable | null {
  const m = /^(-?[$€£¥]?)([\d,]*\d(?:\.\d+)?)(\s*)([a-zA-Z%µ/]*)$/.exec(raw.trim());
  if (!m) return null;
  const [, prefix, digits, gap, suffix] = m;
  if (!parseStatValue(raw)) return null;
  const to = Number(digits.replace(/,/g, ""));
  const decimals = (digits.split(".")[1] ?? "").length;
  if (!Number.isFinite(to) || to === 0 || decimals > 20) return null;
  const grouped = digits.includes(",");
  const frame = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
  // can't reproduce the writer's own digits → no business animating them
  if (frame(to) !== digits) return null;
  return {
    to,
    at: (n) => {
      const s = frame(Math.max(0, Math.min(n, to)));
      return s === digits ? raw : `${prefix}${s}${gap}${suffix}`;
    },
  };
}

// ── prose that assembles (components/cards/Glossed, `cascade`) ──────────────

/** A piece that ends on a terminator — the next segment starts a new thought. */
const CLOSES_SENTENCE = /[.!?…][)"'”’\]]*\s*$/;

/**
 * Group glossed segments into sentence runs so a paragraph can land a sentence
 * at a time instead of as one slab. LOSSLESS: the runs flatten back to exactly
 * the text that went in, and a glossed term is never cut across a run — an
 * underline arriving in two halves reads as a rendering bug, not as rhythm.
 */
export function sentenceRuns(segments: readonly GlossSegment[]): GlossSegment[][] {
  const runs: GlossSegment[][] = [];
  let cur: GlossSegment[] = [];
  const cut = () => {
    if (cur.length) { runs.push(cur); cur = []; }
  };
  for (const seg of segments) {
    if (seg.gloss) { cur.push(seg); continue; }
    const pieces = splitSentences(seg.text);
    for (let i = 0; i < pieces.length; i++) {
      cur.push({ text: pieces[i] });
      // the tail piece of a segment only closes the run when it actually ended a
      // sentence; otherwise the glossed word after it is still mid-thought
      if (i < pieces.length - 1 || CLOSES_SENTENCE.test(pieces[i])) cut();
    }
  }
  cut();
  return runs;
}

/**
 * Split `terms` into the ones `text` will really underline and the ones left
 * for the copy after it. A card that renders in two pieces (a lede and its
 * elaboration, three recap beats) has to hand each term to exactly ONE of them:
 * the same word underlined twice on one screen reads as two different words.
 */
export function claimTerms<T extends { term: string; gloss: string }>(
  text: string,
  terms?: readonly T[] | null,
): { claimed: T[]; left: T[] } {
  const list = terms ?? [];
  if (list.length === 0) return { claimed: [], left: [] };
  const hit = new Set(splitGlossed(text, list).map((s) => s.term).filter(Boolean) as string[]);
  const claimed = list.filter((t) => hit.has(t.term.trim()));
  return { claimed, left: list.filter((t) => !claimed.includes(t)) };
}

/**
 * A paragraph read as a lede plus its elaboration: the first sentence carries
 * the idea at a bigger size, the rest arrives under it. `rest` is empty when
 * there is only one sentence, or when the first one is long enough that
 * promoting it would just make the wall of text bigger.
 */
export function ledeAndRest(text: string, maxLede = 150): { lede: string; rest: string } {
  const pieces = splitSentences(text);
  if (pieces.length < 2) return { lede: text, rest: "" };
  if (pieces[0].trim().length > maxLede) return { lede: text, rest: "" };
  return { lede: pieces[0], rest: pieces.slice(1).join("") };
}
