import type { OutlineNode } from "@/lib/schemas/plan";

/**
 * Corpus slicing: pick the part of the source text most relevant to an outline
 * node so the writer is grounded without seeing the whole paste. Pure.
 *
 * The writer's complaint this solves: the old window scored paragraphs by raw
 * keyword hits, so a paragraph that says "cache" six times beat the paragraph
 * the node is actually about, and the slice arrived as three disconnected
 * islands. Now:
 *
 *  1. query terms come from title (×3), corpusHint (×2) and brief (×1), summed
 *     when a word appears in more than one — so the passage matching ALL THREE
 *     wins over the one that repeats a single word;
 *  2. a paragraph's score is scaled by how much of the query it covers, not just
 *     how loudly it repeats one term;
 *  3. a heading-like line passes most of its score to the paragraphs under it —
 *     `corpusHint` names headings, and the answer is in the prose below them;
 *  4. the seed is chosen by a NEIGHBOURHOOD score, so the window lands on a
 *     dense passage rather than an isolated spike, and stays contiguous — extra
 *     islands are only taken when they are strong AND budget is left over;
 *  5. the first node always gets the document's opening paragraph for
 *     orientation (who wrote this, what it is), whatever the keywords say.
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

/**
 * Match stem: "stampedes" in a node title must find "stampede" in the source.
 * Always a PREFIX of both forms so a plain substring scan finds either.
 */
