import { describe, expect, it } from "vitest";
import { CardSchema, DIAGRAM_VARIANTS, type DiagramCard } from "@/lib/schemas/cards";
import { findBannedInValue } from "@/lib/copy/banned";
import {
  LAYOUTS,
  cycleOrder,
  flowLevels,
  flowOrientation,
  edgeLabelWidth,
  layoutCompare,
  layoutDiagram,
  rectsOverlap,
  validEdges,
  wrapText,
  fitLabelSize,
  type Box,
  type DiagramLayout,
} from "@/components/diagrams/layout";
import { SAMPLE_DIAGRAMS } from "@/components/diagrams/samples";

const BOXES: Box[] = [
  { w: 361, h: 460 },
  { w: 345, h: 520 },
  { w: 300, h: 300 },
];

const nodes = (...labels: string[]) => labels.map((l) => ({ id: l, label: l }));
const edge = (from: string, to: string, label?: string) => ({ from, to, ...(label ? { label } : {}) });

const NUM_RE = /-?\d+(\.\d+)?/g;
function pathNumbers(d: string): number[] {
  return (d.match(NUM_RE) ?? []).map(Number);
}

function assertInsideBox(l: DiagramLayout, box: Box, slack = 0.5) {
  for (const n of l.nodes) {
    expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && Number.isFinite(n.h)).toBe(true);
    expect(n.w).toBeGreaterThan(0);
    expect(n.h).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThanOrEqual(-slack);
    expect(n.y).toBeGreaterThanOrEqual(-slack);
    expect(n.x + n.w).toBeLessThanOrEqual(box.w + slack);
    expect(n.y + n.h).toBeLessThanOrEqual(box.h + slack);
  }
  for (const e of l.edges) {
    expect(e.d).not.toMatch(/NaN|Infinity/);
    expect(Number.isFinite(e.labelAt.x) && Number.isFinite(e.labelAt.y)).toBe(true);
    if (e.arrow) expect(Number.isFinite(e.arrow.x) && Number.isFinite(e.arrow.y) && Number.isFinite(e.arrow.angle)).toBe(true);
    // every coordinate in the path stays inside the box (small slack for arrow gaps / bulges)
    const nums = pathNumbers(e.d);
    // path numbers are x,y pairs except arc radii/flags — check bounds loosely on the max magnitude
    for (const v of nums) expect(Math.abs(v)).toBeLessThanOrEqual(Math.max(box.w, box.h) + 60);
    expect(e.labelAt.x).toBeGreaterThanOrEqual(-8);
    expect(e.labelAt.x).toBeLessThanOrEqual(box.w + 8);
    expect(e.labelAt.y).toBeGreaterThanOrEqual(-8);
    expect(e.labelAt.y).toBeLessThanOrEqual(box.h + 8);
  }
  for (const d of l.decor) {
    if (d.kind === "dot") {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(box.w);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(box.h);
    } else expect(d.d).not.toMatch(/NaN|Infinity/);
  }
}

function assertNoNodeOverlap(l: DiagramLayout) {
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i];
      const b = l.nodes[j];
      expect(rectsOverlap(a, b, 0), `${l.variant}: ${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe("SAMPLE_DIAGRAMS", () => {
  it("has one valid example per variant", () => {
    const variants = SAMPLE_DIAGRAMS.map((c) => c.variant);
    for (const v of DIAGRAM_VARIANTS) expect(variants).toContain(v);
    for (const c of SAMPLE_DIAGRAMS) {
      const r = CardSchema.safeParse(c);
      expect(r.success, `${c.variant}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });
  it("uses no school vocabulary", () => {
    for (const c of SAMPLE_DIAGRAMS) expect(findBannedInValue(c)).toBeNull();
  });
  it("tapNotes reference real nodes", () => {
    for (const c of SAMPLE_DIAGRAMS) {
      const ids = new Set(c.nodes.map((n) => n.id));
      for (const k of Object.keys(c.tapNotes ?? {})) expect(ids.has(k), `${c.variant}: ${k}`).toBe(true);
    }
  });
});

