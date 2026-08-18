/**
 * lib/llm.ts — THE ONLY FILE THAT IMPORTS @anthropic-ai/sdk.
 *
 * Every call: spend-cap check (fails closed) → call → log to llm_calls →
 * extract JSON → Zod validate → retry ONCE with the error appended → return
 * LlmResult. Failure is data: nothing here throws across the generation
 * boundary. LLM_MODE=mock swaps the network for lib/llm-mock.ts but keeps the
 * cap, the logging and the validation so tests exercise the whole pipeline.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { z } from "zod";
import { findBannedInValue, scrubBannedValue } from "@/lib/copy/banned";
import { findStyleProblem, styleProblemMessage } from "@/lib/copy/style";
import { stripMarkupValue } from "@/lib/copy/sanitize";
import { getStore } from "@/lib/db";
import type { Store } from "@/lib/db/store";
import type {
  DetourContext, EvaluateOpenInput, LlmApi, LlmFailureCode, LlmMeta, LlmResult, OpenEvaluation,
  PlanInput, StorylineInput, TriageInput, WrapContext, WriteContext,
} from "@/lib/llm-types";
import { CardSchema, WRITER_CARD_TYPES, type Card, type CardType } from "@/lib/schemas/cards";
import { PlanOutputSchema, TriageOutputSchema, type Persona, type PlanOutput, type TriageOutput } from "@/lib/schemas/plan";
import { LLM_PURPOSES, type Storyline } from "@/lib/schemas/session";
import * as mock from "./llm-mock";
import { PROMPT_VERSION as DETOUR_PROMPT_VERSION, buildDetourPrompt } from "./prompts/detour";
import { CANNED_TOASTS, DialToastSchema, PROMPT_VERSION as DIAL_PROMPT_VERSION, buildDialPrompt } from "./prompts/dial";
import { OpenEvaluationSchema, PROMPT_VERSION as EVALUATE_PROMPT_VERSION, buildEvaluatePrompt } from "./prompts/evaluate";
import { PROMPT_VERSION as PLAN_PROMPT_VERSION, buildPlanPrompt } from "./prompts/plan";
import { loggedPromptVersion, type Prompt } from "./prompts/shared";
import { PROMPT_VERSION as STORYLINE_PROMPT_VERSION, StorylineOutSchema, buildStorylinePrompt, type StorylineOut } from "./prompts/storyline";
import { PROMPT_VERSION as TRIAGE_PROMPT_VERSION, buildTriagePrompt } from "./prompts/triage";
import { PROMPT_VERSION as WRAP_PROMPT_VERSION, WrapOutSchema, buildWrapPrompt, type WrapOut } from "./prompts/wrap";
import { PROMPT_VERSION as WRITE_PROMPT_VERSION, buildWritePrompt } from "./prompts/write";

type LlmPurpose = (typeof LLM_PURPOSES)[number];

/**
 * topicNodeId for cards that belong to no outline node (the wrap card). Mirrors
 * lib/generation/system-cards.ts SYSTEM_NODE — duplicated rather than imported so the
 * one-file SDK layer never depends on the generation layer that depends on it.
 */
const SYSTEM_TOPIC_NODE = "system";

// ── config ────────────────────────────────────────────────────────────────────

/** Env value or default; a blank/whitespace value (".env.example" style) means "unset". */
const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined ? undefined : v.trim() || undefined;
};

export const PLAN_MODEL = () => env("LLM_PLAN_MODEL") ?? "claude-sonnet-4-6";
export const WRITE_MODEL = () => env("LLM_WRITE_MODEL") ?? "claude-haiku-4-5";
export const isMockMode = () => env("LLM_MODE") === "mock";

/**
 * The hard dead-prose gate (lib/copy/style.ts), on unless DRIP_STYLE_GATE=off.
 * A gate that fires more often than we think quietly thins the feed instead of
 * failing loudly, so it has to be switchable without a deploy.
 */
export const styleGateOn = () => env("DRIP_STYLE_GATE") !== "off";

/** Mock mode spends nothing; its cap is only there so the pipeline stays identical (LLM_MOCK_DAILY_CALL_CAP to override). */
export const MOCK_DAILY_CALL_CAP = 100_000;
let warnedCap: string | null = null;
export const dailyCallCap = (): number => {
  const raw = isMockMode() ? env("LLM_MOCK_DAILY_CALL_CAP") ?? String(MOCK_DAILY_CALL_CAP) : env("LLM_DAILY_CALL_CAP") ?? "500";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    if (warnedCap !== raw) {
      warnedCap = raw;
      console.error(`[llm] LLM_DAILY_CALL_CAP=${JSON.stringify(raw)} is not a positive number — every call fails closed until it is fixed.`);
    }
    return Number.NaN;
  }
  return n;
};

/**
 * Output caps. Batches scale with the card count (a 6-card detour with two code
 * + two diagram cards pretty-printed by Haiku can pass 4k tokens; a truncated
 * body wastes the call). Plans: one JSON object, ~2–3k tokens, no extended
 * thinking — the spec budgets 10–20s for planning.
 */
const MAX_TOKENS = { plan: 8_000, triage: 600, toast: 200, evaluate: 500, storyline: 900 } as const;
export function batchMaxTokens(cardCount: number): number {
  const n = Number.isFinite(cardCount) ? Math.max(1, Math.round(cardCount)) : 4;
  return Math.min(8_000, Math.max(3_000, 1_000 * n + 1_000));
}