export function stem(word: string): string {
  if (word.length >= 6 && word.endsWith("ies")) return word.slice(0, -3);        // batteries/battery → batter
  if (word.length >= 5 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export type Term = { word: string; weight: number };

/**
 * What the node is about, as weighted stems. A word carried by the title AND the
 * brief AND the hint scores all three — that is the passage we actually want.
 */
export function queryTerms(node: OutlineNode | null): Term[] {
  if (!node) return [];
  const weights = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    if (!text) return;
    for (const w of keywords(text)) {
      const s = stem(w);
      weights.set(s, (weights.get(s) ?? 0) + weight);
    }
  };
  add(node.title, 3);
  add(node.corpusHint, 2);
  add(node.brief, 1);
  return Array.from(weights, ([word, weight]) => ({ word, weight }));
}

/** Inflections a stem is allowed to grow: "cache" finds "cached", "batter" finds "batteries". */
const INFLECTION = /^(s|es|d|ed|ing|ings|y|ies|er|ers)?$/;

/**
 * Occurrences of `needle` that start on a word boundary and end on one (an
 * inflection aside). "cat" never matches "concatenate", "land" never matches
 * "landlord" — over-matching is how a slice ends up on the wrong page.
 */
export function countMatches(haystack: string, needle: string, cap = 8): number {
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1 && count < cap) {
    const before = i === 0 ? "" : haystack[i - 1];
    if (!before || !/[a-z0-9]/.test(before)) {
      const rest = haystack.slice(i + needle.length);
      const tail = /^[a-z0-9]*/.exec(rest)?.[0] ?? "";
      if (INFLECTION.test(tail)) count++;
    }
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/**
 * Relevance of one paragraph. Repetition still counts (log-damped), but the
 * dominant factor is COVERAGE: how much of the node's query this paragraph
 * actually speaks to. Length-normalised so a wall of text can't win by mass.
 */
export function scoreParagraph(p: string, terms: Term[], totalWeight: number): number {
  if (!terms.length || totalWeight <= 0) return 0;
  const lower = p.toLowerCase();
  let base = 0;
  let matched = 0;
  for (const { word, weight } of terms) {
    const count = countMatches(lower, word);
    if (count > 0) {
      base += weight * (1 + Math.log(1 + count));
      matched += weight;
    }
  }
  if (base === 0) return 0;
  const coverage = matched / totalWeight;
  return (base * (0.6 + 0.8 * coverage)) / Math.sqrt(Math.max(1, p.length / 400));
}

/** A short standalone line that titles what follows (markdown heading, or a title-ish line). */
export function isHeadingLike(p: string): boolean {
  const t = p.trim();
  if (!t || t.length > 80 || t.includes("\n")) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/[.!?,;:]$/.test(t)) return false;
  return t.split(/\s+/).length <= 12;
}

export type SliceHint = {
  nodeIdx?: number;
  nodeCount?: number;
  /** Force the document's opening in as orientation (implied by nodeIdx === 0). */
  opening?: boolean;
};

export function sliceFor(sourceText: string, node: OutlineNode | null, maxChars = 6000, hint: SliceHint = {}): string {
  const text = sourceText.trim();
  if (text.length <= maxChars) return text;

  const paras = splitParagraphs(text);
  if (paras.length === 0) return text.slice(0, maxChars);
  const last = paras.length - 1;

  const terms = queryTerms(node);
  const totalWeight = terms.reduce((a, t) => a + t.weight, 0);
  const raw = paras.map((p) => scoreParagraph(p, terms, totalWeight));

  // A heading carries the keywords; the passage the node needs is the prose under it.
  const eff = raw.slice();
  for (let i = 0; i < paras.length; i++) {
    if (raw[i] <= 0 || !isHeadingLike(paras[i])) continue;
    if (i + 1 <= last) eff[i + 1] += raw[i] * 0.7;
    if (i + 2 <= last) eff[i + 2] += raw[i] * 0.35;
  }
  const total = eff.reduce((a, b) => a + b, 0);

  const picked = new Set<number>();
  let used = 0;
  const cost = (i: number) => paras[i].length + 2;
  const take = (i: number, budget: number, extra = 0): boolean => {
    if (picked.has(i)) return true;
    if (used + cost(i) + extra > budget) return false;
    picked.add(i);
    used += cost(i) + extra;
    return true;
  };

  // 1. orientation: the first node always opens with the document's opening.
  if (hint.opening || hint.nodeIdx === 0) {
    const openingBudget = Math.min(Math.floor(maxChars * 0.35), 900);
    for (let i = 0; i <= Math.min(2, last); i++) {
      if (!take(i, openingBudget)) break;
      if (!isHeadingLike(paras[i])) break; // a heading only counts as orientation with its body
    }
  }

  // 2. seed the window on the best NEIGHBOURHOOD, not the loudest single paragraph.
  let seed = 0;
  if (total > 0) {
    let best = -1;
    for (let i = 0; i <= last; i++) {
      const around = eff[i] + 0.5 * (i > 0 ? eff[i - 1] : 0) + 0.5 * (i < last ? eff[i + 1] : 0);
      if (around > best) {
        best = around;
        seed = i;
      }
    }
  } else if (hint.nodeCount && hint.nodeCount > 0 && hint.nodeIdx !== undefined) {
    seed = Math.min(last, Math.floor((hint.nodeIdx / hint.nodeCount) * paras.length));
  }
  take(seed, maxChars);
  if (!picked.size) {
    // budget smaller than a single paragraph: take the seed anyway, truncated at the end.
    picked.add(seed);
    used += cost(seed);
  }

  // 3. grow ONE contiguous window around the seed, always toward the better neighbour.
  //    Off-topic neighbours are connective tissue, not filler: a couple of them keep a
  //    passage readable, a dozen just spend the writer's context on the wrong page.
  //    With no keyword signal at all there is nothing to be off-topic about, so grow freely.
  //    A passage continues FORWARD, so cold paragraphs are only worth following that way.
  const coldBudget = total > 0 ? { left: 0, right: 2 } : { left: Infinity, right: Infinity };
  let leftDone = false;
  let rightDone = false;
  let lo = seed;
  let hi = seed;
  while (used < maxChars && !(leftDone && rightDone)) {
    const canLeft = !leftDone && lo > 0;
    const canRight = !rightDone && hi < last;
    if (!canLeft && !canRight) break;
    const leftScore = canLeft ? eff[lo - 1] : -1;
    const rightScore = canRight ? eff[hi + 1] : -1;
    const takeLeft = canLeft && (!canRight || leftScore > rightScore);
    const next = takeLeft ? lo - 1 : hi + 1;
    if (picked.has(next)) {
      // already in (the orientation block) — absorb it without spending budget again
      if (takeLeft) lo = next;
      else hi = next;
      continue;
    }
    if (eff[next] <= 0) {
      const room = takeLeft ? coldBudget.left : coldBudget.right;
      if (room <= 0) {
        if (takeLeft) leftDone = true;
        else rightDone = true;
        continue;
      }
      if (takeLeft) coldBudget.left--;
      else coldBudget.right--;
    }
    if (!take(next, maxChars)) break;
    if (takeLeft) lo = next;
    else hi = next;
  }

  // 4. the heading directly above the window is cheap orientation — take it if it fits.
  if (lo > 0 && isHeadingLike(paras[lo - 1])) take(lo - 1, maxChars);

  // 5. only then spend what's left on strong passages elsewhere (contiguity first).
  const room = maxChars - used;
  if (total > 0 && room > maxChars * 0.15) {
    const floor = eff[seed] * 0.35;
    const ranked = eff
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s >= floor && s > 0 && !picked.has(i))
      .sort((a, b) => b.s - a.s);
    let islands = 0;
    for (const { i } of ranked) {
      if (islands >= 2) break;
      if (!take(i, maxChars, 6)) continue;
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
