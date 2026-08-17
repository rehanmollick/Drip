/**
 * lib/llm-mock.ts — deterministic LLM used when LLM_MODE=mock (Playwright, dev
 * without a key). Fast (~150ms fake latency), schema-valid, banned-word-free.
 * lib/llm.ts still runs the real pipeline around it (spend cap, logging, Zod),
 * so tests exercise every path except the network.
 *
 * Failure hooks for e2e: put "[[FAIL]]" in the input (plan text / node title /
 * question) → validation failure; "[[BUDGET]]" → budget failure. Bare markers
 * fire in every mock (so a session with one in its source never gets past
 * planning). Scoped markers fire in ONE mock only and are ignored by the rest:
 * "[[BUDGET:write]]" / "[[FAIL:write]]" (batch writer — planning succeeds, the
 * budget notice / fallback shows up mid-feed), "[[FAIL:triage]]",
 * "[[FAIL:detour]]", "[[BUDGET:plan]]".
 */
import { BANNED_WORDS } from "@/lib/copy/banned";
import type {
  DetourContext, LlmFailureCode, LlmMeta, LlmResult, PlanInput, TriageInput, WriteContext,
} from "@/lib/llm-types";
import type { Card, CardType, RecapCard } from "@/lib/schemas/cards";
import type { OutlineNode, Persona, PlanOutput, TriageOutput } from "@/lib/schemas/plan";
import type { Theme } from "@/lib/schemas/theme";
import type { IconName } from "@/lib/schemas/visual";
import { SAMPLE_THEME_FIELD_NOTES, SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { PROMPT_VERSION as DETOUR_PROMPT_VERSION } from "@/lib/prompts/detour";
import { CANNED_TOASTS, PROMPT_VERSION as DIAL_PROMPT_VERSION } from "@/lib/prompts/dial";
import { PROMPT_VERSION as PLAN_PROMPT_VERSION } from "@/lib/prompts/plan";
import { PROMPT_VERSION as TRIAGE_PROMPT_VERSION } from "@/lib/prompts/triage";
import { PROMPT_VERSION as WRITE_PROMPT_VERSION } from "@/lib/prompts/write";
import { difficultyFor, hashStr } from "@/lib/prompts/shared";

export const MOCK_MODEL = "mock";
export const MOCK_LATENCY_MS = Math.max(0, Number(process.env.LLM_MOCK_LATENCY_MS ?? 150) || 0);

// ── deterministic helpers ─────────────────────────────────────────────────────

export { hashStr };

/** A valid uuid v4 shape derived from a seed (stable across runs). */
export function deterministicUuid(seed: string): string {
  const a = hashStr(seed).toString(16).padStart(8, "0");
  const b = hashStr(seed + "|b").toString(16).padStart(8, "0");
  const c = hashStr(seed + "|c").toString(16).padStart(8, "0");
  const d = hashStr(seed + "|d").toString(16).padStart(8, "0");
  const variant = "89ab"[hashStr(seed + "|v") % 4];
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${variant}${c.slice(1, 4)}-${c.slice(4, 8)}${d.slice(0, 8)}`;
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about", "what", "how", "why", "does", "when",
  "where", "which", "who", "are", "was", "were", "have", "has", "had", "you", "your", "our", "its", "it's",
  "can", "could", "would", "should", "will", "just", "like", "want", "learn", "teach", "explain", "please",
  "tell", "know", "some", "any", "all", "not", "but", "than", "then", "there", "their", "they", "them",
  "help", "make", "made", "over", "under", "more", "less", "very", "really", "thing", "things", "stuff",
  ...BANNED_WORDS,
]);

/** First meaningful noun-ish token of an input, clamped for use inside caps. */
export function subjectOf(text: string): string {
  const words = (text ?? "")
    .replace(MARKER_RE, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const w = words[0] ?? "this";
  return w.length > 20 ? w.slice(0, 20) : w;
}

export type MockFailure = Extract<LlmFailureCode, "validation" | "budget"> | null;
export type MockScope = "plan" | "write" | "triage" | "detour";

const MARKER_RE = /\[\[(FAIL|BUDGET)(?::([a-z]+))?\]\]/g;

/**
 * e2e hook: "[[FAIL]]" → validation failure, "[[BUDGET]]" → budget failure.
 * A marker with a scope ("[[BUDGET:write]]") only fires when `scope` matches;
 * bare markers fire everywhere. Budget wins over fail when both are present.
 */
export function mockFailureFor(scope: MockScope, ...texts: Array<string | null | undefined>): MockFailure {
  const joined = texts.filter(Boolean).join("\n");
  let out: MockFailure = null;
  for (const m of joined.matchAll(MARKER_RE)) {
    if (m[2] && m[2] !== scope) continue;
    if (m[1] === "BUDGET") return "budget";
    out = "validation";
  }
  return out;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
const tokens = (chars: number) => Math.max(1, Math.ceil(chars / 4));
const clampStr = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");

function meta(promptVersion: string, inChars: number, outChars: number): LlmMeta {
  return { model: MOCK_MODEL, promptVersion, latencyMs: MOCK_LATENCY_MS, inTokens: tokens(inChars), outTokens: tokens(outChars), attempts: 1 };
}

function failure<T>(code: MockFailure, promptVersion: string, raw?: string): LlmResult<T> {
  if (code === "budget") return { ok: false, code: "budget", error: "mock: [[BUDGET]] hook", meta: { model: MOCK_MODEL, promptVersion } };
  return { ok: false, code: "validation", error: "mock: [[FAIL]] hook — output failed validation twice", raw: raw ?? `{"cards":[{"type":"concept","headline":"[[FAIL]] mock"}]}`, meta: { model: MOCK_MODEL, promptVersion, attempts: 2 } };
}

// ── themes + personas ─────────────────────────────────────────────────────────

export const MOCK_THEME_SIGNAL_ROOM: Theme = {
  name: "signal room",
  mood: "control room at 3am; deep navy, one coral alarm light, waveforms ticking under headlines",
  bg: { base: "#0a1020", gradientTo: "#121b36", texture: "dots" },
  ink: { primary: "#eef2ff", secondary: "#8a93b8" },
  accent: "#ff6b57",
  accentAlt: "#5ee1ff",
  display: "syne",
  body: "manrope",
  mono: "fira-code",
  motion: "snappy",
  signature: "an audio waveform bar pulses under hook headlines; checkpoints read as a signal lock",
  signatureKind: "waveform",
};

export const MOCK_THEMES: readonly Theme[] = [SAMPLE_THEME_TERMINAL_NOIR, SAMPLE_THEME_FIELD_NOTES, MOCK_THEME_SIGNAL_ROOM];

export const MOCK_PERSONAS: readonly Persona[] = [
  {
    name: "ops",
    traits: ["on-call for a decade", "allergic to hand-waving", "dry as a log line"],
    tics: ["says 'here's the footgun'", "ends hard truths with 'anyway.'"],
    humor: "deadpan, incident-report energy",
    neverDoes: "never says 'simply' about anything that paged someone",
    voiceSample: "the cache is not the problem. the cache is where the problem becomes visible. anyway.",
  },
  {
    name: "tide",
    traits: ["twenty years cold and wet", "notices the small thing first", "patient with beginners"],
    tics: ["says 'look closer'", "compares everything to weather"],
    humor: "warm, self-deprecating field-notebook asides",
    neverDoes: "never fakes certainty about something the notes don't show",
    voiceSample: "look closer. the pool that looks empty is the one doing the most work.",
  },
  {
    name: "signal",
    traits: ["thinks in feedback loops", "loves a clean number", "impatient with fluff"],
    tics: ["says 'lock it in'", "counts down before a payoff"],
    humor: "quick, mission-control banter",
    neverDoes: "never leaves a claim without a number or a reason",
    voiceSample: "three, two, one — that spike you see is the whole story. lock it in.",
  },
];

const ICONS: readonly IconName[] = ["bolt", "database", "wave", "leaf", "brain", "cpu", "compass", "layers", "loop", "target"];
const METAPHORS = [
  "a sticky note on the fridge",
  "a bouncer with a guest list",
  "a library hold shelf",
  "a thermostat that only reacts",
  "muscle memory",
  "a relay race baton",
  "a coat check ticket",
  "tide pools between waves",
  "a lighthouse sweep",
  "a metronome",
] as const;

function freshMetaphor(used: readonly string[], seed: number): string {
  const lower = new Set(used.map((m) => m.toLowerCase().trim()));
  const pool = METAPHORS.filter((m) => !lower.has(m));
  const list = pool.length ? pool : METAPHORS;
  return list[seed % list.length];
}

// ── card factory ──────────────────────────────────────────────────────────────

type Ctx = {
  subject: string;
  nodeId: string;
  nodeTitle: string;
  detourId: string | null;
  difficulty: number;
  seed: string;
  usedMetaphors: readonly string[];
  eyebrow?: string;
};

function base(c: Ctx, type: CardType, i: number, eyebrow?: string) {
  return {
    id: deterministicUuid(`${c.seed}|${type}|${i}`),
    type,
    topicNodeId: c.nodeId,
    detourId: c.detourId,
    ...(c.eyebrow || eyebrow ? { eyebrow: clampStr(c.eyebrow ?? eyebrow ?? "", 28) } : {}),
  };
}

function makeCard(type: CardType, c: Ctx, i: number): Card {
  const s = c.subject;
  const h = hashStr(`${c.seed}|${type}|${i}`);
  const diff = Math.max(1, Math.min(5, c.difficulty));
  switch (type) {
    case "hook":
      return {
        ...base(c, "hook", i, "hot take"),
        type: "hook",
        headline: clampStr(`${s} is holding more up than you think.`, 90),
        sub: clampStr(`${c.nodeTitle} — one scroll at a time.`, 120),
        visual: { kind: "icon", icon: ICONS[h % ICONS.length] },
      };
    case "concept":
      return {
        ...base(c, "concept", i, "one idea"),
        type: "concept",
        headline: clampStr(`${s}: the one idea`, 64),
        body: clampStr(`${s} works because it makes a bet on repetition: the thing you asked for last time is probably the thing you'll ask for next. everything else in ${c.nodeTitle} is detail on top of that bet.`, 320),
        visual: { kind: "stat", value: clampStr(`${(h % 90) + 10}%`, 12), label: "of asks repeat within a minute" },
      };
    case "code":
      return {
        ...base(c, "code", i, "the pattern"),
        type: "code",
        title: clampStr(`${s} in 8 lines`, 48),
        lang: "ts",
        code: [
          `// ${s}: ask the fast thing first`,
          `async function get(id: string) {`,
          `  const hit = await fast.get(id);`,
          `  if (hit) return hit;`,
          `  const row = await slow.find(id);`,
          `  await fast.set(id, row, { ttl: 60 });`,
          `  return row;`,
          `}`,
        ].join("\n"),
        annotations: [
          { line: 3, note: "ask the fast thing first. this is the whole trick." },
          { line: 6, note: "ttl 60 → the answer self-destructs in a minute. no ttl = stale forever." },
        ],
      };
    case "diagram": {
      const variants = ["flow", "boxes", "timeline", "compare", "cycle", "layers"] as const;
      const variant = variants[h % variants.length];
      return {
        ...base(c, "diagram", i, "the shape"),
        type: "diagram",
        variant,
        title: clampStr(`where ${s} sits`, 48),
        nodes: [
          { id: "a", label: "you" },
          { id: "b", label: clampStr(s, 24), sub: "the fast path", emphasis: true },
          { id: "c", label: "the slow thing", sub: "on disk" },
        ],
        edges: [
          { from: "a", to: "b", label: "ask" },
          { from: "b", to: "c", label: "miss" },
        ],
        tapNotes: { b: clampStr(`${s} lives in memory. that's why it's fast and why a restart wipes it.`, 160) },
      };
    }
    case "binary":
      return {
        ...base(c, "binary", i, "hot take"),
        type: "binary",
        prompt: clampStr(`hot take: turning off ${s} takes the whole thing down instantly. real or nah?`, 140),
        options: ["real", "nah"],
        correctIndex: 1,
        revealCopy: clampStr(`nah — the slow path still answers, just slower. what actually hurts is all the traffic ${s} was absorbing landing at once. that's a stampede, not an outage.`, 240),
        difficulty: diff,
      };
    case "predict":
      return {
        ...base(c, "predict", i, "call it"),
        type: "predict",
        prompt: clampStr(`${s} restarts empty on a busy monday morning. what happens next?`, 140),
        options: ["nothing, it refills", "the slow thing gets slammed", "everyone sees errors"],
        correctIndex: 1,
        revealHeadline: clampStr(`the slow thing gets slammed`, 64),
        revealBody: clampStr(`every ask that used to be a hit is now a miss, all at once. that's the thundering herd, and it's why warmups exist.`, 240),
        difficulty: diff,
      };
    case "sequence":
      return {
        ...base(c, "sequence", i, "put it in order"),
        type: "sequence",
        prompt: clampStr(`a miss in ${s}, start to finish`, 120),
        items: [
          { id: "s1", label: "check the fast path" },
          { id: "s2", label: "read the slow thing" },
          { id: "s3", label: "write it back" },
          { id: "s4", label: "return it" },
        ],
        revealCopy: clampStr(`check → read → write → return. the write happens before the return so the next ask is a hit.`, 240),
        difficulty: diff,
      };
    case "slider":
      return {
        ...base(c, "slider", i, "feel it"),
        type: "slider",
        prompt: clampStr(`how much does ${s} hit rate matter?`, 120),
        label: "hit rate",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 90,
        unit: "%",
        expression: "(1 - x/100) * 1000",
        outputLabel: "asks reaching the slow thing",
        outputUnit: "/s",
        outputFormat: "int",
        insight: clampStr(`90% → 99% isn't +9%. it's 10× fewer slow reads.`, 200),
      };
    case "reveal":
      return {
        ...base(c, "reveal", i, "tap it"),
        type: "reveal",
        setup: clampStr(`the hardest part of ${s} isn't storing the answer…`, 140),
        payoff: clampStr(`it's knowing when the stored answer is a lie. invalidation is the whole game.`, 240),
        visual: { kind: "icon", icon: "clock" },
      };
    case "checkpoint":
      return {
        ...base(c, "checkpoint", i, "flex"),
        type: "checkpoint",
        headline: clampStr(`you now know more about ${s} than most people who ship it.`, 80),
        sub: clampStr(`next: ${c.nodeTitle}.`, 160),
        stat: { value: "4", label: "in a row" },
        visual: { kind: "spark", values: [2, 4, 3, 6, 7, 9, 12], label: "momentum" },
      };
    case "recap": {
      const m = freshMetaphor(c.usedMetaphors, h);
      const card: RecapCard = {
        ...base(c, "recap", i, "rewind"),
        type: "recap",
        headline: clampStr(`${s}, new angle`, 64),
        beats: [
          clampStr(`${s} is ${m}: the answer you keep reaching for.`, 120),
          clampStr(`a miss means it isn't there yet, so you go dig through the slow thing.`, 120),
          clampStr(`a ttl is ${m} wearing out on purpose, so it can't lie to you forever.`, 120),
        ],
        metaphor: clampStr(m, 80),
      };
      return card;
    }
    default:
      // internal types are never written by the mock; fall back to a concept.
      return makeCard("concept", c, i);
  }
}

