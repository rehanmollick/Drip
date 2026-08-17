import type { DiagramCard } from "@/lib/schemas/cards";

/**
 * Pure layout for the 6 diagram variants. No DOM, no React — every function
 * here takes nodes/edges + a box {w,h} (px) and returns positioned nodes,
 * SVG edge paths (with arrowhead + label anchors) and decor (spine, divider,
 * dots). DiagramRenderer.tsx turns this into themed HTML nodes over an SVG
 * edge layer; tests/diagrams.layout.test.ts pins the invariants (everything
 * inside the box, no NaN, unknown edge ids dropped, ring/level order).
 *
 * Rhythm: 8px grid, 12px node radius, hairline strokes. Text is measured with
 * char-count heuristics (no canvas) — the renderer clamps lines with CSS, so
 * the heuristics only need to be conservative, never exact.
 */

export type Box = { w: number; h: number };
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type DiagramVariant = DiagramCard["variant"];
export type DiagramNodeSpec = DiagramCard["nodes"][number];
export type DiagramEdgeSpec = DiagramCard["edges"][number];

/* --- rhythm + type constants (the renderer mirrors these) --- */
export const GRID = 8;
export const NODE_RADIUS = 12;
export const LABEL_SIZES = [14.5, 13.5, 12.5, 11.5] as const;
export const LABEL_LINE_H = 17;
export const SUB_PX = 11.5;
export const SUB_LINE_H = 14;
export const NODE_PAD_X = 12;
export const NODE_PAD_Y = 10;
export const EDGE_LABEL_PX = 10.5;
export const ARROW_LEN = 8;
/**
 * Average glyph advance / font-size used by the char-count heuristics.
 * Defaults are conservative (a wide grotesk); pass the theme's faces via
 * `metricsForFonts` for tighter wrapping predictions.
 */
export type TextMetrics = { labelEm: number; subEm: number; monoEm: number };
export const DEFAULT_METRICS: TextMetrics = { labelEm: 0.6, subEm: 0.52, monoEm: 0.62 };
const MONO_EM = 0.62;
/** avg lowercase advance per em, display faces at 600 */
const DISPLAY_EM: Record<string, number> = {
  "space-grotesk": 0.58, "bricolage-grotesque": 0.6, syne: 0.66, unbounded: 0.74, fraunces: 0.55,
  "playfair-display": 0.55, "instrument-serif": 0.48, "zilla-slab": 0.55, "dm-sans": 0.57, manrope: 0.6, nunito: 0.57,
};
/** avg lowercase advance per em, body faces at 400 */
const BODY_EM: Record<string, number> = {
  "dm-sans": 0.52, "ibm-plex-sans": 0.55, manrope: 0.55, nunito: 0.53, "source-serif-4": 0.5,
  fraunces: 0.5, "zilla-slab": 0.52, "space-grotesk": 0.55, "bricolage-grotesque": 0.56,
};
export function metricsForFonts(display?: string, body?: string): TextMetrics {
  return {
    labelEm: (display && DISPLAY_EM[display]) || DEFAULT_METRICS.labelEm,
    subEm: (body && BODY_EM[body]) || DEFAULT_METRICS.subEm,
    monoEm: MONO_EM,
  };
}

export type LayoutNode = {
  id: string;
  label: string;
  sub?: string;
  emphasis: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** wrapped label (<=2 lines) — the renderer clamps to labelLines.length */
  labelLines: string[];
  /** wrapped sub (<=2 lines); empty when the node is too short to show it */
  subLines: string[];
  fontSize: number;
  /** center = label over sub, centered; row = label left / sub right (layers) */
  textLayout: "center" | "row";
  /** stagger index for the entry animation */
  order: number;
  /** timeline / compare: which side */
  side?: "left" | "right";
};

export type LayoutEdge = {
  key: string;
  from: string;
  to: string;
  /** SVG path; "" when the edge is label-only (timeline consecutive labels ride the spine) */
  d: string;
  label?: string;
  labelAt: Pt;
  labelRotate: number;
  arrow: { x: number; y: number; angle: number } | null;
  /** drawn by the layout, not the AI (cycle ring when edges are absent / open) */
  implicit?: boolean;
};

export type Decor =
  | { kind: "line"; key: string; d: string; dashed?: boolean; order?: number }
  | { kind: "dot"; key: string; x: number; y: number; r: number; emphasis: boolean; order: number };

export type DiagramLayout = {
  variant: DiagramVariant;
  box: Box;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  decor: Decor[];
};

/* ------------------------------ text heuristics ------------------------------ */

export function textWidth(text: string, px: number, em: number): number {
  return text.length * px * em;
}

/** Greedy word wrap into <= maxLines lines (overflow merges into the last line; the renderer clamps). */
export function wrapText(text: string, maxWidth: number, px: number, em: number, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(cand, px, em) <= maxWidth) cur = cand;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")];
  return lines;
}

/** Largest label size whose longest word fits innerW (min 11.5px). */
export function fitLabelSize(text: string, innerW: number, labelEm = DEFAULT_METRICS.labelEm): number {
  const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  for (const px of LABEL_SIZES) if (longest * px * labelEm <= innerW) return px;
  return LABEL_SIZES[LABEL_SIZES.length - 1];
}

function rawHeight(labelLines: number, subLines: number): number {
  return 2 * NODE_PAD_Y + labelLines * LABEL_LINE_H + (subLines ? 4 + subLines * SUB_LINE_H : 0);
}

/** Preferred node height on the 8px grid. */
export function nodeHeight(labelLines: number, subLines: number): number {
  return Math.ceil(rawHeight(labelLines, subLines) / GRID) * GRID;
}

