import type { OutlineNode } from "@/lib/schemas/plan";

/**
 * Corpus slicing: pick the part of the source text most relevant to an outline
 * node so the writer is grounded without seeing the whole paste. Pure.
 *
 * Paragraphs are scored by keyword overlap with the node's title/brief/
 * corpusHint (title words weigh double); the best-scoring paragraph seeds a
 * contiguous window that grows toward its higher-scoring neighbour until the
 * budget is spent. Leftover budget goes to the next best paragraphs elsewhere,
 * joined with an ellipsis marker. Short sources are returned whole.
 */

const STOP = new Set(
  "the a an and or but of to in on for with by from at as is are was were be been being it its this that these those into over under about than then so if not no yes we you they he she i me my our your their what which who whom how why when where does do did done can could should would will just also very more most less least much many few any all some each other another such only own same too via per vs".split(" "),
);

export function keywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[`"'“”‘’]/g, " ")
        .split(/[^a-z0-9+#._-]+/)
        .map((w) => w.replace(/^[._-]+|[._-]+$/g, ""))
        .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
    ),
  );
}

export function splitParagraphs(text: string, targetChars = 600): string[] {
  const raw = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of raw) {
    if (p.length <= targetChars * 2) {
      out.push(p);
      continue;
    }
    // very long paragraph (or a wall of text with no blank lines): chunk by sentences
    const sentences = p.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n/);
    let cur = "";
    for (const s of sentences) {
      if (cur && cur.length + s.length + 1 > targetChars) {
        out.push(cur.trim());
        cur = "";
      }
      cur += (cur ? " " : "") + s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

function scoreParagraph(p: string, kws: { word: string; weight: number }[]): number {
  const lower = p.toLowerCase();
  let score = 0;
  for (const { word, weight } of kws) {
    let count = 0;
    let i = lower.indexOf(word);
    while (i !== -1 && count < 8) {
      count++;
      i = lower.indexOf(word, i + word.length);
    }
    if (count > 0) score += weight * (1 + Math.log(1 + count));
  }
  // mild length normalisation so a giant paragraph doesn't win by mass alone
  return score / Math.sqrt(Math.max(1, p.length / 400));
}

export type SliceHint = { nodeIdx?: number; nodeCount?: number };

export function sliceFor(sourceText: string, node: OutlineNode | null, maxChars = 6000, hint: SliceHint = {}): string {
  const text = sourceText.trim();
  if (text.length <= maxChars) return text;

  const paras = splitParagraphs(text);
  if (paras.length === 0) return text.slice(0, maxChars);

  const kws = node
    ? [
        ...keywords(node.title).map((word) => ({ word, weight: 2 })),
        ...keywords(`${node.brief ?? ""} ${node.corpusHint ?? ""}`).map((word) => ({ word, weight: 1 })),
      ]
    : [];
  const scores = paras.map((p) => (kws.length ? scoreParagraph(p, kws) : 0));
  const total = scores.reduce((a, b) => a + b, 0);

  // No signal → position-based: the node's proportional place in the source.
  let seed = 0;
  if (total > 0) {
    seed = scores.indexOf(Math.max(...scores));
  } else if (hint.nodeCount && hint.nodeCount > 0 && hint.nodeIdx !== undefined) {
    seed = Math.min(paras.length - 1, Math.floor((hint.nodeIdx / hint.nodeCount) * paras.length));
  }

  // grow a contiguous window around the seed
  const picked = new Set<number>([seed]);
  let used = paras[seed].length;
  let lo = seed;
  let hi = seed;
  while (used < maxChars && (lo > 0 || hi < paras.length - 1)) {
    const leftScore = lo > 0 ? scores[lo - 1] : -1;
    const rightScore = hi < paras.length - 1 ? scores[hi + 1] : -1;
    const takeLeft = lo > 0 && (hi >= paras.length - 1 || leftScore > rightScore);
    const next = takeLeft ? lo - 1 : hi + 1;
    if (used + paras[next].length + 2 > maxChars) break;
    picked.add(next);
    used += paras[next].length + 2;
    if (takeLeft) lo = next;
    else hi = next;
  }

  // spend leftover budget on the best paragraphs elsewhere (max 3 extra islands)
  if (total > 0) {
    const ranked = scores.map((s, i) => ({ s, i })).filter(({ s, i }) => s > 0 && !picked.has(i)).sort((a, b) => b.s - a.s);
    let islands = 0;
    for (const { i } of ranked) {
      if (islands >= 3) break;
      if (used + paras[i].length + 8 > maxChars) continue;
      picked.add(i);
      used += paras[i].length + 8;
      islands++;
    }
  }

  const order = Array.from(picked).sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -2;
  for (const i of order) {
    if (prev >= 0 && i !== prev + 1) parts.push("[…]");
    parts.push(paras[i]);
    prev = i;
  }
  const joined = parts.join("\n\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}