/** Type cycle: every window of 4 contains ≥1 code/diagram and ≥1 interactive. */
const CYCLE: readonly CardType[] = [
  "code", "binary", "hook", "diagram", "predict", "concept", "code", "sequence", "reveal", "diagram", "slider", "concept",
];

function typesFor(allowed: readonly CardType[], n: number, offset: number): CardType[] {
  const cycle = CYCLE.filter((t) => allowed.includes(t));
  const pool = cycle.length ? cycle : allowed.length ? [...allowed] : (["concept"] as CardType[]);
  const out: CardType[] = [];
  for (let i = 0; i < n; i++) out.push(pool[(offset + i) % pool.length]);
  return out;
}

// ── api ───────────────────────────────────────────────────────────────────────

export async function mockPlan(input: PlanInput): Promise<LlmResult<PlanOutput>> {
  await sleep(MOCK_LATENCY_MS);
  const fail = mockFailureFor("plan", input.sourceText);
  if (fail) return failure(fail, PLAN_PROMPT_VERSION, `{"title":"[[FAIL]]"}`);

  const subject = subjectOf(input.sourceText);
  const seed = `plan|${input.sourceKind}|${input.sourceText}|${JSON.stringify(input.clarifierAnswers ?? {})}`;
  const h = hashStr(seed);
  const themeIdx = h % MOCK_THEMES.length;
  const theme = MOCK_THEMES[themeIdx];
  const persona = MOCK_PERSONAS[themeIdx];

  const outline: OutlineNode[] = [
    { id: "n1", title: clampStr(`${subject}: the core idea`, 60), estCards: 4, dependsOn: [], brief: clampStr(`land what ${subject} actually is and the one bet it makes.`, 240), corpusHint: clampStr(`opening paragraphs; the first mention of ${subject}`, 200) },
    { id: "n2", title: clampStr(`where ${subject} breaks`, 60), estCards: 4, dependsOn: ["n1"], brief: clampStr(`the footguns: staleness, stampedes, and what a restart does.`, 240), corpusHint: clampStr(`failure modes, caveats, warnings`, 200) },
    { id: "n3", title: clampStr(`${subject} in practice`, 60), estCards: 4, dependsOn: ["n1"], brief: clampStr(`the pattern people actually write, with the knobs that matter.`, 240), corpusHint: clampStr(`examples, code, how-to`, 200) },
    { id: "n4", title: clampStr(`${subject}, one layer deeper`, 60), estCards: 3, dependsOn: ["n2", "n3"], brief: clampStr(`the reframe: why the simple version was hiding the real trade-off.`, 240), corpusHint: clampStr(`later sections, edge cases`, 200) },
  ];

  const wordCount = input.sourceText.trim().split(/\s+/).filter(Boolean).length;
  const ambiguous = input.sourceKind === "sentence" && (input.sourceText.includes("?") || wordCount < 6);
  const answered = input.clarifierAnswers && Object.keys(input.clarifierAnswers).length > 0;
  const clarifiers = ambiguous && !answered
    ? [
        { key: "audience", prompt: clampStr(`who's this ${subject} thing for?`, 140), options: ["me, shipping this week", "me, curious", "someone i'm explaining it to"] },
        { key: "angle", prompt: "what do you want out of it?", options: ["the mental model", "the gotchas", "the how-to"] },
      ]
    : [];

  const cctx: Ctx = { subject, nodeId: "n1", nodeTitle: outline[0].title, detourId: null, difficulty: 3, seed: `${seed}|first`, usedMetaphors: [] };
  const firstCards: Card[] = [makeCard("hook", cctx, 0), makeCard("concept", cctx, 1), { ...makeCard("concept", cctx, 2), headline: clampStr(`why ${subject} feels like magic`, 64) } as Card];

  const value: PlanOutput = {
    title: clampStr(`${subject}, scrolled in`, 60),
    theme,
    persona,
    outline,
    clarifiers,
    firstCards,
  };
  return { ok: true, value, meta: meta(PLAN_PROMPT_VERSION, input.sourceText.length + 4000, JSON.stringify(value).length) };
}

