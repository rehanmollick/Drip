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
import { findBannedInValue } from "@/lib/copy/banned";
import { getStore } from "@/lib/db";
import type { Store } from "@/lib/db/store";
import type {
  DetourContext, LlmApi, LlmFailureCode, LlmMeta, LlmResult, PlanInput, TriageInput, WriteContext,
} from "@/lib/llm-types";
import { CardBatchSchema, type Card } from "@/lib/schemas/cards";
import { PlanOutputSchema, TriageOutputSchema, type Persona, type PlanOutput, type TriageOutput } from "@/lib/schemas/plan";
import { LLM_PURPOSES } from "@/lib/schemas/session";
import * as mock from "./llm-mock";
import { PROMPT_VERSION as DETOUR_PROMPT_VERSION, buildDetourPrompt } from "./prompts/detour";
import { CANNED_TOASTS, DialToastSchema, PROMPT_VERSION as DIAL_PROMPT_VERSION, buildDialPrompt } from "./prompts/dial";
import { PROMPT_VERSION as PLAN_PROMPT_VERSION, buildPlanPrompt } from "./prompts/plan";
import type { Prompt } from "./prompts/shared";
import { PROMPT_VERSION as TRIAGE_PROMPT_VERSION, buildTriagePrompt } from "./prompts/triage";
import { PROMPT_VERSION as WRITE_PROMPT_VERSION, buildWritePrompt } from "./prompts/write";

type LlmPurpose = (typeof LLM_PURPOSES)[number];

// ── config ────────────────────────────────────────────────────────────────────

export const PLAN_MODEL = () => process.env.LLM_PLAN_MODEL ?? "claude-sonnet-4-6";
export const WRITE_MODEL = () => process.env.LLM_WRITE_MODEL ?? "claude-haiku-4-5";
export const isMockMode = () => process.env.LLM_MODE === "mock";
export const dailyCallCap = () => Number(process.env.LLM_DAILY_CALL_CAP ?? 500);

const MAX_TOKENS = { plan: 8_000, batch: 4_000, triage: 600, toast: 200 } as const;
const REQUEST_TIMEOUT_MS = 120_000;

// ── dependency injection (tests) ──────────────────────────────────────────────

type Deps = { store?: Store; now?: () => Date };
let deps: Deps = {};

/** Tests inject a fake store / clock. Production resolves the store lazily via lib/db. */
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

async function checkCap(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const cap = dailyCallCap();
  if (!Number.isFinite(cap)) return { ok: false, error: "cap unreadable" };
  let count: number;
  try {
    count = await (await resolveStore()).countLlmCallsSince(startOfTodayUtc());
  } catch {
    return { ok: false, error: "cap unreadable" };
  }
  if (!Number.isFinite(count)) return { ok: false, error: "cap unreadable" };
  if (count >= cap) return { ok: false, error: `daily cap reached (${count}/${cap})` };
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
      error: entry.error ? entry.error.slice(0, 500) : null,
      createdAt: now().toISOString(),
    });
  } catch (e) {
    console.error("[llm] failed to log call", e);
  }
}

// ── json extraction + validation ──────────────────────────────────────────────