type Measured = {
  labelLines: string[];
  subLines: string[];
  fontSize: number;
  textLayout: "center" | "row";
  prefH: number;
};

function measureNode(spec: DiagramNodeSpec, w: number, opts: { row?: boolean; maxSubLines?: number; em?: TextMetrics } = {}): Measured {
  const em = opts.em ?? DEFAULT_METRICS;
  const innerW = Math.max(24, w - 2 * NODE_PAD_X);
  const fontSize = fitLabelSize(spec.label, innerW, em.labelEm);
  if (opts.row && spec.sub) {
    const lw = textWidth(spec.label, fontSize, em.labelEm);
    const sw = textWidth(spec.sub, SUB_PX, em.subEm);
    if (lw + sw + 16 <= innerW) {
      return { labelLines: [spec.label], subLines: [spec.sub], fontSize, textLayout: "row", prefH: 40 };
    }
  }
  const labelLines = wrapText(spec.label, innerW, fontSize, em.labelEm, 2);
  const subLines = spec.sub ? wrapText(spec.sub, innerW, SUB_PX, em.subEm, opts.maxSubLines ?? 2) : [];
  return { labelLines, subLines, fontSize, textLayout: "center", prefH: nodeHeight(labelLines.length, subLines.length) };
}

/** Assemble a LayoutNode, dropping sub lines the final height cannot hold. */
function placeNode(spec: DiagramNodeSpec, m: Measured, r: Rect, order: number, side?: "left" | "right"): LayoutNode {
  let subLines = m.subLines;
  if (m.textLayout === "center") {
    while (subLines.length && rawHeight(m.labelLines.length, subLines.length) > r.h + 2) subLines = subLines.slice(0, -1);
  } else if (r.h < 30) {
    subLines = [];
  }
  return {
    id: spec.id,
    label: spec.label,
    sub: spec.sub,
    emphasis: !!spec.emphasis,
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
    labelLines: m.labelLines,
    subLines,
    fontSize: m.fontSize,
    textLayout: subLines.length ? m.textLayout : "center",
    order,
    ...(side ? { side } : {}),
  };
}