/**
 * Overall deadline per pipeline call (both attempts + SDK retries + stream). Every one sits under the
 * engine's takeover windows (planning watchdog / stale-batch takeover = 90s) so a stalled stream can
 * never let two owners generate the same frontier or a plan land after the session was declared dead.
 */
export const DEADLINE_MS = {
  plan: 75_000, batch: 60_000, triage: 20_000, toast: 8_000,
  /** The reader is staring at a text box waiting for a reply — this one is felt directly. */
  evaluate: 20_000,
  /** Housekeeping between topics; never blocks a card. */
  storyline: 25_000,
  /** One card, but it's the ending — worth the same room as a small batch. */
  wrap: 40_000,
} as const;
/** Don't start a paid retry with less than this left — a truncated retry is a wasted call. */
export const MIN_RETRY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 120_000; // SDK per-request TTFB guard; the deadline signal above is the real bound

// ── dependency injection (tests) ──────────────────────────────────────────────

type Deps = { store?: Store; now?: () => Date; call?: CallFn };
let deps: Deps = {};

/** Tests inject a fake store / clock / model call. Production resolves the store lazily via lib/db and calls Anthropic. */
export function __setDeps(next: Deps): void {
  deps = { ...deps, ...next };
}
export function __resetDeps(): void {
  deps = {};
}

const resolveStore = () => (deps.store ? Promise.resolve(deps.store) : getStore());
const now = () => (deps.now ? deps.now() : new Date());