describe("layouts: containment + sanity", () => {
  for (const card of SAMPLE_DIAGRAMS) {
    for (const box of BOXES) {
      it(`${card.variant} fits ${box.w}x${box.h}`, () => {
        const l = layoutDiagram(card, box);
        expect(l.nodes).toHaveLength(card.nodes.length);
        expect(new Set(l.nodes.map((n) => n.id)).size).toBe(card.nodes.length);
        assertInsideBox(l, box);
        assertNoNodeOverlap(l);
        // stagger orders are a permutation 0..n-1
        expect([...l.nodes].map((n) => n.order).sort((a, b) => a - b)).toEqual(card.nodes.map((_, i) => i));
      });
    }
  }

  it("keeps every variant inside the box for 2..8 generic nodes with dense edges", () => {
    for (const variant of DIAGRAM_VARIANTS) {
      for (let n = 2; n <= 8; n++) {
        const ns = Array.from({ length: n }, (_, i) => ({
          id: `n${i}`,
          label: i % 3 === 0 ? "a fairly long label here" : `node ${i}`,
          sub: i % 2 === 0 ? "a supporting line that is long enough" : undefined,
          emphasis: i === 1,
        }));
        const es = [];
        for (let i = 0; i < n; i++) {
          es.push(edge(`n${i}`, `n${(i + 1) % n}`, i % 2 ? "label" : undefined));
          if (i + 2 < n) es.push(edge(`n${i}`, `n${i + 2}`));
        }
        for (const box of BOXES) {
          const l = LAYOUTS[variant](ns, es.slice(0, 12), box);
          assertInsideBox(l, box);
          expect(l.nodes).toHaveLength(n);
        }
      }
    }
  });

  it("drops edges referencing unknown ids (never throws)", () => {
    const ns = nodes("a", "b", "c");
    const es = [edge("a", "b"), edge("a", "ghost"), edge("nope", "c"), edge("b", "b"), edge("b", "c")];
    expect(validEdges(ns, es).map((e) => `${e.from}>${e.to}`)).toEqual(["a>b", "b>c"]);
    for (const variant of DIAGRAM_VARIANTS) {
      const l = LAYOUTS[variant](ns, es, { w: 361, h: 460 });
      const drawn = l.edges.filter((e) => !e.implicit);
      for (const e of drawn) {
        expect(["a", "b", "c"]).toContain(e.from);
        expect(["a", "b", "c"]).toContain(e.to);
      }
      assertInsideBox(l, { w: 361, h: 460 });
    }
  });

  it("survives degenerate boxes", () => {
    for (const card of SAMPLE_DIAGRAMS) {
      const l = layoutDiagram(card, { w: 0, h: 0 });
      for (const n of l.nodes) expect(Number.isFinite(n.x + n.y + n.w + n.h)).toBe(true);
    }
  });
});