/* ------------------------------ geometry ------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const f = (n: number) => String(Math.round(n * 10) / 10);
const deg = (rad: number) => (rad * 180) / Math.PI;
const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const rectOf = (n: LayoutNode): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h });

/** Point where the ray from rect center toward `toward` leaves the rect (inflated by `gap`). */
export function rectAnchor(r: Rect, toward: Pt, gap = 2): Pt {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { x: r.x + r.w + gap, y: c.y };
  const hw = r.w / 2 + gap;
  const hh = r.h / 2 + gap;
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

type PathGeom = { d: string; mid: Pt; end: Pt; angle: number };

function linePath(a: Pt, b: Pt): PathGeom {
  return {
    d: `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    end: b,
    angle: deg(Math.atan2(b.y - a.y, b.x - a.x)),
  };
}

function bez(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const mt = 1 - t;
  const w0 = mt * mt * mt;
  const w1 = 3 * mt * mt * t;
  const w2 = 3 * mt * t * t;
  const w3 = t * t * t;
  return { x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y };
}

function cubicPath(a: Pt, c1: Pt, c2: Pt, b: Pt): PathGeom {
  let dx = b.x - c2.x;
  let dy = b.y - c2.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    dx = b.x - c1.x;
    dy = b.y - c1.y;
  }
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    dx = b.x - a.x;
    dy = b.y - a.y;
  }
  return {
    d: `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`,
    mid: bez(a, c1, c2, b, 0.5),
    end: b,
    angle: deg(Math.atan2(dy, dx)),
  };
}

/** Smooth S-curve between two points with tangents along `axis`. */
function sCurve(a: Pt, b: Pt, axis: "x" | "y"): PathGeom {
  if (axis === "y") {
    if (Math.abs(a.x - b.x) < 0.5) return linePath(a, b);
    const my = (a.y + b.y) / 2;
    return cubicPath(a, { x: a.x, y: my }, { x: b.x, y: my }, b);
  }
  if (Math.abs(a.y - b.y) < 0.5) return linePath(a, b);
  const mx = (a.x + b.x) / 2;
  return cubicPath(a, { x: mx, y: a.y }, { x: mx, y: b.y }, b);
}

/** Loop out to one side (skip/back edges): tangents perpendicular to the flow axis. */
function bulgePath(a: Pt, b: Pt, side: "left" | "right" | "up" | "down", amount: number): PathGeom {
  const k = amount * 1.25;
  switch (side) {
    case "right":
      return cubicPath(a, { x: a.x + k, y: a.y }, { x: b.x + k, y: b.y }, b);
    case "left":
      return cubicPath(a, { x: a.x - k, y: a.y }, { x: b.x - k, y: b.y }, b);
    case "down":
      return cubicPath(a, { x: a.x, y: a.y + k }, { x: b.x, y: b.y + k }, b);
    case "up":
      return cubicPath(a, { x: a.x, y: a.y - k }, { x: b.x, y: b.y - k }, b);
  }
}

function mkEdge(
  key: string,
  spec: Pick<DiagramEdgeSpec, "from" | "to" | "label">,
  g: PathGeom,
  opts: { rotate?: number; implicit?: boolean; arrow?: boolean } = {},
): LayoutEdge {
  return {
    key,
    from: spec.from,
    to: spec.to,
    d: g.d,
    ...(spec.label ? { label: spec.label } : {}),
    labelAt: { x: Math.round(g.mid.x * 10) / 10, y: Math.round(g.mid.y * 10) / 10 },
    labelRotate: opts.rotate ?? 0,
    arrow:
      opts.arrow === false
        ? null
        : { x: Math.round(g.end.x * 10) / 10, y: Math.round(g.end.y * 10) / 10, angle: Math.round(g.angle * 10) / 10 },
    ...(opts.implicit ? { implicit: true } : {}),
  };
}

/** Drop edges that reference unknown ids or loop on themselves; de-dupe exact repeats. */
export function validEdges(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[]): DiagramEdgeSpec[] {
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const out: DiagramEdgeSpec[] = [];
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const k = `${e.from} ${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

const maxEdgeLabel = (edges: readonly DiagramEdgeSpec[]) => edges.reduce((m, e) => Math.max(m, e.label?.length ?? 0), 0);

/** Approximate rendered width of an edge label chip (mono, padded). */
export function edgeLabelWidth(label: string): number {
  return Math.ceil(textWidth(label, EDGE_LABEL_PX, MONO_EM) + 12);
}

/* ------------------------------ flow ------------------------------ */

/**
 * Topological levels (Kahn), cycles broken by node order, unknown ids ignored.
 * Within a level nodes are ordered by the barycenter of their predecessors.
 */
export function flowLevels(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[]): string[][] {
  const ids = nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const es = validEdges(nodes, edges);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of es) {
    out.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const level = new Map<string, number>();
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) level.set(id, 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of out.get(u)!) {
      level.set(v, Math.max(level.get(v) ?? 0, level.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  // cycles: seed the first unplaced node (in node order) after its placed preds, then relax forward
  for (const id of ids) {
    if (level.has(id)) continue;
    const placedPreds = preds.get(id)!.filter((p) => level.has(p));
    level.set(id, placedPreds.length ? Math.max(...placedPreds.map((p) => level.get(p)!)) + 1 : 0);
    const q = [id];
    while (q.length) {
      const u = q.shift()!;
      for (const v of out.get(u)!) {
        if (level.has(v)) continue;
        level.set(v, level.get(u)! + 1);
        q.push(v);
      }
    }
  }
  const K = Math.max(...ids.map((id) => level.get(id)!)) + 1;
  const levels: string[][] = Array.from({ length: K }, () => []);
  for (const id of ids) levels[level.get(id)!].push(id);
  // barycenter ordering, one pass top-down
  const pos = new Map<string, number>();
  levels[0].forEach((id, i) => pos.set(id, i));
  for (let L = 1; L < K; L++) {
    const key = (id: string) => {
      const ps = preds.get(id)!.filter((p) => level.get(p) === L - 1);
      if (!ps.length) return index.get(id)! * 1000 + 500;
      return (ps.reduce((s, p) => s + pos.get(p)!, 0) / ps.length) * 1000;
    };
    levels[L].sort((a, b) => key(a) - key(b) || index.get(a)! - index.get(b)!);
    levels[L].forEach((id, i) => pos.set(id, i));
  }
  return levels;
}

/** Horizontal (levels left->right) when few levels fit side by side; otherwise vertical. */
export function flowOrientation(levels: readonly string[][], edges: readonly DiagramEdgeSpec[], box: Box): "h" | "v" {
  const K = levels.length;
  const ml = maxEdgeLabel(edges);
  const gapX = ml > 0 ? 40 : 28;
  const colW = (box.w - (K - 1) * gapX) / K;
  return K <= 4 && colW >= 88 && ml <= 8 ? "h" : "v";
}

export function layoutFlow(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const es = validEdges(nodes, edges);
  const levels = flowLevels(nodes, es);
  const orient = flowOrientation(levels, es, box);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const levelOf = new Map<string, number>();
  levels.forEach((l, i) => l.forEach((id) => levelOf.set(id, i)));
  const K = levels.length;
  const hasLabels = maxEdgeLabel(es) > 0;
  const placed = new Map<string, { m: Measured; r: Rect }>();
  const ordered: string[] = [];

  if (orient === "v") {
    const gapX = 16;
    let gapY = hasLabels ? 36 : 32;
    // shared width for single-node rows: content-fit, clamped
    const singles = levels.filter((l) => l.length === 1).map((l) => byId.get(l[0])!);
    const contentW = singles.reduce(
      (m, n) => Math.max(m, textWidth(n.label, LABEL_SIZES[0], em.labelEm), textWidth(n.sub ?? "", SUB_PX, em.subEm)),
      0,
    );
    const singleW = clamp(Math.ceil((contentW + 2 * NODE_PAD_X + 16) / GRID) * GRID, 136, Math.min(240, box.w - 16));
    const rows = levels.map((l) => {
      const m = l.length;
      const w = m === 1 ? singleW : Math.floor((box.w - (m - 1) * gapX) / m);
      const ms = l.map((id) => measureNode(byId.get(id)!, w, { em }));
      return { ids: l, w, ms, h: Math.max(...ms.map((x) => x.prefH)) };
    });
    let sumH = rows.reduce((s, r) => s + r.h, 0);
    if (sumH + (K - 1) * gapY > box.h) {
      // too tall: tighten the gaps first (min 20), then scale rows + gaps together
      gapY = Math.max(20, Math.floor((box.h - sumH) / Math.max(1, K - 1)));
      if (sumH + (K - 1) * gapY > box.h) {
        const k = box.h / (sumH + (K - 1) * gapY);
        for (const r of rows) r.h = Math.max(8, Math.floor((r.h * k) / 2) * 2);
        gapY = Math.max(4, Math.floor(gapY * k));
        sumH = rows.reduce((s, r) => s + r.h, 0);
      }
    } else {
      const slack = box.h - sumH - (K - 1) * gapY;
      gapY = Math.min(48, gapY + Math.floor(slack / Math.max(1, K - 1)));
    }
    const total = sumH + (K - 1) * gapY;
    let y = Math.round((box.h - total) / 2);
    for (const r of rows) {
      const rowW = r.ids.length * r.w + (r.ids.length - 1) * gapX;
      let x = Math.round((box.w - rowW) / 2);
      r.ids.forEach((id, i) => {
        placed.set(id, { m: r.ms[i], r: { x, y, w: r.w, h: r.h } });
        ordered.push(id);
        x += r.w + gapX;
      });
      y += r.h + gapY;
    }
  } else {
    const gapX = hasLabels ? 40 : 28;
    const gapY = 12;
    const colW = Math.floor((box.w - (K - 1) * gapX) / K);
    const cols = levels.map((l) => {
      const ms = l.map((id) => measureNode(byId.get(id)!, colW, { em }));
      let hs = ms.map((m) => m.prefH);
      const gaps = (l.length - 1) * gapY;
      const sum = hs.reduce((s, h) => s + h, 0);
      if (sum + gaps > box.h) {
        const k = Math.max(0, box.h - gaps) / sum;
        hs = hs.map((h) => Math.max(8, Math.floor((h * k) / 2) * 2));
      }
      return { ids: l, ms, hs };
    });
    const totalW = K * colW + (K - 1) * gapX;
    let x = Math.round((box.w - totalW) / 2);
    for (const c of cols) {
      const colH = c.hs.reduce((s, h) => s + h, 0) + (c.ids.length - 1) * gapY;
      let y = Math.round((box.h - colH) / 2);
      c.ids.forEach((id, i) => {
        placed.set(id, { m: c.ms[i], r: { x, y, w: colW, h: c.hs[i] } });
        ordered.push(id);
        y += c.hs[i] + gapY;
      });
      x += colW + gapX;
    }
  }

  const outNodes: LayoutNode[] = ordered.map((id, i) => {
    const p = placed.get(id)!;
    return placeNode(byId.get(id)!, p.m, p.r, i);
  });
  const rect = new Map(outNodes.map((n) => [n.id, rectOf(n)]));
  const minX = Math.min(...outNodes.map((n) => n.x));
  const maxX = Math.max(...outNodes.map((n) => n.x + n.w));
  const minY = Math.min(...outNodes.map((n) => n.y));
  const maxY = Math.max(...outNodes.map((n) => n.y + n.h));

  const outEdges: LayoutEdge[] = es.map((e, i) => {
    const A = rect.get(e.from)!;
    const B = rect.get(e.to)!;
    const la = levelOf.get(e.from)!;
    const lb = levelOf.get(e.to)!;
    const key = `${e.from}->${e.to}#${i}`;
    if (orient === "v") {
      if (lb === la + 1) {
        const g = sCurve({ x: A.x + A.w / 2, y: A.y + A.h + 2 }, { x: B.x + B.w / 2, y: B.y - 2 }, "y");
        // tight rows: put the label beside the arrow instead of on top of it
        if (e.label && B.y - (A.y + A.h) < 40) g.mid = { x: g.mid.x + edgeLabelWidth(e.label) / 2 + 8, y: g.mid.y };
        return mkEdge(key, e, g);
      }
      if (lb > la) {
        const margin = box.w - maxX;
        if (margin >= 20) {
          const b = Math.min(36, margin - 6);
          return mkEdge(key, e, bulgePath({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x + B.w + 2, y: B.y + B.h / 2 }, "right", b));
        }
        return mkEdge(key, e, sCurve({ x: A.x + A.w / 2, y: A.y + A.h + 2 }, { x: B.x + B.w / 2, y: B.y - 2 }, "y"));
      }
      if (lb === la) {
        const aLeft = A.x <= B.x;
        return mkEdge(
          key,
          e,
          aLeft
            ? linePath({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 })
            : linePath({ x: A.x - 2, y: A.y + A.h / 2 }, { x: B.x + B.w + 2, y: B.y + B.h / 2 }),
        );
      }
      // backward: loop around the left
      const margin = minX;
      if (margin >= 20) {
        const b = Math.min(36, margin - 6);
        return mkEdge(key, e, bulgePath({ x: A.x - 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 }, "left", b));
      }
      return mkEdge(key, e, sCurve({ x: A.x + A.w / 2, y: A.y - 2 }, { x: B.x + B.w / 2, y: B.y + B.h + 2 }, "y"));
    }
    // horizontal
    if (lb === la + 1) {
      const g = sCurve({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 }, "x");
      // labels float just above the connector so the arrowhead stays visible
      if (e.label) g.mid = { x: g.mid.x, y: g.mid.y - 12 };
      return mkEdge(key, e, g);
    }
    if (lb > la) {
      const margin = box.h - maxY;
      if (margin >= 20) {
        const b = Math.min(36, margin - 6);
        return mkEdge(key, e, bulgePath({ x: A.x + A.w / 2, y: A.y + A.h + 2 }, { x: B.x + B.w / 2, y: B.y + B.h + 2 }, "down", b));
      }
      return mkEdge(key, e, sCurve({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 }, "x"));
    }
    if (lb === la) {
      const aAbove = A.y <= B.y;
      return mkEdge(
        key,
        e,
        aAbove
          ? linePath({ x: A.x + A.w / 2, y: A.y + A.h + 2 }, { x: B.x + B.w / 2, y: B.y - 2 })
          : linePath({ x: A.x + A.w / 2, y: A.y - 2 }, { x: B.x + B.w / 2, y: B.y + B.h + 2 }),
      );
    }
    const margin = minY;
    if (margin >= 20) {
      const b = Math.min(36, margin - 6);
      return mkEdge(key, e, bulgePath({ x: A.x + A.w / 2, y: A.y - 2 }, { x: B.x + B.w / 2, y: B.y - 2 }, "up", b));
    }
    return mkEdge(key, e, sCurve({ x: A.x - 2, y: A.y + A.h / 2 }, { x: B.x + B.w + 2, y: B.y + B.h / 2 }, "x"));
  });

  return { variant: "flow", box, nodes: outNodes, edges: outEdges, decor: [] };
}

/* ------------------------------ boxes ------------------------------ */

export function layoutBoxes(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const n = nodes.length;
  const cols = n >= 7 ? 3 : 2;
  const rows = Math.ceil(n / cols);
  const gap = 12;
  const cellW = Math.floor((box.w - (cols - 1) * gap) / cols);
  const ms = nodes.map((s) => measureNode(s, cellW, { em }));
  const maxPref = Math.max(...ms.map((m) => m.prefH));
  const avail = Math.floor((box.h - (rows - 1) * gap) / rows);
  let cellH = Math.min(Math.max(maxPref + 8, 56), 112);
  cellH = Math.max(24, Math.min(cellH, avail));
  cellH = Math.floor(cellH / 2) * 2;
  const gridH = rows * cellH + (rows - 1) * gap;
  const y0 = Math.round((box.h - gridH) / 2);
  const outNodes = nodes.map((s, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cellW + (inRow - 1) * gap;
    const x0 = Math.round((box.w - rowW) / 2);
    return placeNode(s, ms[i], { x: x0 + c * (cellW + gap), y: y0 + r * (cellH + gap), w: cellW, h: cellH }, i);
  });
  const rect = new Map(outNodes.map((nd) => [nd.id, rectOf(nd)]));
  const outEdges = validEdges(nodes, edges).map((e, i) => {
    const A = rect.get(e.from)!;
    const B = rect.get(e.to)!;
    const a = rectAnchor(A, center(B), 2);
    const b = rectAnchor(B, center(A), 2);
    const g = linePath(a, b);
    // grid gaps are tight: float labels above horizontal connectors, beside vertical ones
    if (e.label) {
      g.mid = Math.abs(b.y - a.y) < Math.abs(b.x - a.x)
        ? { x: g.mid.x, y: g.mid.y - 12 }
        : { x: g.mid.x + edgeLabelWidth(e.label) / 2 + 8, y: g.mid.y };
    }
    return mkEdge(`${e.from}->${e.to}#${i}`, e, g);
  });
  return { variant: "boxes", box, nodes: outNodes, edges: outEdges, decor: [] };
}

/* ------------------------------ timeline ------------------------------ */

export function layoutTimeline(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const n = nodes.length;
  const maxLabel = nodes.reduce((m, s) => Math.max(m, s.label.length), 0);
  const maxSub = nodes.reduce((m, s) => Math.max(m, s.sub?.length ?? 0), 0);
  const alternate = box.w >= 300 && maxLabel <= 16 && maxSub <= 26;
  const dotR = 5;
  const gapToSpine = 24;
  let spineX: number;
  let nodeW: number;
  let leftX: number;
  let rightX: number;
  if (alternate) {
    spineX = Math.floor(box.w / 2);
    nodeW = Math.min(spineX, box.w - spineX) - gapToSpine;
    leftX = spineX - gapToSpine - nodeW;
    rightX = spineX + gapToSpine;
  } else {
    spineX = 16;
    nodeW = box.w - 48;
    leftX = 48;
    rightX = 48;
  }
  const ms = nodes.map((s) => measureNode(s, nodeW, { em }));
  let h = Math.max(...ms.map((m) => m.prefH));
  const hCap = alternate ? Math.floor((2 * box.h - 8 * (n - 1)) / (n + 1)) : Math.floor((box.h - 8 * (n - 1)) / n);
  h = Math.max(24, Math.min(h, Math.floor(hCap / 2) * 2));
  const maxPitch = alternate ? 96 : 88;
  const pitch = Math.min(maxPitch, (box.h - h) / (n - 1));
  const total = h + (n - 1) * pitch;
  const cy0 = (box.h - total) / 2 + h / 2;
  const ys = nodes.map((_, i) => Math.round(cy0 + i * pitch));

  const outNodes = nodes.map((s, i) => {
    const side: "left" | "right" = alternate ? (i % 2 === 0 ? "left" : "right") : "right";
    const x = side === "left" ? leftX : rightX;
    return placeNode(s, ms[i], { x, y: ys[i] - h / 2, w: nodeW, h }, i, side);
  });

  const decor: Decor[] = [{ kind: "line", key: "spine", d: `M${spineX} ${ys[0]}L${spineX} ${ys[n - 1]}` }];
  outNodes.forEach((nd, i) => {
    const tickTo = nd.side === "left" ? nd.x + nd.w + 2 : nd.x - 2;
    const tickFrom = nd.side === "left" ? spineX - dotR - 1 : spineX + dotR + 1;
    decor.push({ kind: "line", key: `tick-${nd.id}`, d: `M${tickFrom} ${ys[i]}L${tickTo} ${ys[i]}`, order: i });
    decor.push({ kind: "dot", key: `dot-${nd.id}`, x: spineX, y: ys[i], r: nd.emphasis ? dotR + 1 : dotR, emphasis: nd.emphasis, order: i });
  });

  const idx = new Map(nodes.map((s, i) => [s.id, i]));
  const outEdges: LayoutEdge[] = [];
  validEdges(nodes, edges).forEach((e, i) => {
    const a = idx.get(e.from)!;
    const b = idx.get(e.to)!;
    const key = `${e.from}->${e.to}#${i}`;
    if (Math.abs(a - b) === 1) {
      if (!e.label) return; // the spine already says it
      outEdges.push({
        key,
        from: e.from,
        to: e.to,
        d: "",
        label: e.label,
        labelAt: { x: spineX, y: Math.round((ys[a] + ys[b]) / 2) },
        labelRotate: 0,
        arrow: null,
      });
      return;
    }
    const down = b > a;
    const g = bulgePath(
      { x: spineX, y: ys[a] + (down ? dotR + 1 : -(dotR + 1)) },
      { x: spineX, y: ys[b] - (down ? dotR + 2 : -(dotR + 2)) },
      alternate ? "left" : "right",
      alternate ? 16 : 22,
    );
    outEdges.push(mkEdge(key, e, g, { rotate: -90 })); // skip arcs are vertical: labels read along them
  });

  return { variant: "timeline", box, nodes: outNodes, edges: outEdges, decor };
}

/* ------------------------------ compare ------------------------------ */

export function layoutCompare(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const n = nodes.length;
  const nL = Math.ceil(n / 2);
  const left = nodes.slice(0, nL);
  const right = nodes.slice(nL);
  const es = validEdges(nodes, edges);
  // the divider gutter grows to hold the widest cross-connector label (labels ride the divider)
  const widestLabel = es.reduce((m, e) => Math.max(m, e.label ? edgeLabelWidth(e.label) : 0), 0);
  // The label rides the divider, so anything wider than the gutter lands on top of both columns.
  // A schema-max 20-char label is ~143px: give the gutter room for it, keeping the columns readable.
  const MIN_COL = 76;
  const gutterMax = Math.max(40, Math.min(Math.floor(box.w * 0.46), box.w - 2 * MIN_COL));
  const gutter = clamp(widestLabel + 12, 40, gutterMax);
  const colW = Math.floor((box.w - gutter) / 2);
  const leftX = 0;
  const rightX = box.w - colW;
  const mL = left.map((s) => measureNode(s, colW, { em }));
  const mR = right.map((s) => measureNode(s, colW, { em }));
  const rowsH = left.map((_, i) => Math.max(mL[i].prefH, mR[i]?.prefH ?? 0));
  let gapY = 12;
  let sum = rowsH.reduce((s, h) => s + h, 0);
  if (sum + (nL - 1) * gapY > box.h) {
    gapY = 8;
    if (sum + (nL - 1) * gapY > box.h) {
      const k = (box.h - (nL - 1) * gapY) / sum;
      for (let i = 0; i < rowsH.length; i++) rowsH[i] = Math.max(24, Math.floor((rowsH[i] * k) / 2) * 2);
      sum = rowsH.reduce((s, h) => s + h, 0);
    }
  } else {
    const slack = box.h - sum - (nL - 1) * gapY;
    gapY = Math.min(20, gapY + Math.floor(slack / Math.max(1, nL - 1)));
  }
  const total = sum + (nL - 1) * gapY;
  const y0 = Math.round((box.h - total) / 2);
  const outNodes: LayoutNode[] = [];
  let y = y0;
  let order = 0;
  for (let i = 0; i < nL; i++) {
    outNodes.push(placeNode(left[i], mL[i], { x: leftX, y, w: colW, h: rowsH[i] }, order++, "left"));
    if (right[i]) outNodes.push(placeNode(right[i], mR[i], { x: rightX, y, w: colW, h: rowsH[i] }, order++, "right"));
    y += rowsH[i] + gapY;
  }
  const rect = new Map(outNodes.map((nd) => [nd.id, rectOf(nd)]));
  const sideOf = new Map(outNodes.map((nd) => [nd.id, nd.side!]));
  const outEdges = es.map((e, i) => {
    const A = rect.get(e.from)!;
    const B = rect.get(e.to)!;
    const sa = sideOf.get(e.from)!;
    const sb = sideOf.get(e.to)!;
    const key = `${e.from}->${e.to}#${i}`;
    if (sa === "left" && sb === "right") {
      return mkEdge(key, e, sCurve({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 }, "x"));
    }
    if (sa === "right" && sb === "left") {
      return mkEdge(key, e, sCurve({ x: A.x - 2, y: A.y + A.h / 2 }, { x: B.x + B.w + 2, y: B.y + B.h / 2 }, "x"));
    }
    // same column: straight if vertically adjacent, else loop through the inner side
    const down = B.y > A.y;
    const adjacent = down ? B.y - (A.y + A.h) <= gapY + 1 : A.y - (B.y + B.h) <= gapY + 1;
    if (adjacent) {
      return mkEdge(
        key,
        e,
        down
          ? linePath({ x: A.x + A.w / 2, y: A.y + A.h + 2 }, { x: B.x + B.w / 2, y: B.y - 2 })
          : linePath({ x: A.x + A.w / 2, y: A.y - 2 }, { x: B.x + B.w / 2, y: B.y + B.h + 2 }),
      );
    }
    return sa === "left"
      ? mkEdge(key, e, bulgePath({ x: A.x + A.w + 2, y: A.y + A.h / 2 }, { x: B.x + B.w + 2, y: B.y + B.h / 2 }, "right", 14))
      : mkEdge(key, e, bulgePath({ x: A.x - 2, y: A.y + A.h / 2 }, { x: B.x - 2, y: B.y + B.h / 2 }, "left", 14));
  });
  const dx = Math.round(box.w / 2);
  const decor: Decor[] = [
    { kind: "line", key: "divider", d: `M${dx} ${Math.max(0, y0 - 6)}L${dx} ${Math.min(box.h, y0 + total + 6)}`, dashed: true },
  ];
  return { variant: "compare", box, nodes: outNodes, edges: outEdges, decor };
}

/* ------------------------------ cycle ------------------------------ */

/**
 * Ring order: follow the edges when they chain through every node (a->b->c->...),
 * otherwise node order. `closed` is true when the edges themselves loop back.
 */
export function cycleOrder(
  nodes: readonly DiagramNodeSpec[],
  edges: readonly DiagramEdgeSpec[],
): { order: string[]; fromEdges: boolean; closed: boolean } {
  const ids = nodes.map((n) => n.id);
  const es = validEdges(nodes, edges);
  if (!es.length) return { order: ids, fromEdges: false, closed: false };
  const next = new Map<string, string>();
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of es) {
    if (!next.has(e.from)) next.set(e.from, e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const start = ids.find((id) => indeg.get(id) === 0) ?? ids[0];
  const seen = new Set<string>();
  const order: string[] = [];
  let cur: string | undefined = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    order.push(cur);
    cur = next.get(cur);
  }
  if (order.length === ids.length) return { order, fromEdges: true, closed: cur === start };
  return { order: ids, fromEdges: false, closed: false };
}

const inRect = (p: Pt, r: Rect, gap: number) => p.x >= r.x - gap && p.x <= r.x + r.w + gap && p.y >= r.y - gap && p.y <= r.y + r.h + gap;
export const rectsOverlap = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export function layoutCycle(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const n = nodes.length;
  const byId = new Map(nodes.map((s) => [s.id, s]));
  const { order, fromEdges, closed } = cycleOrder(nodes, edges);
  const es = validEdges(nodes, edges);
  const cx = box.w / 2;
  const cy = box.h / 2;

  let nodeW = Math.min(n <= 4 ? 132 : n <= 6 ? 116 : 100, Math.floor(box.w * 0.4));
  const minW = 64; // last resort: overlapping beats nothing, but only after the ellipse has stretched
  const maxH = n >= 5 ? 56 : 72;
  let ms: Measured[] = [];
  let rx = 0;
  let ry = 0;
  let rects: Rect[] = [];
  const angles = order.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / n);
  for (let attempt = 0; attempt < 12; attempt++) {
    ms = order.map((id) => measureNode(byId.get(id)!, nodeW, { maxSubLines: 1, em }));
    const hs = ms.map((m) => Math.min(m.prefH, maxH));
    const tallest = Math.max(...hs);
    rx = Math.max(10, cx - nodeW / 2 - 2);
    ry = Math.max(10, cy - tallest / 2 - 2);
    // small rings stay round-ish; crowded rings may stretch to use the tall phone box
    const maxAspect = n <= 4 ? 1.3 : n <= 6 ? 1.5 : 1.8;
    if (ry > rx * maxAspect) ry = rx * maxAspect;
    if (rx > ry * maxAspect) rx = ry * maxAspect;
    rects = angles.map((t, i) => ({
      x: Math.round(cx + rx * Math.cos(t) - nodeW / 2),
      y: Math.round(cy + ry * Math.sin(t) - hs[i] / 2),
      w: nodeW,
      h: hs[i],
    }));
    let collide = false;
    for (let i = 0; i < n && !collide; i++) if (rectsOverlap(rects[i], rects[(i + 1) % n], 6)) collide = true;
    if (!collide || nodeW <= minW) break;
    nodeW = Math.max(minW, nodeW - 8);
  }

  const outNodes = order.map((id, i) => placeNode(byId.get(id)!, ms[i], rects[i], i));
  const pos = new Map(order.map((id, i) => [id, i]));
  const rect = new Map(outNodes.map((nd) => [nd.id, rectOf(nd)]));
  const ptAt = (t: number): Pt => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  const tangentDeg = (t: number, ccw: boolean) => {
    const dx = -rx * Math.sin(t);
    const dy = ry * Math.cos(t);
    return deg(Math.atan2(ccw ? -dy : dy, ccw ? -dx : dx));
  };
  const step = (Math.PI / 180) * 0.5;

  /** arc along the ellipse from ring slot i to slot j (adjacent), clockwise unless ccw */
  const arc = (i: number, j: number, ccw: boolean): PathGeom | null => {
    const A = rects[i];
    const B = rects[j];
    const t1 = angles[i];
    let t2 = angles[j];
    if (!ccw) while (t2 <= t1) t2 += 2 * Math.PI;
    else while (t2 >= t1) t2 -= 2 * Math.PI;
    const dir = ccw ? -1 : 1;
    let a = t1;
    let b = t2;
    let guard = 0;
    while (inRect(ptAt(a), A, 3) && guard++ < 720 && dir * (b - a) > 0) a += dir * step;
    guard = 0;
    while (inRect(ptAt(b), B, 3) && guard++ < 720 && dir * (b - a) > 0) b -= dir * step;
    if (dir * (b - a) <= step * 2) return null;
    const p1 = ptAt(a);
    const p2 = ptAt(b);
    const pm = ptAt((a + b) / 2);
    const large = Math.abs(b - a) > Math.PI ? 1 : 0;
    return {
      d: `M${f(p1.x)} ${f(p1.y)}A${f(rx)} ${f(ry)} 0 ${large} ${ccw ? 0 : 1} ${f(p2.x)} ${f(p2.y)}`,
      mid: pm,
      end: p2,
      angle: tangentDeg(b, ccw),
    };
  };
  const chord = (A: Rect, B: Rect): PathGeom => {
    const a = rectAnchor(A, center(B), 2);
    const b = rectAnchor(B, center(A), 2);
    const c: Pt = { x: cx, y: cy };
    return cubicPath(
      a,
      { x: a.x + (c.x - a.x) * 0.35, y: a.y + (c.y - a.y) * 0.35 },
      { x: b.x + (c.x - b.x) * 0.35, y: b.y + (c.y - b.y) * 0.35 },
      b,
    );
  };

  const outEdges: LayoutEdge[] = [];
  const pushArc = (key: string, spec: Pick<DiagramEdgeSpec, "from" | "to" | "label">, i: number, j: number, ccw: boolean, implicit: boolean) => {
    const g = arc(i, j, ccw) ?? linePath(rectAnchor(rects[i], center(rects[j]), 2), rectAnchor(rects[j], center(rects[i]), 2));
    outEdges.push(mkEdge(key, spec, g, { implicit }));
  };
  if (!es.length) {
    order.forEach((id, i) => {
      const j = (i + 1) % n;
      pushArc(`ring-${i}`, { from: id, to: order[j] }, i, j, false, true);
    });
  } else {
    es.forEach((e, k) => {
      const i = pos.get(e.from)!;
      const j = pos.get(e.to)!;
      const key = `${e.from}->${e.to}#${k}`;
      if ((i + 1) % n === j) pushArc(key, e, i, j, false, false);
      else if ((j + 1) % n === i) pushArc(key, e, i, j, true, false);
      else outEdges.push(mkEdge(key, e, chord(rect.get(e.from)!, rect.get(e.to)!)));
    });
    if (fromEdges && !closed && n > 2) pushArc("ring-close", { from: order[n - 1], to: order[0] }, n - 1, 0, false, true);
  }
  return { variant: "cycle", box, nodes: outNodes, edges: outEdges, decor: [] };
}

/* ------------------------------ layers ------------------------------ */

export function layoutLayers(nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em: TextMetrics = DEFAULT_METRICS): DiagramLayout {
  const n = nodes.length;
  const es = validEdges(nodes, edges);
  const gutter = es.length ? 44 : 0;
  const bandW = box.w - gutter;
  const gap = 8;
  const ms = nodes.map((s) => measureNode(s, bandW, { row: true, maxSubLines: 1, em }));
  const maxPref = Math.max(...ms.map((m) => m.prefH));
  const avail = Math.floor((box.h - (n - 1) * gap) / n);
  let bandH = Math.max(Math.min(64, avail), maxPref);
  if (bandH > avail) bandH = Math.max(24, avail);
  bandH = Math.floor(bandH / 2) * 2;
  const total = n * bandH + (n - 1) * gap;
  const y0 = Math.round((box.h - total) / 2);
  const outNodes = nodes.map((s, i) => placeNode(s, ms[i], { x: 0, y: y0 + (n - 1 - i) * (bandH + gap), w: bandW, h: bandH }, i));
  const rect = new Map(outNodes.map((nd) => [nd.id, rectOf(nd)]));
  const outEdges = es.map((e, i) => {
    const A = rect.get(e.from)!;
    const B = rect.get(e.to)!;
    const a: Pt = { x: A.x + A.w + 2, y: A.y + A.h / 2 };
    const b: Pt = { x: B.x + B.w + 2, y: B.y + B.h / 2 };
    const g = bulgePath(a, b, "right", Math.max(12, gutter - 16));
    return mkEdge(`${e.from}->${e.to}#${i}`, e, g, { rotate: -90 });
  });
  return { variant: "layers", box, nodes: outNodes, edges: outEdges, decor: [] };
}

/* ------------------------------ dispatcher ------------------------------ */

export const LAYOUTS: Record<
  DiagramVariant,
  (nodes: readonly DiagramNodeSpec[], edges: readonly DiagramEdgeSpec[], box: Box, em?: TextMetrics) => DiagramLayout
> = {
  flow: layoutFlow,
  boxes: layoutBoxes,
  timeline: layoutTimeline,
  compare: layoutCompare,
  cycle: layoutCycle,
  layers: layoutLayers,
};

/** Rendered height of an edge-label chip (12px line-height + 3px padding each side). */
const EDGE_LABEL_H = 18;

/**
 * Edge labels are centered on `labelAt` by the renderer, so a wide label anchored near a wall
 * hangs outside the diagram (worst case: a routed skip-edge with a 20-char label). Pull each
 * label's center in far enough that the whole chip lands inside the box.
 */
function clampEdgeLabels(layout: DiagramLayout, box: Box): DiagramLayout {
  return {
    ...layout,
    edges: layout.edges.map((e) => {
      if (!e.label) return e;
      const rotated = Math.abs(((e.labelRotate ?? 0) % 180) - 90) < 45;
      const halfW = (rotated ? EDGE_LABEL_H : edgeLabelWidth(e.label)) / 2;
      const halfH = (rotated ? edgeLabelWidth(e.label) : EDGE_LABEL_H) / 2;
      const x = Math.min(Math.max(e.labelAt.x, halfW), Math.max(halfW, box.w - halfW));
      const y = Math.min(Math.max(e.labelAt.y, halfH), Math.max(halfH, box.h - halfH));
      return x === e.labelAt.x && y === e.labelAt.y ? e : { ...e, labelAt: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } };
    }),
  };
}

export function layoutDiagram(
  card: Pick<DiagramCard, "variant" | "nodes" | "edges">,
  box: Box,
  em: TextMetrics = DEFAULT_METRICS,
): DiagramLayout {
  const safe: Box = { w: Math.max(40, Math.floor(box.w)), h: Math.max(40, Math.floor(box.h)) };
  return clampEdgeLabels(LAYOUTS[card.variant](card.nodes, card.edges, safe, em), safe);
}