export function startOfTodayUtc(d: Date = now()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

// ── spend cap + logging ───────────────────────────────────────────────────────

/**
 * Fails closed either way, but the two causes are different failures downstream:
 * - `budget`: the cap is genuinely reached → the engine shows the day-long budget notice.
 * - `api`: the spend counter can't be read (store blip, misconfigured cap) → a retryable
 *   fallback card, never a false "we hit today's budget" that dead-ends the feed till midnight.
 */
type CapCheck = { ok: true; count: number } | { ok: false; code: "budget" | "api"; error: string };
async function checkCap(): Promise<CapCheck> {
  const cap = dailyCallCap();
  if (!Number.isFinite(cap)) return { ok: false, code: "api", error: "spend counter unreadable: daily cap misconfigured" };
  let count: number;
  try {
    count = await (await resolveStore()).countLlmCallsSince(startOfTodayUtc());
  } catch {
    return { ok: false, code: "api", error: "spend counter unreadable" };
  }
  if (!Number.isFinite(count)) return { ok: false, code: "api", error: "spend counter unreadable" };
  if (count >= cap) return { ok: false, code: "budget", error: `daily cap reached (${count}/${cap})` };
  return { ok: true, count };
}

type LogInput = {
  sessionId: string | null;
  purpose: LlmPurpose;
  model: string;
  promptVersion: string;
  inTokens: number;
  outTokens: number;
  latencyMs: number;
  ok: boolean;
  error: string | null;
};

/** llm_calls.error is text; ordinary errors stay short, the double-failure entry carries the raw output. */
const LOG_ERROR_CHARS = 500;
export const LOG_RAW_CHARS = 8_000;

async function log(entry: LogInput): Promise<void> {
  try {
    await (await resolveStore()).logLlmCall({
      id: randomUUID(),
      sessionId: entry.sessionId,
      purpose: entry.purpose,
      model: entry.model,
      promptVersion: entry.promptVersion,
      inTokens: Math.max(0, Math.round(entry.inTokens)),
      outTokens: Math.max(0, Math.round(entry.outTokens)),
      latencyMs: Math.max(0, Math.round(entry.latencyMs)),
      ok: entry.ok,
      error: entry.error ? entry.error.slice(0, LOG_ERROR_CHARS + LOG_RAW_CHARS) : null,
      createdAt: now().toISOString(),
    });
  } catch (e) {
    console.error("[llm] failed to log call", e);
  }
}

// ── json extraction + validation ──────────────────────────────────────────────

/**
 * Return the first balanced {...} object in the text, or null. Fences and prose around it are
 * ignored by construction (scan starts at the first "{", stops at its match); nothing inside string
 * values is ever rewritten — a code card may legitimately contain "```".
 */
export function extractJsonObject(text: string): string | null {
  const t = text;
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

export function formatIssues(err: z.ZodError): string {
  const issues = err.issues.slice(0, 30).map((i) => `- ${i.path.map(String).join(".") || "$"}: ${i.message}`);
  const more = err.issues.length > 30 ? `\n- (+${err.issues.length - 30} more)` : "";
  return issues.join("\n") + more;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only fix-ups allowed before Zod: ids that aren't uuids and a missing detourId. Everything else is Zod's call. */
export function normalizeCards(cards: unknown, detourId: string | null): unknown {
  if (!Array.isArray(cards)) return cards;
  return cards.map((c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return c;
    const o = { ...(c as Record<string, unknown>) };
    if (typeof o.id !== "string" || !UUID_RE.test(o.id)) o.id = randomUUID();
    if (o.detourId === undefined) o.detourId = detourId;
    return o;
  });
}

/**
 * Word-boundary truncation for fields that are NEVER on screen (planner art-direction,
 * persona notes, outline briefs) or are tiny labels (eyebrows). A 40s Sonnet call should
 * not be thrown away because a "brief" ran 12 characters long. On-screen copy stays strict.
 */
export function softClamp(v: unknown, max: number): unknown {
  if (typeof v !== "string" || v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—-]+$/, "") + "…";
}

const PLAN_CLAMPS: Array<[path: string[], max: number]> = [
  [["title"], 60],
  [["theme", "name"], 40], [["theme", "mood"], 120], [["theme", "signature"], 160],
  [["persona", "name"], 24], [["persona", "humor"], 60], [["persona", "neverDoes"], 80], [["persona", "voiceSample"], 160],
];

/**
 * Soft-clamp the plan's internal strings AND its trivially-normalizable bounds (estCards 3..8,
 * ≤ 3 clarifiers, ≤ 24 outline nodes, ≤ 3 firstCards) — none of these is worth a second Sonnet call.
 */
export function clampPlanInternalFields(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const o = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  for (const [path, max] of PLAN_CLAMPS) {
    let cur: Record<string, unknown> | undefined = o;
    for (const k of path.slice(0, -1)) cur = cur?.[k] as Record<string, unknown> | undefined;
    const last = path[path.length - 1];
    if (cur && typeof cur === "object" && last in cur) cur[last] = softClamp(cur[last], max);
  }
  const persona = o.persona as Record<string, unknown> | undefined;
  if (persona && Array.isArray(persona.traits)) persona.traits = persona.traits.map((t) => softClamp(t, 40));
  if (persona && Array.isArray(persona.tics)) persona.tics = persona.tics.map((t) => softClamp(t, 60));
  if (Array.isArray(o.outline)) {
    o.outline = o.outline.slice(0, 24).map((n) => {
      if (!n || typeof n !== "object") return n;
      const node = n as Record<string, unknown>;
      const est = typeof node.estCards === "number" && Number.isFinite(node.estCards) ? Math.min(8, Math.max(3, Math.round(node.estCards))) : node.estCards;
      return { ...node, estCards: est, title: softClamp(node.title, 60), brief: softClamp(node.brief, 240), corpusHint: softClamp(node.corpusHint, 200) };
    });
  }
  if (Array.isArray(o.clarifiers)) {
    o.clarifiers = o.clarifiers.slice(0, 3).map((c) => {
      if (!c || typeof c !== "object") return c;
      const cl = c as Record<string, unknown>;
      return { ...cl, prompt: softClamp(cl.prompt, 140), options: Array.isArray(cl.options) ? cl.options.slice(0, 3).map((x) => softClamp(x, 40)) : cl.options };
    });
  }
  if (Array.isArray(o.firstCards) && o.firstCards.length > 3) o.firstCards = o.firstCards.slice(0, 3);
  return o;
}

/** Eyebrows are 28-char labels — clamp rather than reject the whole batch. */
export function clampEyebrows(cards: unknown): unknown {
  if (!Array.isArray(cards)) return cards;
  return cards.map((c) => (c && typeof c === "object" && "eyebrow" in (c as object) ? { ...(c as Record<string, unknown>), eyebrow: softClamp((c as Record<string, unknown>).eyebrow, 28) } : c));
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string; issues: z.ZodError };

function validate<T>(schema: z.ZodType<T>, parsed: unknown): Validation<T> {
  const r = schema.safeParse(parsed);
  if (!r.success) return { ok: false, error: `schema validation failed:\n${formatIssues(r.error)}`, issues: r.error };
  return { ok: true, value: r.data };
}

/**
 * Trim one over-long string back to a sentence boundary. Returns null when that would cost
 * too much of the text (a single long sentence) — the caller then retries rather than
 * publishing a stump. Cutting after "…the whole game." reads like the writer stopped there;
 * cutting mid-clause reads broken, which is why this never hard-truncates on-screen copy.
 */
export function trimToSentence(text: string, max: number): string | null {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("… "));
  // a terminator at the very end of the window counts too (no trailing space to find)
  const tail = /[.!?…]$/.test(head.slice(0, max)) ? max - 1 : -1;
  const cut = Math.max(end, tail);
  if (cut < 0) return null;
  const out = text.slice(0, cut + 1).trimEnd();
  return out.length >= Math.floor(max * 0.55) ? out : null;
}

type PathKey = string | number | symbol;
function atPath(root: unknown, path: readonly PathKey[]): { parent: Record<PathKey, unknown>; key: PathKey } | null {
  let cur: unknown = root;
  for (const k of path.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<PathKey, unknown>)[k];
  }
  if (cur === null || typeof cur !== "object") return null;
  return { parent: cur as Record<PathKey, unknown>, key: path[path.length - 1] };
}

/**
 * The writer overshoots a character cap on a meaningful share of batches (Haiku cannot count
 * characters). Rather than spend a whole retry on it, trim exactly the fields Zod flagged back
 * to a sentence boundary and re-validate. Anything that can't be trimmed cleanly still retries.
 */
