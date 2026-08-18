import { generateNKeysBetween } from "fractional-indexing";
import type { Card } from "@/lib/schemas/cards";
import type { CardRow } from "@/lib/schemas/session";
import { DEV_SESSION_ID } from "./dev";

/**
 * Schema-MAX fixtures for the fit check (/dev/cards/worst + e2e/fit.spec.ts): every string at its
 * schema cap, every list at its max length. Each of these must fit one 393×852 viewport WITH the
 * standalone safe areas (top 59 / bottom 34) and stay clear of the back chevron — Prime Directive #2:
 * every card is complete on its own screen. Copy is deliberately dull; it's a ruler, not content.
 */
const N = "n1";
const id = (n: number) => `4d4a5b6c-0000-4000-8000-${String(n).padStart(12, "0")}`;
const words = (n: number, seed = "the cache keeps the answer warm so the slow thing rests and the site stays fast") => {
  let out = "";
  const w = seed.split(" ");
  let i = 0;
  while (out.length < n) {
    out += (out ? " " : "") + w[i % w.length];
    i++;
  }
  return out.slice(0, n).replace(/\s+$/, "");
};
const exact = (n: number, seed?: string) => {
  let s = words(n, seed);
  while (s.length < n) s += "x";
  return s.slice(0, n);
};

const CODE = [
  "async function getUserProfileWithCache(id, opts) {",
  "  const key = `user:${id}:${opts.locale}:${opts.currency}`;",
  "  const hit = await redis.get(key);",
  "  if (hit) return JSON.parse(hit);",
  "  const row = await db.users.findUnique({ where: { id } });",
  "  if (!row) throw new NotFoundError(`no user ${id}`);",
  "  const profile = await enrichProfile(row, opts);",
  "  await redis.set(key, JSON.stringify(profile), { EX: 60 });",
  "  metrics.increment('cache.miss', { route: 'profile' });",
  "  return profile;",
  "}",
  "",
  "async function invalidateUser(id) {",
  "  const keys = await redis.keys(`user:${id}:*`);",
  "  if (keys.length) await redis.del(...keys);",
  "  metrics.increment('cache.invalidate', { count: keys.length });",
  "}",
  "",
  "export const handler = withTracing(async (req, res) => {",
  "  const profile = await getUserProfileWithCache(req.params.id, req.query);",
  "  res.setHeader('cache-control', 'private, max-age=60');",
  "  res.json(profile);",
  "});",
].join("\n");

/** Glossary ruler: 3 terms at the 32-char cap, each with a 140-char gloss, embedded in the copy below. */
const GT = [
  exact(32, "write behind buffer flush window"),
  exact(32, "thundering herd of cold readers"),
  exact(32, "negative caching sentinel value"),
];
const GLOSS = GT.map((term) => ({ term, gloss: exact(140, `${term} is the thing this card had to name and did not want to spend its whole word budget defining right here`) }));