/** Strip code fences and return the first balanced {...} object in the text, or null. */
export function extractJsonObject(text: string): string | null {
  const t = text.replace(/```(?:json)?/gi, "").trim();
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

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function validate<T>(schema: z.ZodType<T>, parsed: unknown, checkBanned: boolean): Validation<T> {
  const r = schema.safeParse(parsed);
  if (!r.success) return { ok: false, error: `schema validation failed:\n${formatIssues(r.error)}` };
  if (checkBanned) {
    const b = findBannedInValue(r.data);
    if (b) return { ok: false, error: `banned school vocabulary on screen: "${b.word}" at ${b.path}. rewrite that string without it.` };
  }
  return { ok: true, value: r.data };
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

type CallOutcome =
  | { kind: "text"; text: string; inTokens: number; outTokens: number; latencyMs: number; truncated: boolean }
  | { kind: "refusal"; inTokens: number; outTokens: number; latencyMs: number }
  | { kind: "error"; error: string; latencyMs: number };

async function callAnthropic(opts: { apiKey: string; model: string; system: string; user: string; maxTokens: number; plan: boolean }): Promise<CallOutcome> {
  const started = Date.now();
  try {
    const res = await getClient(opts.apiKey).messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
      // planning only (Sonnet): let the model think about theme + outline; Haiku gets no thinking param.
      ...(opts.plan ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } } : {}),
    });
    const latencyMs = Date.now() - started;
    const inTokens = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    const outTokens = res.usage.output_tokens;
    if (res.stop_reason === "refusal") return { kind: "refusal", inTokens, outTokens, latencyMs };
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    return { kind: "text", text, inTokens, outTokens, latencyMs, truncated: res.stop_reason === "max_tokens" };
  } catch (e) {
    const latencyMs = Date.now() - started;
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
  promptVersion: string;
  prompt: Prompt;
  schema: z.ZodType<T>;
  maxTokens: number;
  plan?: boolean;
  /** Applied to the parsed JSON before validation (only id/detourId fix-ups). */
  normalize?: (parsed: unknown) => unknown;
  /** Reject on-screen school vocabulary (retries once, then accepts — a slightly-off word beats a dead feed). */
  checkBanned?: boolean;
  mock: () => Promise<LlmResult<T>>;
};

async function generate<T>(o: GenerateOpts<T>): Promise<LlmResult<T>> {
  const baseMeta = { model: o.model, promptVersion: o.promptVersion };

  // 1. spend cap — fails closed.
  const cap = await checkCap();
  if (!cap.ok) {
    await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: 0, ok: false, error: `budget: ${cap.error}` });
    return { ok: false, code: "budget", error: cap.error, meta: baseMeta };
  }

  // 2. mock mode — same pipeline, canned model.
  if (isMockMode()) {
    const started = Date.now();
    const r = await o.mock();
    const latencyMs = Date.now() - started;
    if (r.ok) {
      const normalized = o.normalize ? o.normalize(r.value) : r.value;
      const v = validate(o.schema, normalized, false);
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

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      // re-check the cap for the paid retry (still fails closed).
      const again = await checkCap();
      if (!again.ok) {
        await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: 0, outTokens: 0, latencyMs: 0, ok: false, error: `budget: ${again.error}` });
        return { ok: false, code: "budget", error: again.error, raw: lastRaw, meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: 1 } };
      }
    }
    const out = await callAnthropic({ apiKey, model: o.model, system: o.prompt.system, user, maxTokens: o.maxTokens, plan: !!o.plan });
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
        const v = validate(o.schema, normalized, false);
        if (v.ok) {
          const banned = o.checkBanned ? findBannedInValue(v.value) : null;
          if (banned && attempt === 1) {
            problem = `banned school vocabulary on screen: "${banned.word}" at ${banned.path}. rewrite that string without it.`;
          } else {
            if (banned) console.warn(`[llm] ${o.purpose}: banned word "${banned.word}" survived the retry at ${banned.path}; accepting.`);
            value = v.value;
          }
        } else {
          problem = v.error;
        }
      }
    }

    await log({ sessionId: o.sessionId, purpose: o.purpose, model: o.model, promptVersion: o.promptVersion, inTokens: out.inTokens, outTokens: out.outTokens, latencyMs: out.latencyMs, ok: value !== undefined, error: value !== undefined ? null : `validation: ${problem}` });

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

  return { ok: false, code: lastCode, error: lastError, raw: lastRaw, meta: { ...baseMeta, inTokens: totalIn, outTokens: totalOut, latencyMs: totalLatency, attempts: 2 } };
}

// ── public api ────────────────────────────────────────────────────────────────

const CardsOut = z.object({ cards: CardBatchSchema.shape.cards });

async function plan(input: PlanInput): Promise<LlmResult<PlanOutput>> {
  const r = await generate<PlanOutput>({
    purpose: input.previousPlan ? "replan" : "plan",
    sessionId: input.sessionId,
    model: PLAN_MODEL(),
    promptVersion: PLAN_PROMPT_VERSION,
    prompt: buildPlanPrompt(input),
    schema: PlanOutputSchema,
    maxTokens: MAX_TOKENS.plan,
    plan: true,
    checkBanned: true,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = parsed as Record<string, unknown>;
      return { ...o, firstCards: normalizeCards(o.firstCards, null) };
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
    promptVersion: WRITE_PROMPT_VERSION,
    prompt: buildWritePrompt(ctx),
    schema: CardsOut,
    maxTokens: MAX_TOKENS.batch,
    checkBanned: true,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = parsed as Record<string, unknown>;
      return { ...o, cards: normalizeCards(o.cards, ctx.detourId) };
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
    promptVersion: TRIAGE_PROMPT_VERSION,
    prompt: buildTriagePrompt(input),
    schema: TriageOutputSchema,
    maxTokens: MAX_TOKENS.triage,
    checkBanned: true,
    mock: () => mock.mockTriage(input),
  });
}

async function writeDetour(ctx: DetourContext): Promise<LlmResult<Card[]>> {
  const r = await generate<{ cards: Card[] }>({
    purpose: "detour",
    sessionId: ctx.sessionId,
    model: WRITE_MODEL(),
    promptVersion: DETOUR_PROMPT_VERSION,
    prompt: buildDetourPrompt(ctx),
    schema: CardsOut,
    maxTokens: MAX_TOKENS.batch,
    checkBanned: true,
    normalize: (parsed) => {
      if (!parsed || typeof parsed !== "object") return parsed;
      const o = parsed as Record<string, unknown>;
      return { ...o, cards: normalizeCards(o.cards, ctx.detourId) };
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
      promptVersion: DIAL_PROMPT_VERSION,
      prompt: buildDialPrompt(input),
      schema: DialToastSchema,
      maxTokens: MAX_TOKENS.toast,
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

export const llm: LlmApi = { plan, writeBatch, triage, writeDetour, dialToast };
export { plan, writeBatch, triage, writeDetour, dialToast };