export function trimTooBig(value: unknown, err: z.ZodError): { value: unknown; trimmed: string[] } | null {
  const tooBig = err.issues.filter((i) => i.code === "too_big" && typeof (i as { maximum?: unknown }).maximum === "number" && i.path.length);
  if (!tooBig.length) return null;
  const next = JSON.parse(JSON.stringify(value)) as unknown;
  const trimmed: string[] = [];
  for (const issue of tooBig) {
    const max = Number((issue as unknown as { maximum: number }).maximum);
    const slot = atPath(next, issue.path);
    if (!slot) continue;
    const cur = slot.parent[slot.key];
    if (typeof cur !== "string") continue;
    const out = trimToSentence(cur, max);
    if (out === null) continue;
    slot.parent[slot.key] = out;
    trimmed.push(issue.path.join("."));
  }
  return trimmed.length ? { value: next, trimmed } : null;
}

/**
 * On-screen projection for the banned-word scan/scrub. `keys` = top-level keys that reach the
 * screen; undefined = the whole value (cards). Internal fields (outline briefs, persona notes,
 * theme mood, triage focus) are writer briefs — a "chapter 3" there is not a Prime Directive
 * violation and must never cost a second Sonnet call or get garbled by the scrubber.
 */
function onScreen<T>(value: T, keys?: readonly string[]): unknown {
  if (!keys) return value;
  if (!value || typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  const pick: Record<string, unknown> = {};
  for (const k of keys) if (k in o) pick[k] = o[k];
  return pick;
}
function scrubOnScreen<T>(value: T, keys?: readonly string[]): T {
  if (!keys) return scrubBannedValue(value);
  if (!value || typeof value !== "object") return value;
  return { ...value, ...(scrubBannedValue(onScreen(value, keys)) as object) } as T;
}
const bannedProblem = (b: { word: string; path: string }) => `banned school vocabulary on screen: "${b.word}" at ${b.path}. rewrite that string without it.`;

/**
 * Per-call output schema for the writers: every card must be a type this call may emit
 * (chill mode drops bets/sliders; internal types — notice, fallback, clarify, detour_marker —
 * are never accepted from a model). Violations hit the retry-with-error path.
 */
export function cardsSchemaFor(allowed: readonly CardType[]) {
  const set = new Set<CardType>(allowed.filter((t) => (WRITER_CARD_TYPES as readonly CardType[]).includes(t)));
  const ok = set.size ? set : new Set<CardType>(WRITER_CARD_TYPES);
  const list = [...ok].join(", ");
  const item = CardSchema
    .refine((c) => ok.has(c.type), { message: `card type not allowed for this call (allowed: ${list})` })
    // the dead-prose gate — a PER-CALL accept check, not card shape, so no schema version bump and
    // nothing already stored is ever re-judged. salvageCards absorbs a hit by dropping the one card.
    .superRefine((c, ctx) => {
      if (!styleGateOn()) return;
      const problem = findStyleProblem(c);
      if (problem) ctx.addIssue({ code: "custom", path: problem.keys, message: styleProblemMessage(problem) });
    });
  return z.object({ cards: z.array(item).min(1).max(8) });
}

/**
 * Salvage pass for card batches: one over-long string in one card would otherwise throw away three
 * perfectly good cards and burn a retry (the writer overshoots a cap ~1 batch in 4). Keep the cards
 * that validate on their own, as long as most of the batch survives; the caller retries otherwise.
 * Cards are independent by construction — each is its own screen — so dropping one is safe.
 */
export function salvageCards(
  parsed: unknown,
  schema: z.ZodType<{ cards: Card[] }>,
  want: number,
): { value: { cards: Card[] }; dropped: number } | null {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { cards?: unknown }).cards)) return null;
  const raw = (parsed as { cards: unknown[] }).cards;
  const kept: unknown[] = [];
  for (const c of raw) {
    if (schema.safeParse({ cards: [c] }).success) kept.push(c);
  }
  const dropped = raw.length - kept.length;
  if (!kept.length || dropped === 0) return null;
  // keep the batch only if it still carries most of what was asked for; a mostly-broken batch is a retry
  if (kept.length < Math.max(1, Math.ceil(Math.min(want, raw.length) / 2))) return null;
  const r = schema.safeParse({ cards: kept });
  return r.success ? { value: r.data, dropped } : null;
}

/** The fast-path cards: a hook first, then writer types only (chill mode → no bets/sliders). */
export function planSchemaFor(allowed: readonly CardType[]) {
  const set = new Set<CardType>(allowed.filter((t) => (WRITER_CARD_TYPES as readonly CardType[]).includes(t)));
  const ok = set.size ? set : new Set<CardType>(WRITER_CARD_TYPES);
  return PlanOutputSchema.superRefine((p, ctx) => {
    p.firstCards.forEach((c, i) => {
      if (i === 0 && c.type !== "hook") ctx.addIssue({ code: "custom", path: ["firstCards", 0, "type"], message: `firstCards[0] must be a "hook" (got "${c.type}")` });
      else if (!ok.has(c.type)) ctx.addIssue({ code: "custom", path: ["firstCards", i, "type"], message: `card type "${c.type}" not allowed here (allowed: ${[...ok].join(", ")})` });
    });
  });
}

// ── anthropic client ──────────────────────────────────────────────────────────

let client: Anthropic | null = null;
let clientKey: string | null = null;