export const WORST_CARDS: Card[] = [
  {
    id: id(1), type: "hook", topicNodeId: N, detourId: null, eyebrow: exact(28, "the footgun nobody mentions"),
    headline: exact(90, "one process is holding your whole site up and it never once touches the database"),
    sub: exact(120),
    visual: { kind: "ascii", lines: Array.from({ length: 8 }, (_, i) => exact(32, `row ${i} of the ascii block goes here ok`)) },
  },
  {
    id: id(2), type: "concept", topicNodeId: N, detourId: null, eyebrow: exact(28),
    headline: exact(64, "a cache is a bet on repetition and repetition is the norm"),
    body: exact(320),
    visual: { kind: "stat", value: exact(12, "1,234,567ms"), label: exact(40) },
  },
  {
    id: id(3), type: "binary", topicNodeId: N, detourId: null, eyebrow: exact(28),
    prompt: exact(140, "kill redis and the whole site goes down instantly no matter what else you did"),
    options: [exact(40, "real and it takes everything with it"), exact(40, "nah the database still answers slower")],
    correctIndex: 1,
    revealCopy: exact(240),
    difficulty: 3,
  },
  {
    id: id(4), type: "predict", topicNodeId: N, detourId: null, eyebrow: exact(28),
    prompt: exact(140, "the cache restarts empty at peak traffic what happens to the database in the next second"),
    options: [exact(40), exact(40, "a stampede of identical queries lands"), exact(40, "nothing it was never the bottleneck"), exact(40, "requests time out at the edge first")],
    correctIndex: 1,
    revealHeadline: exact(64, "every miss becomes a query and they all arrive at once"),
    revealBody: exact(240),
    difficulty: 3,
  },
  {
    id: id(5), type: "sequence", topicNodeId: N, detourId: null, eyebrow: exact(28),
    prompt: exact(120, "put the cache aside read path in the order it actually happens on a miss"),
    items: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: exact(40, `step ${i} the request checks the cache first`) })),
    revealCopy: exact(240),
    difficulty: 3,
  },
  {
    id: id(6), type: "slider", topicNodeId: N, detourId: null, eyebrow: exact(28),
    prompt: exact(120, "drag the hit rate and watch what the database has to absorb per second"),
    label: exact(40, "cache hit rate across all requests"),
    min: 0, max: 100, step: 1, defaultValue: 80, unit: "%",
    expression: "10000 * (1 - x / 100)",
    outputLabel: exact(40, "queries the database absorbs each second"),
    outputUnit: exact(12, "queries/sec"),
    outputFormat: "int",
    insight: exact(200),
  },
  {
    id: id(7), type: "reveal", topicNodeId: N, detourId: null, eyebrow: exact(28),
    setup: exact(140, "the site survived a database outage for nine minutes and nobody noticed"),
    payoff: exact(240),
    visual: { kind: "icon", icon: "shield" },
  },
  {
    id: id(8), type: "checkpoint", topicNodeId: N, detourId: null, eyebrow: exact(28),
    headline: exact(80, "you now know more about cache stampedes than most backend engineers"),
    sub: exact(160),
    stat: { value: exact(12, "1,234,567ms"), label: exact(40) },
    visual: { kind: "spark", values: Array.from({ length: 24 }, (_, i) => (i * 7) % 11), label: exact(40) },
  },
  {
    id: id(9), type: "code", topicNodeId: N, detourId: null, eyebrow: exact(28),
    title: exact(48, "cache aside with invalidation in one file"),
    lang: "ts",
    code: CODE.slice(0, 1200),
    annotations: [1, 2, 3, 5, 8, 14, 15, 20].map((line) => ({ line, note: exact(160) })),
  },
  {
    id: id(10), type: "diagram", topicNodeId: N, detourId: null, eyebrow: exact(28),
    variant: "flow",
    title: exact(48, "where a request goes when the cache is cold"),
    nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: exact(24, `node ${i} label text here`), sub: exact(40, `sub label ${i} for the node`), emphasis: i === 3 })),
    edges: Array.from({ length: 12 }, (_, i) => ({ from: `n${i % 8}`, to: `n${(i + 1) % 8}`, label: exact(20, `edge ${i} label ok`) })),
    tapNotes: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`n${i}`, exact(160)])),
  },
  {
    id: id(11), type: "recap", topicNodeId: N, detourId: null, eyebrow: exact(28),
    headline: exact(64, "the whole thing again with a brand new metaphor this time"),
    beats: [exact(120), exact(120, "the second beat says the same thing from the other side of the wire"), exact(120, "the third beat lands the point and leaves you with one image")],
    metaphor: exact(80, "a coat check that hands back the coat before you finish asking"),
  },
  {
    id: id(12), type: "clarify", topicNodeId: "clarify", detourId: null, eyebrow: exact(28),
    key: "audience",
    prompt: exact(140, "quick one before we go who is this for so the depth lands right the first time"),
    options: [exact(40, "someone who has shipped a cache before"), exact(40, "someone who has only heard the word"), exact(40, "someone interviewing next week")],
  },
  {
    id: id(13), type: "detour_marker", topicNodeId: N, detourId: null, eyebrow: exact(28),
    kind: "open",
    question: exact(140, "wait why does a restart wipe the cache but not the database if both are just processes"),
    label: exact(60, "detour: your question about restarts and memory"),
  },
  {
    id: id(14), type: "notice", topicNodeId: "system", detourId: null, eyebrow: exact(28),
    kind: "budget",
    headline: exact(80, "we hit today's budget. resets at midnight. go touch grass, legend."),
    body: exact(200),
  },
  {
    id: id(15), type: "fallback", topicNodeId: "system", detourId: null, eyebrow: exact(28),
    reason: "fixture",
    retryable: true,
  },
  {
    id: id(16), type: "stat", topicNodeId: N, detourId: null, eyebrow: exact(28),
    value: exact(12, "1,234,567ms"),
    unit: exact(12, "queries/sec"),
    label: exact(48, "what the database absorbs every single second"),
    context: `${GT[0]} ${GT[1]} ${GT[2]} ${exact(58, "is what the number actually means once you sit with it")}`,
    compare: { value: exact(12, "9,876,543ms"), label: exact(40, "the same read straight off the disk") },
    terms: GLOSS,
  },
  {
    id: id(17), type: "open", topicNodeId: N, detourId: null, eyebrow: exact(28),
    prompt: `${GT[0]} ${exact(126, "explain what just happened to someone who has never once thought about where an answer comes from")}`,
    placeholder: exact(48, "say it however it comes out no need to be neat"),
    rubric: exact(240),
    modelAnswer: `${GT[1]} ${GT[2]} ${exact(214, "is roughly how you would say it back if you had to say it out loud to someone who missed the whole thing")}`,
    difficulty: 3,
    terms: GLOSS,
  },
  {
    id: id(18), type: "crossroads", topicNodeId: N, detourId: null, eyebrow: exact(28),
    finished: exact(60, "how a cache answers before the database wakes up"),
    upNext: exact(60, "what happens when the cached answer is quietly wrong"),
    headline: exact(80, "that is the whole read path start to finish so where do you want to go"),
    choices: [
      { kind: "continue", label: exact(40, "keep going on the main thread") },
      { kind: "deeper", label: exact(40, "one layer deeper on this same bit") },
      { kind: "ask", label: exact(40, "ask something of your own instead") },
      { kind: "wrap", label: exact(40, "wrap it up and give me the thread") },
    ],
  },
  {
    id: id(19), type: "wrap", topicNodeId: N, detourId: null, eyebrow: exact(28),
    headline: exact(80, "you can draw the whole read path on a whiteboard from memory now"),
    beats: Array.from({ length: 5 }, (_, i) => exact(120, `beat ${i} lands the point and hands you the next one without repeating itself`)),
    stat: { value: exact(12, "1,234,567ms"), label: exact(40) },
    openThread: exact(140, "we never touched what happens when two servers hold different answers for the same key at the same moment"),
  },
  {
    id: id(20), type: "concept", topicNodeId: N, detourId: null, eyebrow: exact(28),
    headline: exact(64, "three words you would have had to look up, glossed in place"),
    body: `${GT[0]} ${GT[1]} ${GT[2]} ${exact(218, "and the rest of the body copy runs to the cap around them so the underlines have to survive a full wall of text")}`,
    terms: GLOSS,
  },
];

export function worstRows(sessionId = DEV_SESSION_ID): CardRow[] {
  const keys = generateNKeysBetween(null, null, WORST_CARDS.length);
  const now = "2026-01-01T00:00:00.000Z";
  return WORST_CARDS.map((card, i) => ({
    id: card.id,
    sessionId,
    idx: keys[i],
    type: card.type,
    payload: card,
    detourId: card.detourId,
    batchId: null,
    viewedAt: null,
    interaction: null,
    createdAt: now,
  }));
}