export async function mockWriteBatch(ctx: WriteContext): Promise<LlmResult<Card[]>> {
  await sleep(MOCK_LATENCY_MS);
  const fail = mockFailureFor("write", ctx.node?.title, ctx.corpusSlice);
  if (fail) return failure(fail, WRITE_PROMPT_VERSION);

  const subject = subjectOf(ctx.node?.title ?? ctx.corpusSlice ?? "this");
  const nodeId = ctx.node?.id ?? ctx.mode;
  const nodeTitle = ctx.node?.title ?? `${subject}, continued`;
  const recentKey = ctx.recent.map((r) => r.gist).join("|");
  const seed = `write|${ctx.sessionId}|${ctx.mode}|${nodeId}|${recentKey}|${ctx.learnerState.globalLevel}`;
  const c: Ctx = {
    subject, nodeId, nodeTitle, detourId: ctx.detourId, difficulty: difficultyFor(ctx.learnerState), seed, usedMetaphors: ctx.usedMetaphors,
  };
  const allowed = ctx.allowedTypes.length ? ctx.allowedTypes : (["concept"] as const);
  const has = (t: CardType) => allowed.includes(t);
  const or = (t: CardType, fallback: CardType): CardType => (has(t) ? t : has(fallback) ? fallback : allowed[0]);

  let cards: Card[];
  switch (ctx.mode) {
    case "teaser": {
      const t: Ctx = { ...c, eyebrow: "reading your stuff" };
      cards = [makeCard(or("hook", "concept"), t, 0), makeCard("concept", t, 1)];
      break;
    }
    case "adjacent": {
      const hook: Card = {
        ...makeCard(or("hook", "concept"), c, 0),
        ...(has("hook") ? { headline: clampStr(`wanna go one layer deeper into ${nodeTitle}? keep scrolling`, 90), sub: undefined, eyebrow: "adjacent waters" } : {}),
      } as Card;
      cards = [hook, makeCard("concept", c, 1)];
      break;
    }
    case "recap":
      cards = [makeCard(or("recap", "concept"), c, 0)];
      break;
    case "scaffold":
      cards = [{ ...makeCard("concept", c, 0), eyebrow: "same idea, gentler" } as Card];
      break;
    case "resurface": {
      const bets = (["binary", "predict", "sequence"] as const).filter(has);
      const pool: CardType[] = bets.length ? [...bets] : (["reveal", "concept"] as CardType[]).filter(has);
      const list = pool.length ? pool : [allowed[0]];
      const missed = ctx.missedConcepts ?? [];
      cards = Array.from({ length: Math.max(1, ctx.batchSize) }, (_, i) => {
        const card = makeCard(list[i % list.length], { ...c, subject: subjectOf(missed[i % Math.max(1, missed.length)] ?? subject) || subject, eyebrow: "fresh bet" }, i);
        return card;
      });
      break;
    }
    case "normal":
    default: {
      const n = Math.max(1, ctx.batchSize);
      const offset = ctx.recent.length === 0 ? 2 : (hashStr(nodeId) + hashStr(recentKey)) % CYCLE.length;
      const types = typesFor(allowed, n, offset);
      cards = types.map((t, i) => makeCard(t, c, i));
      const wantsCheckpoint = ctx.extraDirectives.some((d) => /checkpoint/i.test(d));
      if (wantsCheckpoint && has("checkpoint")) cards[cards.length - 1] = makeCard("checkpoint", c, cards.length - 1);
      break;
    }
  }
  return { ok: true, value: cards, meta: meta(WRITE_PROMPT_VERSION, ctx.corpusSlice.length + 3000, JSON.stringify(cards).length) };
}