describe("flow", () => {
  it("assigns topological levels", () => {
    const ns = nodes("a", "b", "c", "d");
    const es = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    expect(flowLevels(ns, es)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });
  it("puts branches on the same level and ignores unknown ids", () => {
    const ns = nodes("root", "x", "y", "leaf");
    const es = [edge("root", "x"), edge("root", "y"), edge("x", "leaf"), edge("y", "leaf"), edge("root", "zzz")];
    expect(flowLevels(ns, es)).toEqual([["root"], ["x", "y"], ["leaf"]]);
  });
  it("breaks cycles instead of looping forever", () => {
    const ns = nodes("a", "b", "c");
    const es = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const levels = flowLevels(ns, es);
    expect(levels.flat().sort()).toEqual(["a", "b", "c"]);
    expect(levels).toEqual([["a"], ["b"], ["c"]]);
    const l = LAYOUTS.flow(ns, es, { w: 361, h: 460 });
    expect(l.edges).toHaveLength(3);
    assertInsideBox(l, { w: 361, h: 460 });
  });
  it("places isolated nodes at level 0", () => {
    const ns = nodes("a", "b", "lonely");
    expect(flowLevels(ns, [edge("a", "b")])).toEqual([["a", "lonely"], ["b"]]);
  });
  it("goes horizontal for few levels and vertical for many", () => {
    const wide = { w: 361, h: 460 };
    expect(flowOrientation([["a"], ["b"], ["c"]], [], wide)).toBe("h");
    expect(flowOrientation([["a"], ["b"], ["c"], ["d"], ["e"]], [], wide)).toBe("v");
    expect(flowOrientation([["a"], ["b"]], [edge("a", "b", "a long edge label")], wide)).toBe("v");
    const l = LAYOUTS.flow(nodes("a", "b", "c"), [edge("a", "b"), edge("b", "c")], wide);
    const xs = l.nodes.map((n) => n.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });
  it("stacks vertically top→bottom in vertical mode", () => {
    const ns = nodes("a", "b", "c", "d", "e");
    const es = [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "e")];
    const l = LAYOUTS.flow(ns, es, { w: 361, h: 460 });
    const ys = l.nodes.map((n) => n.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    for (const e of l.edges) expect(e.arrow).not.toBeNull();
  });
});

describe("cycle", () => {
  it("uses node order when there are no edges and closes the ring implicitly", () => {
    const ns = nodes("a", "b", "c", "d");
    expect(cycleOrder(ns, []).order).toEqual(["a", "b", "c", "d"]);
    const l = LAYOUTS.cycle(ns, [], { w: 361, h: 460 });
    expect(l.edges).toHaveLength(4);
    expect(l.edges.every((e) => e.implicit)).toBe(true);
  });
  it("derives ring order from the edges", () => {
    const ns = nodes("a", "b", "c");
    const es = [edge("a", "c"), edge("c", "b"), edge("b", "a")];
    const r = cycleOrder(ns, es);
    expect(r.order).toEqual(["a", "c", "b"]);
    expect(r.fromEdges).toBe(true);
    expect(r.closed).toBe(true);
    const l = LAYOUTS.cycle(ns, es, { w: 361, h: 460 });
    expect(l.nodes.map((n) => n.id)).toEqual(["a", "c", "b"]);
    expect(l.nodes.map((n) => n.order)).toEqual([0, 1, 2]);
    // all three edges are ring arcs (elliptical), none implicit
    expect(l.edges.filter((e) => e.implicit)).toHaveLength(0);
    expect(l.edges.every((e) => e.d.includes("A"))).toBe(true);
  });
  it("closes an open chain with an implicit arc", () => {
    const ns = nodes("w", "x", "y", "z");
    const es = [edge("x", "y"), edge("y", "z"), edge("w", "x")];
    const r = cycleOrder(ns, es);
    expect(r.order).toEqual(["w", "x", "y", "z"]);
    expect(r.closed).toBe(false);
    const l = LAYOUTS.cycle(ns, es, { w: 361, h: 460 });
    expect(l.edges.filter((e) => e.implicit)).toHaveLength(1);
    expect(l.edges.find((e) => e.implicit)).toMatchObject({ from: "z", to: "w" });
  });
  it("falls back to node order when edges only cover part of the ring", () => {
    const ns = nodes("a", "b", "c", "d", "e");
    const es = [edge("a", "b"), edge("d", "b")];
    expect(cycleOrder(ns, es).order).toEqual(["a", "b", "c", "d", "e"]);
    const l = LAYOUTS.cycle(ns, es, { w: 361, h: 460 });
    expect(l.edges).toHaveLength(2);
    assertInsideBox(l, { w: 361, h: 460 });
  });
  it("places the first ring node at the top and never overlaps neighbours (8 nodes, 300x300)", () => {
    const ns = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `step ${i + 1}` }));
    const l = LAYOUTS.cycle(ns, [], { w: 300, h: 300 });
    const top = l.nodes[0];
    for (const n of l.nodes) expect(top.y).toBeLessThanOrEqual(n.y);
    assertNoNodeOverlap(l);
  });
});

