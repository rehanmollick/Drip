import type { Card } from "@/lib/schemas/cards";
import { CardSchema } from "@/lib/schemas/cards";

/**
 * Hardcoded sample cards of EVERY type — the phase-1 feed and the Playwright
 * fixtures render these. Subject: "how a cache keeps a site alive".
 * Every card here must validate; tests assert it and scan for banned words.
 */
const N = "n1"; // topic node id

export const SAMPLE_CARDS: Card[] = [
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01",
    type: "hook", topicNodeId: N, detourId: null, eyebrow: "0x00",
    headline: "one process is holding your whole site up.",
    sub: "and it never touches your database.",
    visual: { kind: "icon", icon: "database" },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a02",
    type: "concept", topicNodeId: N, detourId: null, eyebrow: "the idea",
    headline: "a cache is a bet on repetition",
    body: "Most requests ask for the same thing again and again. A cache keeps the last answer in memory and hands it back in microseconds instead of asking the slow thing (disk, network, database) every time.",
    visual: { kind: "stat", value: "0.2ms", label: "typical Redis hit vs ~20ms for a DB read" },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a03",
    type: "binary", topicNodeId: N, detourId: null, eyebrow: "hot take",
    prompt: "kill Redis and the site goes down instantly.",
    options: ["real", "nah"],
    correctIndex: 1,
    revealCopy: "nah — the DB still answers, just slower. what actually kills you is the traffic that used to hit the cache now hitting the DB all at once. that's a stampede, not an outage.",
    difficulty: 2,
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a04",
    type: "code", topicNodeId: N, detourId: null, eyebrow: "the pattern",
    title: "cache-aside in 9 lines",
    lang: "ts",
    code: `async function getUser(id) {\n  const hit = await redis.get(\`user:\${id}\`);\n  if (hit) return JSON.parse(hit);\n\n  const row = await db.users.find(id);\n  await redis.set(\`user:\${id}\`, JSON.stringify(row), {\n    EX: 60,\n  });\n  return row;\n}`,
    annotations: [
      { line: 2, note: "ask the fast thing first. this is the whole trick." },
      { line: 5, note: "miss → go to the slow thing. this is where stampedes happen." },
      { line: 7, note: "EX: 60 → the answer self-destructs in 60s. no TTL = stale forever." },
    ],
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a05",
    type: "diagram", topicNodeId: N, detourId: null, eyebrow: "0x01",
    variant: "flow",
    title: "where a request goes",
    nodes: [
      { id: "u", label: "phone" },
      { id: "api", label: "api" },
      { id: "c", label: "cache", sub: "in memory", emphasis: true },
      { id: "db", label: "database", sub: "on disk" },
    ],
    edges: [
      { from: "u", to: "api" },
      { from: "api", to: "c", label: "hit?" },
      { from: "c", to: "db", label: "miss" },
    ],
    tapNotes: { c: "RAM, not disk. that's why it's ~100× faster and why a restart wipes it." },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a06",
    type: "predict", topicNodeId: N, detourId: null, eyebrow: "call it",
    prompt: "the cache restarts empty at 9:00am on a Monday. what happens next?",
    options: ["nothing, it refills", "the DB gets slammed", "users see errors"],
    correctIndex: 1,
    revealHeadline: "the DB gets slammed",
    revealBody: "every request that used to be a hit is now a miss, all at once. the DB sees its Monday peak with zero help. that's the thundering herd — and it's why warmups exist.",
    difficulty: 3,
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a07",
    type: "sequence", topicNodeId: N, detourId: null, eyebrow: "put it in order",
    prompt: "a cache miss, start to finish",
    items: [
      { id: "a", label: "check the cache" },
      { id: "b", label: "read the database" },
      { id: "c", label: "write it to the cache" },
      { id: "d", label: "return to the user" },
    ],
    revealCopy: "check → read → write → return. the write happens BEFORE returning so the next request is a hit. some teams flip the last two for speed and eat the risk.",
    difficulty: 2,
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a08",
    type: "slider", topicNodeId: N, detourId: null, eyebrow: "feel it",
    prompt: "how much does hit rate matter?",
    label: "cache hit rate",
    min: 0, max: 100, step: 1, defaultValue: 90, unit: "%",
    expression: "(1 - x/100) * 1000",
    outputLabel: "requests hitting the DB per second",
    outputUnit: "/s",
    outputFormat: "int",
    insight: "90% → 99% isn't +9%. it's 10× fewer DB reads.",
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a09",
    type: "reveal", topicNodeId: N, detourId: null, eyebrow: "tap it",
    setup: "the two hardest problems in computer science are…",
    payoff: "cache invalidation, naming things, and off-by-one errors. the joke is old because the pain is real: knowing WHEN a cached answer is wrong is harder than caching it.",
    visual: { kind: "icon", icon: "clock" },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a10",
    type: "recap", topicNodeId: N, detourId: null, eyebrow: "rewind",
    headline: "same idea, new angle",
    beats: [
      "a cache is a sticky note on the fridge: the answer you keep reaching for.",
      "a miss means the note isn't there yet, so you go dig through the drawer (the DB).",
      "TTL is the note yellowing and falling off — on purpose, so it can't lie to you forever.",
    ],
    metaphor: "sticky note on the fridge",
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a11",
    type: "checkpoint", topicNodeId: N, detourId: null, eyebrow: "0x02",
    headline: "you now know more about cache stampedes than most on-call engineers.",
    sub: "next: how to make invalidation not ruin your week.",
    stat: { value: "7", label: "in a row" },
    visual: { kind: "spark", values: [2, 4, 3, 6, 7, 9, 12], label: "momentum" },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a12",
    type: "detour_marker", topicNodeId: N, detourId: "d1", kind: "open",
    question: "wait, what actually is a TTL?",
    label: "detour: your question",
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a13",
    type: "concept", topicNodeId: N, detourId: "d1", eyebrow: "detour",
    headline: "TTL = time to live",
    body: "A countdown attached to a cached value. When it hits zero the value is deleted, so the next reader is forced to fetch a fresh one. Short TTL: fresher, more DB load. Long TTL: cheaper, staler.",
    visual: { kind: "ascii", lines: ["[■■■■■■■■□□] 48s", "[■■■■□□□□□□] 21s", "[□□□□□□□□□□] gone"] },
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a14",
    type: "detour_marker", topicNodeId: N, detourId: "d1", kind: "close",
    label: "back to the main thread",
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a15",
    type: "clarify", topicNodeId: "clarify", detourId: null, eyebrow: "quick one",
    key: "audience",
    prompt: "who's this for?",
    options: ["me, shipping this week", "me, curious", "someone i'm explaining it to"],
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a16",
    type: "notice", topicNodeId: "system", detourId: null,
    kind: "budget",
    headline: "we hit today's budget.",
    body: "resets at midnight. go touch grass, legend.",
  },
  {
    id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a17",
    type: "fallback", topicNodeId: "system", detourId: null,
    reason: "sample",
    retryable: true,
  },
];

// Fail loudly at import time if a sample ever drifts from the schema.
for (const c of SAMPLE_CARDS) CardSchema.parse(c);