export async function mockTriage(input: TriageInput): Promise<LlmResult<TriageOutput>> {
  await sleep(MOCK_LATENCY_MS);
  const fail = mockFailureFor("triage", input.question, input.corpusSlice);
  if (fail) return failure(fail, TRIAGE_PROMPT_VERSION, `{"kind":"maybe"}`);
  const q = input.question.trim();
  const wantsDetour = /\b(why|how|explain)\b/i.test(q) || q.length > 60;
  const value: TriageOutput = wantsDetour
    ? { kind: "detour", cardCount: q.length > 100 ? 4 : 3, focus: clampStr(`answer plainly: ${q}`, 120) }
    : { kind: "inline", answer: clampStr(`short answer: ${subjectOf(q)} is exactly what it sounds like here — the source keeps it simple, and so will i. tap on if you want the longer version.`, 400) };
  return { ok: true, value, meta: meta(TRIAGE_PROMPT_VERSION, input.corpusSlice.length + 1500, JSON.stringify(value).length) };
}

export async function mockWriteDetour(ctx: DetourContext): Promise<LlmResult<Card[]>> {
  await sleep(MOCK_LATENCY_MS);
  const fail = mockFailureFor("detour", ctx.question, ctx.focus, ctx.corpusSlice);
  if (fail) return failure(fail, DETOUR_PROMPT_VERSION);

  const subject = subjectOf(ctx.question) === "this" ? subjectOf(ctx.focus) : subjectOf(ctx.question);
  const seed = `detour|${ctx.sessionId}|${ctx.detourId}|${ctx.question}`;
  const c: Ctx = {
    subject, nodeId: ctx.currentCard.topicNodeId, nodeTitle: `your question`, detourId: ctx.detourId,
    difficulty: difficultyFor(ctx.learnerState), seed, usedMetaphors: ctx.usedMetaphors, eyebrow: "detour",
  };
  const allowed = ctx.allowedTypes.length ? ctx.allowedTypes : (["concept"] as const);
  const has = (t: CardType) => allowed.includes(t);
  const n = Math.max(2, Math.min(6, ctx.cardCount));

  const first: Card = {
    ...makeCard("concept", c, 0),
    headline: clampStr(`the short answer on ${subject}`, 64),
    body: clampStr(`you asked: "${ctx.question}". here's the direct answer: ${subject} does one job — keep the last answer close so the next ask is instant. the rest of this detour shows where that bites.`, 320),
  } as Card;
  const followPool = (["reveal", "diagram", "code", "binary", "predict", "concept"] as CardType[]).filter(has);
  const pool = followPool.length ? followPool : [allowed[0]];
  const rest = Array.from({ length: n - 1 }, (_, i) => makeCard(pool[i % pool.length], c, i + 1));
  const cards = [first, ...rest];
  return { ok: true, value: cards, meta: meta(DETOUR_PROMPT_VERSION, ctx.corpusSlice.length + 3000, JSON.stringify(cards).length) };
}

export async function mockDialToast(input: { persona: Persona; direction: "simpler" | "deeper" }): Promise<LlmResult<string>> {
  await sleep(Math.min(MOCK_LATENCY_MS, 50));
  const tic = input.persona.tics[0]?.replace(/^says\s+'?|'$/g, "").trim();
  const value = input.direction === "simpler"
    ? CANNED_TOASTS.simpler
    : tic ? clampStr(`bet. going a layer deeper — ${tic.replace(/[.'"]+$/, "")}.`, 90) : CANNED_TOASTS.deeper;
  return { ok: true, value, meta: meta(DIAL_PROMPT_VERSION, 300, value.length) };
}
