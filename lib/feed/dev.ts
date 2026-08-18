import { generateNKeysBetween } from "fractional-indexing";
import type { SessionPublic } from "@/lib/api/contract";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import { CardSchema, type Card } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import type { CardRow } from "@/lib/schemas/session";
import type { Theme } from "@/lib/schemas/theme";

/** Static fixtures for /dev/cards (no network): SAMPLE_CARDS as rows + a fake active session. */
export const DEV_SESSION_ID = "00000000-0000-4000-8000-00000000dead";

const N = "n1";

/**
 * v2 card types + the inline glossary, as they'd actually be written (schema-max rulers live in
 * lib/feed/worst.ts). Appended AFTER SAMPLE_CARDS so existing slide indices in e2e specs hold.
 * Subject stays "how a cache keeps a site alive".
 */
export const SAMPLE_CARDS_V2: Card[] = [
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c001",
    type: "concept", topicNodeId: N, detourId: null, eyebrow: "the trade",
    headline: "stale beats slow, until it doesn't",
    body: "A cached answer is always a little out of date. That's the deal you sign: microseconds now, in exchange for a small window where you're serving yesterday's truth. A short TTL shrinks that window. Nothing closes it.",
    terms: [
      { term: "TTL", gloss: "time to live — the countdown on a stored answer. at zero it's dropped, so the next reader gets a fresh one." },
      { term: "cached", gloss: "kept in memory after the first lookup, so the next request skips the slow path entirely." },
    ],
  },
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c002",
    type: "stat", topicNodeId: N, detourId: null, eyebrow: "the gap",
    value: "0.2", unit: "ms",
    label: "a cache hit, start to finish",
    context: "a cache hit lands before the database has finished parsing the question. same bytes, 100× the wait — and that's a healthy database.",
    compare: { value: "20ms", label: "the same read, from disk" },
    terms: [{ term: "cache hit", gloss: "the answer was already in memory, so nothing slow had to run at all." }],
  },
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c003",
    type: "reveal", topicNodeId: N, detourId: null, eyebrow: "tap it",
    setup: "there's one way to make a single missing key cost you the whole site…",
    payoff: "let a thousand requests miss at the same instant. they all ask the database the same question and it answers it a thousand times. that's a stampede — one lock turns it back into one query.",
    terms: [{ term: "stampede", gloss: "every reader missing at once, so one cold key turns into thousands of identical queries." }],
    visual: { kind: "icon", icon: "fire" },
  },
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c004",
    type: "open", topicNodeId: N, detourId: null, eyebrow: "your words",
    prompt: "a friend asks why the site got fast overnight. what do you tell them?",
    placeholder: "say it however it comes out",
    rubric: "mentions repeated requests, memory vs disk, and that the first reader still pays full price",
    modelAnswer: "we stopped asking the database the same question over and over. the first person to ask still waits; everyone after that gets the answer straight out of memory.",
    difficulty: 2,
    terms: [{ term: "memory", gloss: "RAM — fast and forgetful. a restart wipes it, which is exactly why a cold start hurts." }],
  },
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c005",
    type: "crossroads", topicNodeId: N, detourId: null, eyebrow: "you pick",
    finished: "how a cache actually answers",
    upNext: "when the cache lies to you",
    headline: "that's the whole read path. where to?",
    choices: [
      { kind: "continue", label: "keep going" },
      { kind: "deeper", label: "one layer deeper" },
      { kind: "ask", label: "ask me something" },
      { kind: "wrap", label: "wrap it up" },
    ],
  },
  {
    id: "5c1a2b3d-0000-4000-8000-00000000c006",
    type: "wrap", topicNodeId: N, detourId: null, eyebrow: "that's the thread",
    headline: "you can draw this on a whiteboard now",
    beats: [
      "a cache is a bet that the same question gets asked twice.",
      "a miss pays full price, a hit pays almost nothing — hit rate is the whole game.",
      "a TTL is you deciding how long an answer is allowed to be a little wrong.",
      "the scary failure isn't the cache dying. it's everybody missing at the same second.",
    ],
    stat: { value: "100×", label: "memory vs disk, on a good day" },
    openThread: "we never touched what happens when two servers hold different answers for the same key.",
  },
];

for (const c of SAMPLE_CARDS_V2) CardSchema.parse(c);

/** The whole showcase deck: the phase-1 samples, then the v2 types. */
export const DEV_CARDS: Card[] = [...SAMPLE_CARDS, ...SAMPLE_CARDS_V2];

export function sampleRows(sessionId = DEV_SESSION_ID): CardRow[] {
  const keys = generateNKeysBetween(null, null, DEV_CARDS.length);
  const now = "2026-01-01T00:00:00.000Z";
  return DEV_CARDS.map((card, i) => ({
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

export function devSession(theme: Theme, title = "how a cache keeps a site alive"): SessionPublic {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: DEV_SESSION_ID,
    title,
    sourceKind: "sentence",
    sourceMeta: {},
    theme,
    persona: null,
    // a real outline, so the showcase exercises the timeline: one segment per topic, the sample
    // deck sitting inside the second one (n1) with topics behind it and ahead of it
    outline: [
      { id: "n0", title: "why a cache exists at all", estCards: 4, dependsOn: [] },
      { id: "n1", title: "how a cache actually answers", estCards: 8, dependsOn: [] },
      { id: "n2", title: "when the cache lies to you", estCards: 6, dependsOn: [] },
      { id: "n3", title: "keeping it warm", estCards: 5, dependsOn: [] },
    ],
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    learnerState: defaultLearnerState(),
    progress: { nodeIdx: 0, cardsInNode: 0, totalGenerated: DEV_CARDS.length, exhausted: false, extensions: 0, lastIdx: null, epoch: 0, pendingReplan: false, awaitingChoice: false, deeperCards: 0 },
    clarifierAnswers: {},
    storyline: null,
    status: "active",
    error: null,
    position: 0,
    createdAt: now,
    lastOpenedAt: now,
    sourceChars: 0,
    cardCount: DEV_CARDS.length,
  };
}