describe("boxes / timeline / compare / layers", () => {
  it("boxes: 2 columns below 7 nodes, 3 at 7+", () => {
    const four = LAYOUTS.boxes(nodes("a", "b", "c", "d"), [], { w: 361, h: 460 });
    expect(new Set(four.nodes.map((n) => n.x)).size).toBe(2);
    const seven = LAYOUTS.boxes(nodes("a", "b", "c", "d", "e", "f", "g"), [], { w: 361, h: 460 });
    expect(new Set(seven.nodes.map((n) => n.x)).size).toBe(3);
    // 3 nodes: last row centered
    const three = LAYOUTS.boxes(nodes("a", "b", "c"), [], { w: 361, h: 460 });
    const c = three.nodes[2];
    expect(Math.abs(c.x + c.w / 2 - 361 / 2)).toBeLessThan(1);
  });
  it("timeline: node order is time order, alternating sides, spine + dots", () => {
    const ns = nodes("1991", "1996", "1997", "2015");
    const l = LAYOUTS.timeline(ns, [], { w: 361, h: 460 });
    const ys = l.nodes.map((n) => n.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(l.nodes.map((n) => n.side)).toEqual(["left", "right", "left", "right"]);
    expect(l.decor.filter((d) => d.kind === "dot")).toHaveLength(4);
    expect(l.decor.find((d) => d.key === "spine")).toBeTruthy();
    // long labels → single side
    const long = LAYOUTS.timeline([{ id: "a", label: "a very long milestone name" }, { id: "b", label: "another long one" }], [], { w: 361, h: 460 });
    expect(long.nodes.every((n) => n.side === "right")).toBe(true);
  });
  it("timeline: consecutive labelled edges ride the spine, skips become arcs", () => {
    const ns = nodes("a", "b", "c");
    const l = LAYOUTS.timeline(ns, [edge("a", "b", "later"), edge("a", "c", "skip"), edge("b", "c")], { w: 361, h: 460 });
    const spineLabel = l.edges.find((e) => e.from === "a" && e.to === "b")!;
    expect(spineLabel.d).toBe("");
    expect(spineLabel.label).toBe("later");
    const skip = l.edges.find((e) => e.to === "c" && e.from === "a")!;
    expect(skip.d).toMatch(/^M/);
    expect(l.edges.find((e) => e.from === "b" && e.to === "c")).toBeUndefined();
  });
  it("compare: first ceil(n/2) nodes left, rest right, aligned rows, divider decor", () => {
    const l = LAYOUTS.compare(nodes("a", "b", "c", "d", "e"), [edge("a", "d", "vs")], { w: 361, h: 460 });
    expect(l.nodes.filter((n) => n.side === "left").map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(l.nodes.filter((n) => n.side === "right").map((n) => n.id)).toEqual(["d", "e"]);
    const a = l.nodes.find((n) => n.id === "a")!;
    const d = l.nodes.find((n) => n.id === "d")!;
    expect(a.y).toBe(d.y);
    expect(a.x + a.w).toBeLessThan(d.x);
    expect(l.decor.find((x) => x.key === "divider")).toBeTruthy();
    expect(l.edges[0].labelAt.x).toBeCloseTo(361 / 2, 0);
  });
  it("layers: first node at the bottom, full width, side arrows when edges exist", () => {
    const ns = nodes("hardware", "kernel", "app");
    const plain = LAYOUTS.layers(ns, [], { w: 361, h: 460 });
    expect(plain.nodes[0].y).toBeGreaterThan(plain.nodes[2].y);
    expect(plain.nodes.every((n) => n.x === 0 && n.w === 361)).toBe(true);
    const withEdge = LAYOUTS.layers(ns, [edge("app", "hardware", "io")], { w: 361, h: 460 });
    expect(withEdge.nodes.every((n) => n.w < 361)).toBe(true);
    expect(withEdge.edges[0].labelRotate).toBe(-90);
    expect(withEdge.edges[0].arrow?.angle).toBeCloseTo(180, 0);
  });
});

describe("text heuristics", () => {
  it("wraps into at most two lines and never loses words", () => {
    const lines = wrapText("the quick brown fox jumps over", 80, 14.5, 0.6, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over");
    expect(wrapText("single", 200, 14.5, 0.6)).toEqual(["single"]);
  });
  it("steps the label size down for long unbreakable words", () => {
    expect(fitLabelSize("api", 100)).toBe(14.5);
    expect(fitLabelSize("authentication", 100)).toBeLessThan(14.5);
    expect(fitLabelSize("supercalifragilistic", 40)).toBe(11.5);
  });
});

describe("DiagramCard shape guard", () => {
  it("every sample stays within the schema limits the layout assumes", () => {
    for (const c of SAMPLE_DIAGRAMS as DiagramCard[]) {
      expect(c.nodes.length).toBeLessThanOrEqual(8);
      expect(c.edges.length).toBeLessThanOrEqual(12);
      for (const n of c.nodes) expect(n.label.length).toBeLessThanOrEqual(24);
    }
  });
});

/** effective rendered chip half-extents — mirrors clampEdgeLabels (wrapped chips are narrower + taller) */
function chipHalf(e: { label?: string; labelRotate?: number; labelMaxW?: number }) {
  const w = e.labelMaxW ? Math.min(edgeLabelWidth(e.label!), e.labelMaxW) : edgeLabelWidth(e.label!);
  const h = e.labelMaxW && edgeLabelWidth(e.label!) > e.labelMaxW ? 30 : 18;
  const rotated = Math.abs(((e.labelRotate ?? 0) % 180) - 90) < 45;
  return { halfW: (rotated ? h : w) / 2, halfH: (rotated ? w : h) / 2 };
}

describe("edge labels stay inside the box", () => {
  const BOXES: Box[] = [{ w: 361, h: 460 }, { w: 345, h: 520 }, { w: 300, h: 300 }];
  const LABEL = "x".repeat(20); // schema max

  for (const variant of DIAGRAM_VARIANTS) {
    it(`${variant}: worst-case labels never hang outside`, () => {
      const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `node ${i} label text`, sub: `sub label ${i}` }));
      const edges = [
        ...nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id, label: LABEL })),
        { from: "n7", to: "n0", label: LABEL }, // the routed skip edge that used to escape left
      ];
      for (const box of BOXES) {
        const layout = layoutDiagram({ variant, nodes, edges }, box);
        for (const e of layout.edges) {
          if (!e.label) continue;
          const { halfW, halfH } = chipHalf(e);
          expect(e.labelAt.x - halfW, `${variant} ${box.w}x${box.h} ${e.key} left`).toBeGreaterThanOrEqual(-0.5);
          expect(e.labelAt.x + halfW, `${variant} ${box.w}x${box.h} ${e.key} right`).toBeLessThanOrEqual(box.w + 0.5);
          expect(e.labelAt.y - halfH, `${variant} ${box.w}x${box.h} ${e.key} top`).toBeGreaterThanOrEqual(-0.5);
          expect(e.labelAt.y + halfH, `${variant} ${box.w}x${box.h} ${e.key} bottom`).toBeLessThanOrEqual(box.h + 0.5);
        }
      }
    });
  }
});

describe("compare: cross-connector labels ride the gutter, not the nodes", () => {
  it("widens the gutter so a schema-max label never lands on a column", () => {
    const nodes = [
      { id: "a", label: "splash zone", sub: "rare wet events" },
      { id: "b", label: "low intertidal", sub: "flooded twice daily" },
    ];
    for (const box of [{ w: 361, h: 460 }, { w: 345, h: 520 }] as Box[]) {
      for (const label of ["predictable rescue", "x".repeat(20)]) {
        const layout = layoutCompare(nodes, [{ from: "a", to: "b", label }], box);
        const [e] = layout.edges;
        const { halfW, halfH } = chipHalf(e);
        const l = e.labelAt.x - halfW;
        const r = e.labelAt.x + halfW;
        for (const n of layout.nodes) {
          const overlapsX = r > n.x && l < n.x + n.w;
          const overlapsY = e.labelAt.y + halfH > n.y && e.labelAt.y - halfH < n.y + n.h;
          expect(overlapsX && overlapsY, `${box.w}px "${label}" overlaps ${n.id}`).toBe(false);
        }
      }
    }
  });
});