function getClient(apiKey: string): Anthropic {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

export type CallOutcome =
  | { kind: "text"; text: string; inTokens: number; outTokens: number; latencyMs: number; truncated: boolean }
  | { kind: "refusal"; inTokens: number; outTokens: number; latencyMs: number }
  | { kind: "error"; error: string; latencyMs: number };
export type CallOpts = { apiKey: string; model: string; system: string; user: string; maxTokens: number; deadlineMs: number; temperature?: number };
export type CallFn = (opts: CallOpts) => Promise<CallOutcome>;

async function callAnthropic(opts: CallOpts): Promise<CallOutcome> {
  const started = Date.now();
  const deadlineMs = Math.max(1, Math.round(opts.deadlineMs));
  try {
    // Streamed so a long JSON body never trips the non-streaming idle timeout; finalMessage() assembles it.
    // The abort signal is the overall bound: TTFB, SDK retries AND a stalled stream all end at the deadline.
    const res = await getClient(opts.apiKey)
      .messages.stream(
        {
          model: opts.model,
          max_tokens: opts.maxTokens,
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: opts.user }],
        },
        { signal: AbortSignal.timeout(deadlineMs) },
      )
      .finalMessage();
    const latencyMs = Date.now() - started;
    const inTokens = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    const outTokens = res.usage.output_tokens;
    if (res.stop_reason === "refusal") return { kind: "refusal", inTokens, outTokens, latencyMs };
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    return { kind: "text", text, inTokens, outTokens, latencyMs, truncated: res.stop_reason === "max_tokens" };
  } catch (e) {
    const latencyMs = Date.now() - started;
    if (e instanceof Anthropic.APIUserAbortError || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) {
      return { kind: "error", error: `deadline: no complete response within ${Math.round(deadlineMs / 1000)}s`, latencyMs };
    }
    if (e instanceof Anthropic.APIConnectionError) return { kind: "error", error: `connection: ${e.message}`, latencyMs };
    if (e instanceof Anthropic.RateLimitError) return { kind: "error", error: `rate limited (429): ${e.message}`, latencyMs };
    if (e instanceof Anthropic.AuthenticationError) return { kind: "error", error: `auth (401): ${e.message}`, latencyMs };
    if (e instanceof Anthropic.APIError) return { kind: "error", error: `api (${e.status ?? "?"}): ${e.message}`, latencyMs };
    return { kind: "error", error: e instanceof Error ? e.message : String(e), latencyMs };
  }
}

// ── the pipeline ──────────────────────────────────────────────────────────────

type GenerateOpts<T> = {
  purpose: LlmPurpose;
  sessionId: string | null;
  model: string;
  /** Logged with every call: file version + borrowed versions + shared fingerprint (see prompts/shared.ts). */
  promptVersion: string;
  prompt: Prompt;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Overall bound for this call (both attempts). Always under the engine's takeover windows. */
  deadlineMs: number;
  /** Applied to the parsed JSON before validation (only id/detourId fix-ups + soft clamps). */
  normalize?: (parsed: unknown) => unknown;
  /** Reject on-screen school vocabulary (retries once, then scrubs — a slightly-off word beats a dead feed). */
  checkBanned?: boolean;
  /** Top-level keys of the value that reach the screen; undefined = everything (cards). */
  onScreenKeys?: readonly string[];
  /** Card batches only: how many cards the prompt asked for. Enables the per-card salvage pass. */
  salvageWant?: number;
  mock: () => Promise<LlmResult<T>>;
};

async function generate<T>(o: GenerateOpts<T>): Promise<LlmResult<T>> {
  const baseMeta = { model: o.model, promptVersion: o.promptVersion };
  const deadlineAt = Date.now() + o.deadlineMs;

  // 1. spend cap — fails closed (budget when reached, api when the counter can't be read).
  const cap = await checkCap();
  if (!cap.ok) {
    await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: 0, ok: false, error: `${cap.code}: ${cap.error}` });
    return { ok: false, code: cap.code, error: cap.error, meta: baseMeta };
  }

  // 2. mock mode — same pipeline, canned model.
  if (isMockMode()) {
    const started = Date.now();
    const r = await o.mock();
    const latencyMs = Date.now() - started;
    if (r.ok) {
      const normalized = o.normalize ? o.normalize(r.value) : r.value;
      const v = validate(o.schema, normalized);
      const finalOk = v.ok;
      await log({ sessionId: o.sessionId, purpose: o.purpose, model: mock.MOCK_MODEL, promptVersion: o.promptVersion, inTokens: r.meta.inTokens, outTokens: r.meta.outTokens, latencyMs, ok: finalOk, error: v.ok ? null : v.error });
      if (!v.ok) return { ok: false, code: "validation", error: v.error, raw: JSON.stringify(r.value), meta: { ...baseMeta, model: mock.MOCK_MODEL, latencyMs, attempts: 1 } };
      return { ok: true, value: v.value, meta: { ...r.meta, promptVersion: o.promptVersion, latencyMs } };
    }
    await log({ sessionId: o.sessionId, purpose: o.purpose, model: mock.MOCK_MODEL, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs, ok: false, error: `${r.code}: ${r.error}` });
    return { ...r, meta: { ...(r.meta ?? {}), model: mock.MOCK_MODEL, promptVersion: o.promptVersion, latencyMs } };
  }

  // 3. key present?
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: 0, ok: false, error: "no_key: ANTHROPIC_API_KEY missing" });
    return { ok: false, code: "no_key", error: "ANTHROPIC_API_KEY is not set", meta: baseMeta };
  }

  // 4. call → validate → retry once with the error appended.
  let user = o.prompt.user;
  let totalIn = 0;
  let totalOut = 0;
  let totalLatency = 0;
  let lastRaw: string | undefined;
  let lastError = "unknown";
  let lastCode: LlmFailureCode = "validation";
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      // a retry that can't finish inside the deadline is a wasted paid call — bail as a validation failure.
      if (deadlineAt - Date.now() < MIN_RETRY_MS) {
        lastError = `${lastError} (no time left to retry within ${Math.round(o.deadlineMs / 1000)}s)`;
        break;
      }
      // re-check the cap for the paid retry (still fails closed).
      const again = await checkCap();
      if (!again.ok) {
        await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: 0, ok: false, error: `${again.code}: ${again.error}` });
        return { ok: false, code: again.code, error: again.error, raw: lastRaw, meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: 1 } };
      }
    }
    attemptsMade = attempt;
    const out = await (deps.call ?? callAnthropic)({ apiKey, model: o.model, system: o.prompt.system, user, maxTokens: o.maxTokens, deadlineMs: deadlineAt - Date.now() });
    totalLatency += out.latencyMs;

    if (out.kind === "error") {
      await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: out.latencyMs, ok: false, error: `api: ${out.error}` });
      return { ok: false, code: "api", error: out.error, raw: lastRaw, meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: attempt } };
    }
    totalIn += out.inTokens;
    totalOut += out.outTokens;
    if (out.kind === "refusal") {
      await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: out.inTokens, outTokens: out.outTokens, latencyMs: out.latencyMs, ok: false, error: "refusal" });
      return { ok: false, code: "refusal", error: "model refused", meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: attempt } };
    }

    lastRaw = out.text;
    const jsonText = extractJsonObject(out.text);
    let problem: string | null = null;
    let value: T | undefined;
    /** Logged even on a successful call: this is how often the salvage pass (and the style gate) actually fires. */
    let salvaged: string | null = null;
    if (out.truncated && !jsonText) {
      problem = "your output was cut off before the JSON closed (max_tokens). be more concise: shorter strings, no extras.";
    } else if (!jsonText) {
      problem = "no JSON object found in your output.";
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parsed = undefined;
        problem = `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!problem) {
        const normalized = o.normalize ? o.normalize(parsed) : parsed;
        let v = validate(o.schema, normalized);
        if (!v.ok) {
          // Haiku can't count characters; trim what Zod flagged back to a sentence boundary
          // rather than spend a retry on copy that is otherwise good.
          const t = trimTooBig(normalized, v.issues);
          if (t) {
            const retried = validate(o.schema, t.value);
            if (retried.ok) {
              console.warn(`[llm] ${o.purpose}: trimmed over-long ${t.trimmed.join(", ")} to a sentence boundary`);
              v = retried;
            }
          }
        }
        if (!v.ok && o.salvageWant !== undefined) {
          // one over-long string shouldn't cost three good cards and a retry
          const s = salvageCards(normalized, o.schema as unknown as z.ZodType<{ cards: Card[] }>, o.salvageWant);
          if (s) {
            salvaged = `salvaged: dropped ${s.dropped} card(s) that failed validation, kept ${s.value.cards.length}. ${v.error}`;
            console.warn(`[llm] ${o.purpose}: ${salvaged}`);
            v = { ok: true, value: s.value as unknown as T };
          }
        }
        if (v.ok) {
          const banned = o.checkBanned ? findBannedInValue(onScreen(v.value, o.onScreenKeys)) : null;
          if (banned && attempt === 1) {
            problem = bannedProblem(banned);
          } else {
            if (banned) {
              // never on screen: scrub with feed-native synonyms (never longer than the word — stays inside the caps)
              console.warn(`[llm] ${o.purpose}: banned word "${banned.word}" survived the retry at ${banned.path}; scrubbing.`);
              value = stripMarkupValue(scrubOnScreen(v.value, o.onScreenKeys));
            } else {
              value = stripMarkupValue(v.value);
            }
          }
        } else {
          problem = v.error;
        }
      }
    }

    // spec §12.2: the double failure persists the raw output with the call so a bad generation is reproducible.
    const logError = value !== undefined ? null : attempt === 2
      ? `validation: ${problem}\n--- raw output (first ${LOG_RAW_CHARS} chars) ---\n${out.text.slice(0, LOG_RAW_CHARS)}`
      : `validation: ${problem}`;
    await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: out.inTokens, outTokens: out.outTokens, latencyMs: out.latencyMs, ok: value !== undefined, error: logError ?? salvaged });

    if (value !== undefined) {
      const metaOut: LlmMeta = { model: o.model, promptVersion: o.promptVersion, latencyMs: totalLatency, inTokens: totalIn, outTokens: totalOut, attempts: attempt };
      return { ok: true, value, meta: metaOut };
    }

    lastError = problem ?? "validation failed";
    lastCode = "validation";
    if (attempt === 1) {
      user =
        `${o.prompt.user}\n\n` +
        `your previous output failed validation:\n${lastError}\n\n` +
        `your previous output was:\n<<<PREVIOUS\n${out.text.slice(0, 20_000)}\nPREVIOUS>>>\n\n` +
        `fix every issue and re-emit ONLY the JSON object. no prose, no code fences.`;
    }
  }

  console.warn(`[llm] ${o.purpose} (${o.promptVersion}) failed twice: ${lastError}\nraw: ${(lastRaw ?? "").slice(0, 1500)}`);
  return { ok: false, code: lastCode, error: lastError, raw: lastRaw, meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: attemptsMade } };
}

// ── public api ────────────────────────────────────────────────────────────────

/** Types the planner's fast-path cards may use: writer types, minus bets/sliders in chill mode. */
function planAllowedTypes(input: PlanInput): readonly CardType[] {
  return input.settings.chillMode
    ? WRITER_CARD_TYPES.filter((t) => t !== "binary" && t !== "predict" && t !== "sequence" && t !== "slider")
    : WRITER_CARD_TYPES;
}

/** What the planner puts ON SCREEN: the title, clarifier cards, the first three cards. Everything else briefs the writer. */
const PLAN_ON_SCREEN = ["title", "clarifiers", "firstCards"] as const;

async function plan(input: PlanInput): Promise<LlmResult<PlanOutput>> {
  const r = await generate<PlanOutput>({
    purpose: input.previousPlan ? "replan" : "plan",
    sessionId: input.sessionId,
    model: PLAN_MODEL(),
    promptVersion: loggedPromptVersion(PLAN_PROMPT_VERSION),
    prompt: buildPlanPrompt(input),
    schema: planSchemaFor(planAllowedTypes(input)),
    maxTokens: MAX_TOKENS.plan,
    deadlineMs: DEADLINE_MS.plan,
    checkBanned: true,
    onScreenKeys: PLAN_ON_SCREEN,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = clampPlanInternalFields(parsed) as Record<string, unknown>;
      return { ...o, firstCards: clampEyebrows(normalizeCards(o.firstCards, null)) };
    },
    mock: () => mock.mockPlan(input),
  });
  return r;
}

async function writeBatch(ctx: WriteContext): Promise<LlmResult<Card[]>> {
  const r = await generate<{ cards: Card[] }>({
    purpose: "write",
    sessionId: ctx.sessionId,
    model: WRITE_MODEL(),
    promptVersion: loggedPromptVersion(WRITE_PROMPT_VERSION),
    prompt: buildWritePrompt(ctx),
    schema: cardsSchemaFor(ctx.allowedTypes),
    maxTokens: batchMaxTokens(ctx.mode === "teaser" || ctx.mode === "adjacent" ? 2 : ctx.mode === "recap" || ctx.mode === "scaffold" ? 1 : ctx.batchSize),
    deadlineMs: DEADLINE_MS.batch,
    checkBanned: true,
    salvageWant: ctx.batchSize,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = parsed as Record<string, unknown>;
      return { ...o, cards: clampEyebrows(normalizeCards(o.cards, ctx.detourId)) };
    },
    mock: async () => {
      const m = await mock.mockWriteBatch(ctx);
      return m.ok ? { ok: true, value: { cards: m.value }, meta: m.meta } : m;
    },
  });
  return r.ok ? { ok: true, value: r.value.cards, meta: r.meta } : r;
}

async function triage(input: TriageInput): Promise<LlmResult<TriageOutput>> {
  return generate<TriageOutput>({
    purpose: "triage",
    sessionId: input.sessionId,
    model: WRITE_MODEL(),
    promptVersion: loggedPromptVersion(TRIAGE_PROMPT_VERSION),
    prompt: buildTriagePrompt(input),
    schema: TriageOutputSchema,
    maxTokens: MAX_TOKENS.triage,
    deadlineMs: DEADLINE_MS.triage,
    checkBanned: true,
    onScreenKeys: ["answer"], // "focus" is a writer brief, never on screen
    // "focus" is a brief for the writer (never on screen) and cardCount is a small int — clamp both instead of retrying.
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = { ...(parsed as Record<string, unknown>) };
      if (o.kind === "detour") {
        o.focus = softClamp(o.focus, 120);
        if (typeof o.cardCount === "number") o.cardCount = Math.min(6, Math.max(2, Math.round(o.cardCount)));
      }
      return o;
    },
    mock: () => mock.mockTriage(input),
  });
}

async function writeDetour(ctx: DetourContext): Promise<LlmResult<Card[]>> {
  const r = await generate<{ cards: Card[] }>({
    purpose: "detour",
    sessionId: ctx.sessionId,
    model: WRITE_MODEL(),
    // the detour borrows the writer's system prompt, so its logged version carries write's too
    promptVersion: loggedPromptVersion(DETOUR_PROMPT_VERSION, WRITE_PROMPT_VERSION),
    prompt: buildDetourPrompt(ctx),
    schema: cardsSchemaFor(ctx.allowedTypes),
    maxTokens: batchMaxTokens(ctx.cardCount),
    deadlineMs: DEADLINE_MS.batch,
    checkBanned: true,
    salvageWant: ctx.cardCount,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = parsed as Record<string, unknown>;
      return { ...o, cards: clampEyebrows(normalizeCards(o.cards, ctx.detourId)) };
    },
    mock: async () => {
      const m = await mock.mockWriteDetour(ctx);
      return m.ok ? { ok: true, value: { cards: m.value }, meta: m.meta } : m;
    },
  });
  return r.ok ? { ok: true, value: r.value.cards, meta: r.meta } : r;
}

/** Never fails: falls back to canned copy on any problem (budget, no key, bad output). */
async function dialToast(input: { sessionId: string; persona: Persona; direction: "simpler" | "deeper" }): Promise<string> {
  const canned = CANNED_TOASTS[input.direction];
  try {
    const r = await generate<{ toast: string }>({
      purpose: "chat",
      sessionId: input.sessionId,
      model: WRITE_MODEL(),
      promptVersion: loggedPromptVersion(DIAL_PROMPT_VERSION),
      prompt: buildDialPrompt(input),
      schema: DialToastSchema,
      maxTokens: MAX_TOKENS.toast,
      deadlineMs: DEADLINE_MS.toast,
      checkBanned: true,
      mock: async () => {
        const m = await mock.mockDialToast(input);
        return m.ok ? { ok: true, value: { toast: m.value }, meta: m.meta } : m;
      },
    });
    if (!r.ok) return canned;
    const toast = r.value.toast.trim();
    return toast && !findBannedInValue(toast) ? toast : canned;
  } catch {
    return canned;
  }
}

/**
 * Reply to a typed answer. Haiku, ~1s, cheap — the reader is watching a text box while
 * this runs, so it gets the tightest deadline of anything that isn't a toast. The reply
 * is validated against a schema that rejects grader-speak outright (see prompts/evaluate.ts),
 * which means "correct!" costs a retry instead of reaching the screen.
 */
async function evaluateOpen(input: EvaluateOpenInput): Promise<LlmResult<OpenEvaluation>> {
  return generate<OpenEvaluation>({
    purpose: "chat",
    sessionId: input.sessionId,
    model: WRITE_MODEL(),
    promptVersion: loggedPromptVersion(EVALUATE_PROMPT_VERSION),
    prompt: buildEvaluatePrompt(input),
    schema: OpenEvaluationSchema,
    maxTokens: MAX_TOKENS.evaluate,
    deadlineMs: DEADLINE_MS.evaluate,
    checkBanned: true,
    onScreenKeys: ["feedback"], // verdict is an enum; missed[] only ever feeds learner state
    // `missed` is an internal list for the learner state — clamp it rather than spend a retry.
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
      const o = { ...(parsed as Record<string, unknown>) };
      if (Array.isArray(o.missed)) o.missed = o.missed.slice(0, 4).map((m) => softClamp(m, 60));
      return o;
    },
    mock: () => mock.mockEvaluateOpen(input),
  });
}

/**
 * Refresh the session's through-line. Cheap and small: it runs between topics, never in
 * the path of a card. `updatedAtIdx` is the engine's bookkeeping, never the model's.
 */
async function updateStoryline(input: StorylineInput): Promise<LlmResult<Storyline>> {
  const r = await generate<StorylineOut>({
    purpose: "chat",
    sessionId: input.sessionId,
    model: WRITE_MODEL(),
    promptVersion: loggedPromptVersion(STORYLINE_PROMPT_VERSION),
    prompt: buildStorylinePrompt(input),
    schema: StorylineOutSchema,
    maxTokens: MAX_TOKENS.storyline,
    deadlineMs: DEADLINE_MS.storyline,
    checkBanned: true, // the spine + covered beats can surface in the feed's orientation strip
    // every field here is a soft brief; a 12-char overshoot must not cost a second call.
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
      const o = { ...(parsed as Record<string, unknown>) };
      o.spine = softClamp(o.spine, 280);
      o.next = softClamp(o.next, 120);
      if (Array.isArray(o.covered)) o.covered = o.covered.slice(-12).map((c) => softClamp(c, 80));
      return o;
    },
    mock: () => mock.mockUpdateStoryline(input),
  });
  return r.ok
    ? { ok: true, value: { ...r.value, updatedAtIdx: input.prev?.updatedAtIdx ?? null }, meta: r.meta }
    : r;
}

/** The ending, when the reader asks for it: the whole thread in a few beats, in the persona's voice. */
async function writeWrap(ctx: WrapContext): Promise<LlmResult<Card>> {
  const r = await generate<WrapOut>({
    purpose: "write",
    sessionId: ctx.sessionId,
    model: WRITE_MODEL(),
    promptVersion: loggedPromptVersion(WRAP_PROMPT_VERSION),
    prompt: buildWrapPrompt(ctx),
    schema: WrapOutSchema,
    maxTokens: batchMaxTokens(1),
    deadlineMs: DEADLINE_MS.wrap,
    checkBanned: true,
    // the wrap card is never on a topic node and never inside a detour — set both here so a
    // model that forgets them doesn't cost a retry on bookkeeping it can't know about.
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
      const o = { ...(parsed as Record<string, unknown>) };
      const raw = o.card;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
      const card: Record<string, unknown> = { ...(raw as Record<string, unknown>), type: "wrap" };
      if (typeof card.topicNodeId !== "string" || !card.topicNodeId) card.topicNodeId = SYSTEM_TOPIC_NODE;
      const [normalized] = clampEyebrows(normalizeCards([card], null)) as unknown[];
      return { ...o, card: normalized };
    },
    mock: async () => {
      const m = await mock.mockWriteWrap(ctx);
      return m.ok ? { ok: true, value: { card: m.value as WrapOut["card"] }, meta: m.meta } : m;
    },
  });
  return r.ok ? { ok: true, value: r.value.card as Card, meta: r.meta } : r;
}

export const llm: LlmApi = { plan, writeBatch, triage, writeDetour, dialToast, evaluateOpen, updateStoryline, writeWrap };
export { plan, writeBatch, triage, writeDetour, dialToast, evaluateOpen, updateStoryline, writeWrap };
