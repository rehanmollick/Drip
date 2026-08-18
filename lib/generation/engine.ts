import { CARD_SCHEMA_VERSION, CHILL_EXCLUDED_TYPES, WRITER_CARD_TYPES, type Card, type CardType, type ClarifyCard } from "@/lib/schemas/cards";
import { ProgressSchema, type Batch, type CardRow, type Detour, type Interaction, type Session } from "@/lib/schemas/session";
import { SessionSettingsSchema, defaultLearnerState, type LearnerState } from "@/lib/schemas/learner";
import type { OutlineNode, Persona, PlanOutput } from "@/lib/schemas/plan";
import type { CreateSessionBody, GenerateData, AskData, InteractBody, DialData } from "@/lib/api/contract";
import type { DetourContext, LlmApi, LlmResult, WriteContext, WriteMode } from "@/lib/llm-types";
import { llm as realLlm } from "@/lib/llm";
import { getStore } from "@/lib/db";
import type { Store } from "@/lib/db/store";
import { HttpError } from "@/lib/api/envelope";
import { nowIso, uuid } from "@/lib/id";
import { highlightCards } from "@/lib/highlight";
import {
  addReinforce, applyDial, applyInteraction, clearRecap, clearScaffold, learnerStateHash, missedConcepts, withPrefs,
} from "@/lib/adapt/learner";
import { sliceFor } from "./corpus";
import { recentSummaries, usedMetaphors } from "./summaries";
import { budgetNotice, fallbackCard, isBudgetNotice, isFallback, SYSTEM_NODE } from "./system-cards";
import { buildDetourRows, keyBetween, keysBetween } from "@/lib/detour/splice";

/**
 * The generation engine (spec §6, §7, §8, §12).
 *
 *   createSession → startPlanning (teasers ∥ plan → clarifier cards + first cards)
 *   generateNext  → idempotent frontier-keyed batches (epoch + last idx + learner
 *                   hash), scaffold prepend, infinite continuation, budget notice /
 *                   fallback as data; a batch whose epoch moved while the model
 *                   was writing is dropped as "superseded" — never inserted
 *   interact      → card row + learner-state reduction under the session lock,
 *                   auto recap insertion (the ONLY consumer of recapDue)
 *   dial          → level ±1, drop unviewed runway, bump epoch (regeneration is lazy)
 *   ask           → triage → inline | detour splice (nesting-safe)
 *   answerClarifiers / replan (single-flight, pendingReplan), retry, remix, watchdog
 *
 * Runway invalidation (dial / re-plan / chill toggle / retry-drop-fallback) always
 * happens under the per-session lock and bumps `progress.epoch`; the epoch is part
 * of every frontier key, so a batch claimed or finished under an old epoch is
 * never handed back once its cards are gone.
 *
 * Only `lib/llm.ts` talks to the model; the engine calls it through the LlmApi
 * interface, injectable via setEngineDepsForTests. Nothing here throws across
 * the feed boundary except HttpError for bad requests (404 etc).
 */

// ── constants ───────────────────────────────────────────────────────────────
export const BATCH_SIZE = 4;
export const TEASER_THRESHOLD_CHARS = 4000;
export const PLANNING_TIMEOUT_MS = 90_000;
export const BATCH_WAIT_MS = 25_000;
export const STALE_BATCH_MS = 90_000;
/** Owner heartbeat on `batches.updatedAt` while the model writes — a slow-but-alive owner is never stolen. */
export const BATCH_HEARTBEAT_MS = 20_000;
export const MAX_UNVIEWED_RUNWAY = 16;
/** How long dial() waits for the persona toast before answering with the canned line (the runway drop must not wait). */
export const DIAL_TOAST_WAIT_MS = 2_500;
const POLL_MS = 400;
const CORPUS_SLICE_CHARS = 6000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PLACEHOLDER_PERSONA: Persona = {
  traits: ["curious", "quick", "warm"],
  tics: ["ok so", "here's the thing"],
  humor: "dry, light, never mean",
  neverDoes: "talks down to you",
};

const COPY = {
  askUnavailable: "hmm, my brain's buffering. ask me again in a sec.",
  askBudget: "we hit today's budget, so i can't think out loud right now. resets at midnight.",
  detourUnavailable: "couldn't spin up that detour right now. keep scrolling — ask again in a bit.",
  planningTimeout: "planning took too long",
  toastSimpler: "say less. rewinding the jargon.",
  toastDeeper: "bet. going a layer deeper.",
};

// ── deps (injectable) ───────────────────────────────────────────────────────
export type EngineDeps = { llm: LlmApi; store: Store };
let testDeps: Partial<EngineDeps> | null = null;
/** Tests inject a fake LlmApi and/or a temp-dir store. Pass null to reset. */
export function setEngineDepsForTests(d: Partial<EngineDeps> | null): void {
  testDeps = d;
}
async function deps(): Promise<EngineDeps> {
  return { llm: testDeps?.llm ?? realLlm, store: testDeps?.store ?? (await getStore()) };
}

// ── per-session mutex (in-process, NOT re-entrant) ──────────────────────────
const locks = new Map<string, Promise<unknown>>();
async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sessionId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(sessionId, run.catch(() => undefined));
  try {
    return await run;
  } finally {
    if (locks.get(sessionId) === run) locks.delete(sessionId);
  }
}

/** Read-modify-write a session under the lock; `fn` returns the patch (null = no write). */
async function updateSessionLocked(store: Store, id: string, fn: (fresh: Session) => Partial<Session> | null): Promise<Session> {
  return withSessionLock(id, async () => {
    const fresh = await store.getSession(id);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    const patch = fn(fresh);
    return patch ? store.updateSession(id, patch) : fresh;
  });
}

/** Single-flight per session for long background jobs (planning, re-plan): a double tap joins the live run. */
const singleFlights = new Map<string, Promise<unknown>>();
function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const live = singleFlights.get(key) as Promise<T> | undefined;
  if (live) return live;
  const p = fn().finally(() => {
    if (singleFlights.get(key) === p) singleFlights.delete(key);
  });
  singleFlights.set(key, p);
  return p;
}

// ── small helpers ───────────────────────────────────────────────────────────
export function autoTitle(text: string): string {
  const first = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first || "untitled";
}

const sameUtcDay = (aIso: string, bIso: string) => aIso.slice(0, 10) === bIso.slice(0, 10);
const isUuid = (s: string) => UUID_RE.test(s);

function row(sessionId: string, idx: string, payload: Card, batchId: string | null, createdAt = nowIso()): CardRow {
  return { id: payload.id, sessionId, idx, type: payload.type, payload, detourId: payload.detourId, batchId, viewedAt: null, interaction: null, createdAt };
}

/** Fresh server-side ids + thread fields; the model's ids are never trusted. */
function adopt(cards: Card[], topicNodeId: string, detourId: string | null): Card[] {
  return cards.map((c) => ({ ...c, id: uuid(), topicNodeId, detourId }));
}

/** Chill mode is enforced after validation, not just in the prompt: no bet/predict/sequence/slider ever reaches the feed. */
export function enforceChill(cards: Card[], settings: Pick<Session["settings"], "chillMode">): Card[] {
  if (!settings.chillMode) return cards;
  return cards.filter((c) => !(CHILL_EXCLUDED_TYPES as readonly string[]).includes(c.type));
}

function themeSlice(session: Session): WriteContext["theme"] {
  return session.theme
    ? { name: session.theme.name, mood: session.theme.mood, signature: session.theme.signature }
    : { name: "drip", mood: "quiet, focused, a little playful", signature: "accent underline sweeps in under headlines" };
}

function allowedTypes(session: Session): readonly CardType[] {
  return session.settings.chillMode
    ? WRITER_CARD_TYPES.filter((t) => !(CHILL_EXCLUDED_TYPES as readonly string[]).includes(t))
    : WRITER_CARD_TYPES;
}

function currentNode(session: Session): OutlineNode | null {
  if (session.progress.exhausted) return null;
  return session.outline[session.progress.nodeIdx] ?? null;
}

/** Human-readable directives for the writer, derived from learner state. */
export function directiveLines(state: LearnerState): string[] {
  const out: string[] = [];
  const d = state.directives;
  if (d.difficultyDelta > 0) out.push(`difficulty +${d.difficultyDelta}: raise the bar — plausible-wrong options, "which one is the lie" bets, curveballs`);
  if (d.difficultyDelta < 0) out.push(`difficulty ${d.difficultyDelta}: lower the bar — concrete before abstract, one idea per card`);
  if (d.pace === "compress") out.push("pace: compress — bigger claims, fewer cards per idea, no throat-clearing");
  if (d.reinforce.length) out.push(`reinforce (asked about in detours): ${d.reinforce.join(", ")}`);
  if (state.prefs.simplerTaps > state.prefs.deeperTaps) out.push("the learner tapped 'simpler' — plain words, everyday metaphors");
  if (state.prefs.deeperTaps > state.prefs.simplerTaps) out.push("the learner tapped 'deeper' — mechanisms, edge cases, the why under the what");
  return out;
}

function baseContext(session: Session, all: CardRow[], node: OutlineNode | null): Omit<WriteContext, "mode" | "batchSize"> {
  const nodeIdx = node ? session.outline.findIndex((n) => n.id === node.id) : session.progress.nodeIdx;
  const payloads = all.map((r) => r.payload);
  return {
    sessionId: session.id,
    persona: session.persona ?? PLACEHOLDER_PERSONA,
    theme: themeSlice(session),
    node,
    corpusSlice: sliceFor(session.sourceText, node, CORPUS_SLICE_CHARS, { nodeIdx: Math.max(0, nodeIdx), nodeCount: session.outline.length }),
    sourceKind: session.sourceKind,
    learnerState: session.learnerState,
    settings: session.settings,
    recent: recentSummaries(payloads, 6),
    usedMetaphors: usedMetaphors(payloads),
    allowedTypes: allowedTypes(session),
    detourId: null,
    extraDirectives: directiveLines(session.learnerState),
  };
}

function failureMessage(r: Extract<LlmResult<unknown>, { ok: false }>): string {
  return `${r.code}: ${r.error}`.slice(0, 200);
}

async function cardsOfBatch(store: Store, batch: Batch): Promise<CardRow[]> {
  if (batch.cardIds.length === 0) return [];
  const ids = new Set(batch.cardIds);
  return (await store.listAllCards(batch.sessionId)).filter((c) => ids.has(c.id));
}

/**
 * Append cards after the last row (and never at/below `floorIdx` — keys a client
 * may still hold for rows we just deleted are never reused). Two attempts: a
 * concurrent splice at the very end (ask detour) can steal our keys.
 */
async function insertAfter(store: Store, sessionId: string, floorIdx: string | null, cards: Card[], batchId: string | null): Promise<CardRow[]> {
  if (cards.length === 0) return [];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await store.lastCard(sessionId);
    const after = [last?.idx ?? null, floorIdx].filter((x): x is string => x !== null).sort().at(-1) ?? null;
    const keys = keysBetween(after, null, cards.length);
    const rows = cards.map((c, i) => row(sessionId, keys[i], c, batchId));
    try {
      return await store.insertCards(rows);
    } catch (e) {
      lastErr = e;
      if (!/duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("insert failed");
}
const insertAfterLast = (store: Store, sessionId: string, cards: Card[], batchId: string | null) => insertAfter(store, sessionId, null, cards, batchId);

/** idx of the furthest viewed row (the user's frontier), or null when nothing was viewed. */
function lastViewedIdx(cards: CardRow[]): string | null {
  let m: string | null = null;
  for (const c of cards) if (c.viewedAt && (m === null || c.idx > m)) m = c.idx;
  return m;
}

/** Recompute the frontier after cards were dropped (dial / replan / chill / retry). Recaps don't count toward a node. */
export function recomputeProgress(session: Session, cards: CardRow[]): Session["progress"] {
  const outlineIds = new Set(session.outline.map((n) => n.id));
  const main = cards.filter((c) => !c.detourId && c.type !== "recap" && outlineIds.has(c.payload.topicNodeId));
  const lastMain = main[main.length - 1];
  let nodeIdx = 0;
  let cardsInNode = 0;
  if (lastMain) {
    nodeIdx = Math.max(0, session.outline.findIndex((n) => n.id === lastMain.payload.topicNodeId));
    cardsInNode = main.filter((c) => c.payload.topicNodeId === lastMain.payload.topicNodeId).length;
    const est = session.outline[nodeIdx]?.estCards ?? BATCH_SIZE;
    if (cardsInNode >= est) {
      nodeIdx += 1;
      cardsInNode = 0;
    }
  }
  return {
    ...session.progress,
    nodeIdx,
    cardsInNode,
    exhausted: session.outline.length > 0 && nodeIdx >= session.outline.length,
    totalGenerated: cards.length,
    lastIdx: cards[cards.length - 1]?.idx ?? null,
  };
}

/**
 * Drop the unviewed runway after `after` (every thread — clients mirror this exactly)
 * and bump the epoch so any batch still being written for the old runway is
 * discarded when it lands. MUST run under the session lock.
 */
async function dropRunwayLocked(store: Store, fresh: Session, after: string | null, extra: Partial<Session> = {}): Promise<Session> {
  await store.deleteUnviewedAfter(fresh.id, after);
  const remaining = await store.listAllCards(fresh.id);
  return store.updateSession(fresh.id, {
    ...extra,
    progress: { ...recomputeProgress(fresh, remaining), epoch: fresh.progress.epoch + 1 },
  });
}

// ── planning ────────────────────────────────────────────────────────────────
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleWatchdog(sessionId: string): void {
  const prev = watchdogs.get(sessionId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    watchdogs.delete(sessionId);
    reapIfStuck(sessionId).catch(() => undefined);
  }, PLANNING_TIMEOUT_MS + 500);
  t.unref?.();
  watchdogs.set(sessionId, t);
}

/** Watchdog (spec §12.10): planning > 90s → retryable error. Returns the (possibly updated) session. */
export async function reapIfStuck(sessionOrId: string | Session, now = Date.now()): Promise<Session | null> {
  const { store } = await deps();
  const session = typeof sessionOrId === "string" ? await store.getSession(sessionOrId) : sessionOrId;
  if (!session || session.status !== "planning") return session;
  const started = typeof session.sourceMeta.planningStartedAt === "string" ? Date.parse(session.sourceMeta.planningStartedAt) : Date.parse(session.createdAt);
  if (!Number.isFinite(started) || now - started <= PLANNING_TIMEOUT_MS) return session;
  return store.updateSession(session.id, { status: "error", error: COPY.planningTimeout });
}

export async function createSession(body: CreateSessionBody): Promise<Session> {
  const { store } = await deps();
  const settings = SessionSettingsSchema.parse(body.settings ?? {});
  const now = nowIso();
  const session: Session = {
    id: uuid(),
    title: body.title?.trim() || autoTitle(body.input),
    sourceKind: body.sourceKind,
    sourceMeta: { ...body.sourceMeta, planningStartedAt: now },
    sourceText: body.input,
    theme: null,
    persona: null,
    outline: [],
    settings,
    learnerState: defaultLearnerState(settings),
    progress: ProgressSchema.parse({}),
    clarifierAnswers: {},
    storyline: null,
    status: "planning",
    error: null,
    position: 0,
    createdAt: now,
    lastOpenedAt: now,
  };
  return store.createSession(session);
}

/**
 * Plan a session: (big corpus) teaser cards written CONCURRENTLY with the plan
 * so the feed has something within seconds → planner → clarifier cards + first
 * cards → status active. Each run carries a token (sourceMeta.planRunId); a run
 * that was superseded by a retry never applies. Safe to call from `after()` or
 * synchronously in tests; a double tap joins the live run. Never throws.
 */
export function startPlanning(sessionId: string): Promise<Session | null> {
  return singleFlight(`plan:${sessionId}`, () => startPlanningInner(sessionId));
}

async function startPlanningInner(sessionId: string): Promise<Session | null> {
  const { llm, store } = await deps();
  const existing = await store.getSession(sessionId);
  if (!existing) return null;
  const token = uuid();
  const session = await store.updateSession(sessionId, {
    status: "planning",
    error: null,
    sourceMeta: { ...existing.sourceMeta, planningStartedAt: nowIso(), planRunId: token },
  });
  scheduleWatchdog(sessionId);
  /** Only the run that still owns the session (same token) may write its outcome. */
  const finish = (fn: (fresh: Session) => Partial<Session> | null) =>
    updateSessionLocked(store, sessionId, (fresh) => (fresh.sourceMeta.planRunId === token ? fn(fresh) : null));
  try {
    const cards = await store.listAllCards(sessionId);
    const teaser =
      session.sourceText.length > TEASER_THRESHOLD_CHARS && cards.length === 0
        ? llm
            .writeBatch({
              ...baseContext(session, [], null),
              mode: "teaser",
              batchSize: 2,
              corpusSlice: session.sourceText.slice(0, 2000),
              extraDirectives: ["planning is still running: two quick cards that tease what's coming, in a warm neutral voice"],
            })
            .then(async (r) => {
              if (!r.ok || r.value.length === 0) return;
              const adopted = await highlightCards(adopt(enforceChill(r.value.slice(0, 2), session.settings), "teaser", null));
              await withSessionLock(sessionId, async () => {
                const fresh = await store.getSession(sessionId);
                // the plan already landed (or a retry took over) → teasers would sit behind real cards: drop them
                if (!fresh || fresh.status !== "planning" || fresh.sourceMeta.planRunId !== token) return;
                const rows = await insertAfterLast(store, sessionId, adopted, null);
                await store.updateSession(sessionId, {
                  progress: { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + rows.length, lastIdx: rows[rows.length - 1].idx },
                });
              });
            })
            .catch((e: unknown) => console.warn("[engine] teaser failed", sessionId, e instanceof Error ? e.message : e))
        : Promise.resolve();
    const [, plan] = await Promise.all([
      teaser,
      llm.plan({
        sessionId,
        sourceKind: session.sourceKind,
        sourceText: session.sourceText,
        sourceMeta: session.sourceMeta,
        settings: session.settings,
        clarifierAnswers: Object.keys(session.clarifierAnswers).length ? session.clarifierAnswers : undefined,
      }),
    ]);
    if (!plan.ok) {
      return await finish(() => ({ status: "error", error: failureMessage(plan) }));
    }
    return await applyPlan(store, session, plan.value, { replan: false, token });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[engine] planning failed", sessionId, message);
    return finish(() => ({ status: "error", error: message.slice(0, 200) })).catch(() => null);
  } finally {
    const t = watchdogs.get(sessionId);
    if (t) clearTimeout(t);
    watchdogs.delete(sessionId);
  }
}

/**
 * Apply a plan under the session lock. First plan: clarifier cards + first cards
 * appended (only if this run still owns the session). Re-plan: the unviewed
 * runway is dropped, the new first cards land AFTER every key that ever existed
 * (clients may still hold the old rows), epoch bumps, pendingReplan clears.
 */
async function applyPlan(store: Store, session: Session, plan: PlanOutput, opts: { replan: boolean; token?: string }): Promise<Session> {
  const firstNode = plan.outline[0];
  const payloads: Card[] = [];
  if (!opts.replan) {
    for (const c of plan.clarifiers.slice(0, 3)) {
      const card: ClarifyCard = { id: uuid(), type: "clarify", topicNodeId: "clarify", detourId: null, eyebrow: "quick one", key: c.key, prompt: c.prompt, options: c.options };
      payloads.push(card);
    }
  }
  const first = await highlightCards(adopt(enforceChill(plan.firstCards, session.settings), firstNode?.id ?? SYSTEM_NODE, null));
  payloads.push(...first);
  return withSessionLock(session.id, async () => {
    const fresh = await store.getSession(session.id);
    if (!fresh) return session;
    if (!opts.replan && fresh.sourceMeta.planRunId !== opts.token) return fresh; // a retry superseded this run
    const floor = (await store.lastCard(session.id))?.idx ?? null;
    if (opts.replan) await store.deleteUnviewedAfter(session.id, null);
    const rows = await insertAfter(store, session.id, floor, payloads, null);
    const all = await store.listAllCards(session.id);
    const { planningStartedAt: _a, planRunId: _b, replanStartedAt: _c, ...sourceMeta } = fresh.sourceMeta as Record<string, unknown> & {
      planningStartedAt?: unknown; planRunId?: unknown; replanStartedAt?: unknown;
    };
    void _a; void _b; void _c;
    const titleIsAuto = fresh.title === autoTitle(fresh.sourceText) || fresh.title === "untitled";
    return store.updateSession(session.id, {
      title: titleIsAuto ? plan.title : fresh.title,
      theme: opts.replan && fresh.theme ? fresh.theme : plan.theme,
      persona: plan.persona,
      outline: plan.outline,
      status: "active",
      error: null,
      sourceMeta: opts.replan ? { ...sourceMeta, replannedAt: nowIso() } : sourceMeta,
      progress: {
        ...fresh.progress,
        nodeIdx: 0,
        cardsInNode: first.length,
        exhausted: false,
        extensions: 0,
        totalGenerated: all.length,
        lastIdx: rows[rows.length - 1]?.idx ?? fresh.progress.lastIdx,
        epoch: fresh.progress.epoch + (opts.replan ? 1 : 0),
        pendingReplan: false,
      },
    });
  });
}

// ── generation ──────────────────────────────────────────────────────────────
type PseudoBatch = GenerateData["batch"];
const pseudo = (id: string, status: PseudoBatch["status"], frontierKey: string, reason?: string): PseudoBatch => ({ id, status, frontierKey, ...(reason ? { reason } : {}) });
/** Batch → wire shape; a done/failed batch handed back without cards says why (superseded batches carry that error). */
function toWire(b: Batch, cards: CardRow[]): PseudoBatch {
  const reason = cards.length === 0 && b.error === "superseded" ? "superseded" : undefined;
  return { id: b.id, status: b.status, frontierKey: b.frontierKey, ...(reason ? { reason } : {}) };
}

/** Frontier key: schema version + session + runway epoch + last idx + learner-state hash. */
export function frontierKeyFor(session: Session, lastIdx: string | null): string {
  return `cardbatch:v${CARD_SCHEMA_VERSION}:${session.id}:e${session.progress.epoch}:${lastIdx ?? "start"}:${learnerStateHash(session.learnerState)}`;
}

/** True while a re-plan is running (and not stale — a crashed run must not block generation forever). */
export function replanPending(session: Session, now = Date.now()): boolean {
  if (!session.progress.pendingReplan) return false;
  const started = typeof session.sourceMeta.replanStartedAt === "string" ? Date.parse(session.sourceMeta.replanStartedAt) : NaN;
  return !Number.isFinite(started) || now - started <= PLANNING_TIMEOUT_MS;
}

async function waitForBatch(store: Store, sessionId: string, frontierKey: string, timeoutMs: number): Promise<Batch | null> {
  const deadline = Date.now() + timeoutMs;
  let b = await store.getBatch(sessionId, frontierKey);
  while (b && b.status === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    b = await store.getBatch(sessionId, frontierKey);
  }
  return b;
}

async function settledResult(store: Store, sessionId: string, frontierKey: string, fallback: Batch, waitMs: number): Promise<GenerateData> {
  const settled = await waitForBatch(store, sessionId, frontierKey, waitMs);
  if (!settled) return { batch: toWire(fallback, []), cards: [] };
  const cards = settled.status === "done" ? await cardsOfBatch(store, settled) : [];
  return { batch: toWire(settled, cards), cards };
}

/**
 * Next batch for the frontier. Idempotent: the same frontier (epoch + last card +
 * learner state) maps to one batch; concurrent callers wait for the owner. If the
 * epoch moves while the model writes (dial / re-plan / chill toggle), the batch is
 * marked failed "superseded" and its cards are never inserted.
 */
export async function generateNext(sessionId: string, opts: { waitMs?: number } = {}): Promise<GenerateData> {
  const { llm, store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  if (session.status === "planning") return { batch: pseudo("planning", "pending", `planning:${sessionId}`), cards: [] };
  if (session.status === "error") return { batch: pseudo("error", "failed", `error:${sessionId}`), cards: [] };
  if (replanPending(session)) return { batch: pseudo("pending_plan", "done", `pending_plan:${sessionId}`, "pending_plan"), cards: [] };

  const all = await store.listAllCards(sessionId);
  const last = all[all.length - 1] ?? null;
  const now = nowIso();

  // Guards: don't stack budget notices or fallbacks; don't run past a sane runway.
  if (last && isBudgetNotice(last.payload) && sameUtcDay(last.createdAt, now)) {
    return { batch: pseudo("budget", "done", `budget:${sessionId}`, "budget"), cards: [last] };
  }
  if (last && isFallback(last.payload) && !last.viewedAt) {
    return { batch: pseudo("fallback", "failed", last.payload.retryKey ?? `fallback:${sessionId}`), cards: [last] };
  }
  // runway = unviewed rows past the user's frontier (skipped / lost-view rows behind them don't count)
  const seenUpTo = lastViewedIdx(all);
  const unviewed = all.filter((c) => !c.viewedAt && (seenUpTo === null || c.idx > seenUpTo)).length;
  if (unviewed >= MAX_UNVIEWED_RUNWAY) {
    return { batch: pseudo("runway_full", "done", `runway:${sessionId}:${last?.idx ?? "start"}`, "runway_full"), cards: [] };
  }

  const frontierKey = frontierKeyFor(session, last?.idx ?? null);
  const waitMs = opts.waitMs ?? BATCH_WAIT_MS;
  const claim = await store.claimBatch({ id: uuid(), sessionId, frontierKey, status: "pending", cardIds: [], error: null, createdAt: now, updatedAt: now });
  let batch = claim.batch;
  if (!claim.created) {
    if (batch.status === "done") {
      const cards = await cardsOfBatch(store, batch);
      if (cards.length > 0 || batch.cardIds.length === 0) return { batch: toWire(batch, cards), cards };
      // its cards are gone (runway dropped by an older build without an epoch bump): never hand back an empty done batch
      batch = await store.updateBatch(batch.id, { status: "failed", error: "cards gone", updatedAt: nowIso() });
    }
    const stale = batch.status === "pending" && Date.now() - Date.parse(batch.updatedAt) > STALE_BATCH_MS;
    if (batch.status === "pending" && !stale) return settledResult(store, sessionId, frontierKey, batch, waitMs);
    // failed (explicit retry) or stale pending (owner died): take it over — atomically, so two concurrent retries
    // (fallback tap + client retry, two tabs) can never both generate this frontier.
    const taken = await store.takeoverBatch(batch.id, { ifUpdatedBefore: new Date(Date.now() - STALE_BATCH_MS).toISOString() });
    if (!taken) return settledResult(store, sessionId, frontierKey, batch, waitMs);
    batch = taken;
  }

  // ── we own the batch ──
  const heartbeat = setInterval(() => {
    store.updateBatch(batch.id, { updatedAt: nowIso() }).catch(() => undefined);
  }, BATCH_HEARTBEAT_MS);
  heartbeat.unref?.();
  const superseded = async (): Promise<GenerateData> => {
    await store.updateBatch(batch.id, { status: "failed", cardIds: [], error: "superseded", updatedAt: nowIso() }).catch(() => undefined);
    return { batch: { id: batch.id, status: "failed", frontierKey, reason: "superseded" }, cards: [] };
  };
  try {
    const built = await buildBatch(llm, session, all);
    const status: Batch["status"] = built.outcome === "failed" ? "failed" : "done";
    // insert under the lock, only if the runway we were writing for still exists
    const rows = await withSessionLock(sessionId, async () => {
      const fresh = await store.getSession(sessionId);
      if (!fresh || fresh.progress.epoch !== session.progress.epoch) return null;
      const inserted = await insertAfter(store, sessionId, null, built.cards, batch.id);
      await store.updateBatch(batch.id, { status, cardIds: inserted.map((r) => r.id), error: built.error ?? null, updatedAt: nowIso() });
      let state = fresh.learnerState;
      if (built.consumedScaffold) state = clearScaffold(state);
      const p = { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + inserted.length, lastIdx: inserted[inserted.length - 1]?.idx ?? fresh.progress.lastIdx };
      if (built.outcome === "ok" && built.node) {
        p.cardsInNode += built.mainCount;
        const est = built.node.estCards;
        if (p.cardsInNode >= est) {
          p.nodeIdx += 1;
          p.cardsInNode = 0;
        }
        if (p.nodeIdx >= fresh.outline.length) p.exhausted = true;
      } else if (built.outcome === "ok" && !built.node) {
        p.exhausted = true;
        p.extensions += 1;
      }
      await store.updateSession(sessionId, { learnerState: state, progress: p });
      return inserted;
    });
    if (rows === null) return await superseded();
    return { batch: { id: batch.id, status, frontierKey }, cards: rows };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    console.error("[engine] generate failed", sessionId, message);
    // failure as data: one fallback card, batch marked failed (unless the runway moved on without us)
    let rows: CardRow[] = [];
    try {
      rows = await withSessionLock(sessionId, async () => {
        const fresh = await store.getSession(sessionId);
        if (fresh && fresh.progress.epoch !== session.progress.epoch) return [];
        return insertAfterLast(store, sessionId, [fallbackCard(message, frontierKey)], batch.id);
      });
    } catch {
      /* the store itself is down; the route surfaces an enveloped error */
    }
    await store.updateBatch(batch.id, { status: "failed", cardIds: rows.map((r) => r.id), error: message, updatedAt: nowIso() }).catch(() => undefined);
    return { batch: { id: batch.id, status: "failed", frontierKey }, cards: rows };
  } finally {
    clearInterval(heartbeat);
  }
}

type Built = {
  cards: Card[];
  outcome: "ok" | "budget" | "failed";
  error?: string;
  node: OutlineNode | null;
  mainCount: number;
  consumedScaffold: boolean;
};

/** Compose one batch: optional scaffold re-angle + the main write. (Recaps are inserted by interact(), never here.) */
async function buildBatch(llm: LlmApi, session: Session, all: CardRow[]): Promise<Built> {
  const node = currentNode(session);
  const base = baseContext(session, all, node);
  const d = session.learnerState.directives;
  const cards: Card[] = [];
  const topic = node?.id ?? SYSTEM_NODE;
  const st: { outcome: Built["outcome"]; error?: string } = { outcome: "ok" };
  let consumedScaffold = false;

  const write = async (ctx: WriteContext): Promise<Card[] | null> => {
    const r = await llm.writeBatch(ctx);
    if (r.ok) return enforceChill(r.value, session.settings);
    if (r.code === "budget") st.outcome = "budget";
    else st.error = failureMessage(r);
    return null;
  };

  const scaffoldConcept = d.scaffoldNext[0];
  if (scaffoldConcept) {
    const r = await write({ ...base, mode: "scaffold", batchSize: 1, missedConcepts: d.scaffoldNext, extraDirectives: [...base.extraDirectives, `re-angle "${scaffoldConcept}" as one concept card before the next bet — new example, plainer words`] });
    if (r?.length) {
      cards.push(...adopt(r.slice(0, 1), topic, null));
      consumedScaffold = true;
    }
    if (st.outcome === "budget") return { cards: [...cards, budgetNotice()], outcome: "budget", node, mainCount: 0, consumedScaffold };
  }

  // main write
  let main: Card[] | null = null;
  let mainTopic = topic;
  const tieIn = consumedScaffold && scaffoldConcept ? [`a gentler re-angle of "${scaffoldConcept}" sits right before this batch — make this batch's bet re-test "${scaffoldConcept}" from a fresh angle`] : [];
  if (node) {
    const completes = session.progress.cardsInNode + BATCH_SIZE >= node.estCards;
    const extra = [...base.extraDirectives, ...tieIn];
    if (completes) extra.push("this batch completes the current idea — end it with a checkpoint card (flex copy, no scores)");
    main = await write({ ...base, mode: "normal", batchSize: BATCH_SIZE, extraDirectives: extra });
  } else {
    const misses = missedConcepts(session.learnerState, 4);
    const useResurface = misses.length > 0 && session.progress.extensions % 2 === 0;
    const mode: WriteMode = useResurface ? "resurface" : "adjacent";
    mainTopic = mode;
    main = await write({
      ...base,
      mode,
      node: null,
      batchSize: useResurface ? BATCH_SIZE : 2,
      missedConcepts: useResurface ? misses : undefined,
      extraDirectives: [
        ...base.extraDirectives,
        ...tieIn,
        useResurface
          ? "the outline is done: reframe these near-misses as fresh bets — new angle, never the same wording"
          : "the outline is done: two 'adjacent waters' cards — a hook that offers to go one layer deeper into a neighbouring idea (\"wanna go one layer deeper into X? keep scrolling\") and one concept that starts it",
      ],
    });
  }
  if (main?.length) {
    cards.push(...adopt(main, mainTopic, null));
  } else if (st.outcome === "budget") {
    return { cards: [...cards, budgetNotice()], outcome: "budget", node, mainCount: 0, consumedScaffold };
  } else {
    const key = frontierKeyFor(session, all[all.length - 1]?.idx ?? null);
    const error = st.error ?? "writer returned nothing";
    return { cards: [...cards, fallbackCard(error, key)], outcome: "failed", error, node, mainCount: 0, consumedScaffold };
  }
  const highlighted = await highlightCards(cards);
  return { cards: highlighted, outcome: "ok", node, mainCount: main.length, consumedScaffold };
}

// ── interact ────────────────────────────────────────────────────────────────
const CONTENT_TYPES = new Set<string>(WRITER_CARD_TYPES);

export type InteractResult = { card: CardRow; learnerState: LearnerState; inserted: CardRow[]; /** clarify card answered → every clarifier answered → route should schedule replan() */ replanReady?: boolean };

type Reduced =
  | { kind: "system"; card: CardRow; session: Session; replanReady?: boolean }
  | { kind: "content"; card: CardRow; session: Session; recap: { concept: string; viaMiss: boolean } | null };

/**
 * Record a view / answer / dwell / scroll-back. The card row's interaction merge,
 * the first-answer decision and the learner-state reduction all happen under the
 * session lock (a tap and the leave-dwell for the same card overlap constantly),
 * so nothing is double-counted or overwritten. `recapDue` is claimed and cleared
 * in that same write — this function is the only consumer — and the recap card
 * (if any) is written and spliced afterwards, ahead of the user, never behind.
 */
export async function interact(cardId: string, body: InteractBody): Promise<InteractResult> {
  const { llm, store } = await deps();
  const peek = isUuid(cardId) ? await store.getCard(cardId) : null;
  if (!peek) throw new HttpError(404, "not_found", "card not found");
  const sessionId = peek.sessionId;
  const now = nowIso();
  const visitDwell = typeof body.dwellMs === "number" ? Math.max(0, Math.min(60_000, body.dwellMs)) : undefined;

  const r = await withSessionLock(sessionId, async (): Promise<Reduced> => {
    const card = await store.getCard(cardId);
    if (!card) throw new HttpError(404, "not_found", "card not found");
    const session = await store.getSession(sessionId);
    if (!session) throw new HttpError(404, "not_found", "session not found");

    const prev = card.interaction ?? null;
    const firstAnswer = body.correct !== undefined && prev?.correct === undefined;
    const merged: Interaction = { ...(prev ?? {}), at: now };
    if (body.choice !== undefined) merged.choice = body.choice;
    if (body.correct !== undefined && prev?.correct === undefined) merged.correct = body.correct;
    if (body.value !== undefined) merged.value = body.value;
    // cumulative across hide/resume splits and revisits, hard-capped like any single dwell (spec §8)
    if (visitDwell !== undefined) merged.dwellMs = Math.min(60_000, (prev?.dwellMs ?? 0) + visitDwell);
    const updated = await store.updateCard(cardId, { viewedAt: card.viewedAt ?? now, interaction: merged });

    if (!CONTENT_TYPES.has(card.type)) {
      // clarify cards: the tap IS the answer (no model call here; the replan runs after the response)
      if (card.payload.type === "clarify" && body.choice !== undefined) {
        const opts = card.payload.options;
        const answer = typeof body.choice === "number" ? opts[body.choice] : Array.isArray(body.choice) ? body.choice[0] : body.choice;
        if (answer !== undefined) {
          const { session: s2, ready } = await answerClarifiersIn(store, session, { [card.payload.key]: String(answer) });
          return { kind: "system", card: updated, session: s2, replanReady: ready };
        }
      }
      return { kind: "system", card: updated, session };
    }

    const scored = firstAnswer && typeof body.correct === "boolean";
    let state = applyInteraction(session.learnerState, {
      card: card.payload,
      interaction: { ...merged, dwellMs: visitDwell !== undefined ? merged.dwellMs : undefined },
      scrollBack: body.scrollBack,
      firstAnswer,
      repeatVisit: prev?.dwellMs !== undefined,
    });
    // claim the recap trigger in the same write: one trigger → at most one recap, whoever else is generating
    let recap: { concept: string; viaMiss: boolean } | null = null;
    if (state.directives.recapDue) {
      recap = { concept: state.directives.recapDue, viaMiss: scored && body.correct === false };
      state = clearRecap(state, card.payload.topicNodeId);
    }
    const s2 = await store.updateSession(sessionId, { learnerState: state });
    return { kind: "content", card: updated, session: s2, recap };
  });

  if (r.kind === "system") return { card: r.card, learnerState: r.session.learnerState, inserted: [], replanReady: r.replanReady };

  const inserted: CardRow[] = [];
  if (r.recap) {
    const card = r.card;
    const ahead = await store.listCards(sessionId, { after: card.idx, limit: 9 });
    const pending = ahead.slice(0, 8).some((x) => x.type === "recap" && !x.viewedAt);
    if (!pending) {
      const session = r.session;
      const all = await store.listAllCards(sessionId);
      const node = session.outline.find((n) => n.id === card.payload.topicNodeId) ?? currentNode(session);
      const w = await llm.writeBatch({
        ...baseContext(session, all, node),
        mode: "recap",
        batchSize: 1,
        detourId: card.detourId,
        missedConcepts: [r.recap.concept],
        extraDirectives: [...directiveLines(session.learnerState), `the learner is stuck on "${r.recap.concept}" — one recap card: 3 beats, brand-new metaphor, never the same wording`],
      });
      if (w.ok && w.value.length) {
        const [payload] = await highlightCards(adopt(w.value.slice(0, 1), card.payload.topicNodeId, card.detourId));
        // a miss is reported while the user is ON the card → right after it. dwell / scroll-back are reported when
        // they have already moved on → after the next card in this thread, so the recap is ahead of them, never behind.
        const nextInThread = ahead.find((x) => x.detourId === card.detourId) ?? null;
        const anchor = r.recap.viaMiss || !nextInThread ? card : nextInThread;
        const anchorPos = anchor === card ? -1 : ahead.findIndex((x) => x.id === anchor.id);
        const before = ahead[anchorPos + 1] ?? null;
        const key = keyBetween(anchor.idx, before?.idx ?? null);
        try {
          inserted.push(...(await store.insertCards([row(sessionId, key, payload, null)])));
          await updateSessionLocked(store, sessionId, (fresh) => ({ progress: { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + inserted.length } }));
        } catch (e) {
          console.warn("[engine] recap insert failed", e instanceof Error ? e.message : e);
        }
      }
    }
  }
  const learnerState = inserted.length ? ((await store.getSession(sessionId))?.learnerState ?? r.session.learnerState) : r.session.learnerState;
  return { card: r.card, learnerState, inserted };
}

// ── dial ────────────────────────────────────────────────────────────────────
export async function dial(sessionId: string, direction: "simpler" | "deeper", currentCardId: string): Promise<{ session: Session; toast: string; removedAfter: string | null }> {
  const { llm, store } = await deps();
  const card = isUuid(currentCardId) ? await store.getCard(currentCardId) : null;
  if (!card || card.sessionId !== sessionId) throw new HttpError(404, "not_found", "card not found");
  const before = await store.getSession(sessionId);
  if (!before) throw new HttpError(404, "not_found", "session not found");
  const canned = direction === "simpler" ? COPY.toastSimpler : COPY.toastDeeper;
  // the persona toast is written while the runway drops; we never wait on it for long
  const toastP: Promise<string> = before.persona
    ? llm.dialToast({ sessionId, persona: before.persona, direction }).then((t) => t || canned, () => canned)
    : Promise.resolve(canned);
  const session = await withSessionLock(sessionId, async () => {
    const fresh = await store.getSession(sessionId);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    return dropRunwayLocked(store, fresh, card.idx, { learnerState: applyDial(fresh.learnerState, direction) });
  });
  const toast = await Promise.race([toastP, new Promise<string>((res) => setTimeout(() => res(canned), DIAL_TOAST_WAIT_MS).unref?.())]);
  return { session, toast, removedAfter: card.idx };
}
export type { DialData };

// ── ask → inline | detour ───────────────────────────────────────────────────
export async function ask(sessionId: string, question: string, currentCardId: string): Promise<AskData> {
  const { llm, store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  const card = isUuid(currentCardId) ? await store.getCard(currentCardId) : null;
  if (!card || card.sessionId !== sessionId) throw new HttpError(404, "not_found", "card not found");

  const persona = session.persona ?? PLACEHOLDER_PERSONA;
  const node = session.outline.find((n) => n.id === card.payload.topicNodeId) ?? currentNode(session);
  const nodeIdx = node ? session.outline.findIndex((n) => n.id === node.id) : 0;
  const summary = [session.title, session.outline.map((n) => n.title).join(" · "), node ? `now: ${node.title}` : ""].filter(Boolean).join(" — ");
  const triage = await llm.triage({
    sessionId,
    question,
    currentCard: card.payload,
    sessionSummary: summary,
    persona,
    corpusSlice: sliceFor(session.sourceText, node, 3000, { nodeIdx, nodeCount: session.outline.length }),
  });
  if (!triage.ok) return { kind: "inline", answer: triage.code === "budget" ? COPY.askBudget : COPY.askUnavailable };
  if (triage.value.kind === "inline") return { kind: "inline", answer: triage.value.answer };

  const { cardCount, focus } = triage.value;
  const detourId = uuid();
  const all = await store.listAllCards(sessionId);
  const base = baseContext(session, all, node);
  const ctx: DetourContext = {
    ...base,
    detourId,
    batchSize: cardCount,
    question,
    focus,
    cardCount,
    currentCard: card.payload,
    extraDirectives: [...base.extraDirectives, `the learner asked about "${focus}" — reinforce it; answer the question first, then connect it back`],
  };
  const written = await llm.writeDetour(ctx);
  const kept = written.ok ? enforceChill(written.value, session.settings) : [];
  if (!written.ok || kept.length === 0) {
    return { kind: "inline", answer: !written.ok && written.code === "budget" ? COPY.askBudget : COPY.detourUnavailable };
  }
  const cards = await highlightCards(adopt(kept.slice(0, 6), card.payload.topicNodeId, detourId));
  // asking from a detour's close marker opens a SIBLING (the child sits after the close marker in feed order)
  let parentDetourId = card.detourId;
  if (card.payload.type === "detour_marker" && card.payload.kind === "close" && card.detourId) {
    parentDetourId = (await store.listDetours(sessionId)).find((d) => d.id === card.detourId)?.parentDetourId ?? null;
  }
  const detour: Detour = { id: detourId, sessionId, parentDetourId, question, insertedAfterIdx: card.idx, createdAt: nowIso() };

  let rows: CardRow[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = (await store.listCards(sessionId, { after: card.idx, limit: 1 }))[0] ?? null;
    rows = buildDetourRows({ sessionId, detourId, question, current: card, next, cards });
    try {
      rows = await store.insertCards(rows);
      break;
    } catch (e) {
      if (attempt === 1 || !/duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  await store.createDetour(detour);
  await updateSessionLocked(store, sessionId, (fresh) => ({
    learnerState: addReinforce(fresh.learnerState, focus),
    progress: { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + rows.length },
  }));
  return { kind: "detour", detour, cards: rows };
}

// ── clarifiers → replan ─────────────────────────────────────────────────────
/** Lock already held. Merge answers; on the transition to "every clarify card answered" arm pendingReplan atomically. */
async function answerClarifiersIn(store: Store, fresh: Session, answers: Record<string, string>): Promise<{ session: Session; ready: boolean }> {
  const clarifierAnswers = { ...fresh.clarifierAnswers, ...answers };
  const clarify = (await store.listAllCards(fresh.id)).filter((c): c is CardRow & { payload: ClarifyCard } => c.payload.type === "clarify");
  const ready =
    clarify.length > 0 &&
    clarify.every((c) => clarifierAnswers[c.payload.key] !== undefined) &&
    fresh.sourceMeta.replannedAt === undefined &&
    fresh.status === "active" &&
    !replanPending(fresh);
  const patch: Partial<Session> = { clarifierAnswers };
  if (ready) {
    patch.progress = { ...fresh.progress, pendingReplan: true };
    patch.sourceMeta = { ...fresh.sourceMeta, replanStartedAt: nowIso() };
  }
  const session = await store.updateSession(fresh.id, patch);
  return { session, ready };
}

/**
 * Merge answers; `ready` exactly once — on the call that completes the set (and
 * no replan ran or is pending). Both routes (interact on a clarify card, PATCH
 * clarifierAnswers) funnel here, so a re-plan can only be scheduled once.
 */
export async function answerClarifiers(sessionId: string, answers: Record<string, string>): Promise<{ session: Session; ready: boolean }> {
  const { store } = await deps();
  return withSessionLock(sessionId, async () => {
    const fresh = await store.getSession(sessionId);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    return answerClarifiersIn(store, fresh, answers);
  });
}

/** Re-plan with the clarifier answers: new outline/persona, unviewed runway regenerated. Single-flight. Never throws. */
export function replan(sessionId: string): Promise<Session | null> {
  return singleFlight(`replan:${sessionId}`, () => replanInner(sessionId));
}

async function replanInner(sessionId: string): Promise<Session | null> {
  const { llm, store } = await deps();
  const clearPending = () =>
    updateSessionLocked(store, sessionId, (fresh) => (fresh.progress.pendingReplan ? { progress: { ...fresh.progress, pendingReplan: false } } : null)).catch(() => null);
  const session = await store.getSession(sessionId);
  if (!session || !session.persona || !session.theme || session.sourceMeta.replannedAt !== undefined) {
    if (session) await clearPending();
    return session;
  }
  try {
    const all = await store.listAllCards(sessionId);
    const firstCards = all.filter((c) => !c.detourId && CONTENT_TYPES.has(c.type)).slice(0, 3).map((c) => c.payload);
    const previousPlan: PlanOutput = { title: session.title, theme: session.theme, persona: session.persona, outline: session.outline, clarifiers: [], firstCards };
    const plan = await llm.plan({
      sessionId,
      sourceKind: session.sourceKind,
      sourceText: session.sourceText,
      sourceMeta: session.sourceMeta,
      settings: session.settings,
      clarifierAnswers: session.clarifierAnswers,
      previousPlan,
    });
    if (!plan.ok) {
      return await updateSessionLocked(store, sessionId, (fresh) => ({
        sourceMeta: { ...fresh.sourceMeta, replannedAt: nowIso(), replanError: failureMessage(plan) },
        progress: { ...fresh.progress, pendingReplan: false },
      }));
    }
    return await applyPlan(store, session, plan.value, { replan: true });
  } catch (e) {
    console.error("[engine] replan failed", sessionId, e instanceof Error ? e.message : e);
    return updateSessionLocked(store, sessionId, (fresh) => ({
      sourceMeta: { ...fresh.sourceMeta, replannedAt: nowIso() },
      progress: { ...fresh.progress, pendingReplan: false },
    })).catch(() => null);
  } finally {
    await clearPending();
  }
}

// ── retry / remix / settings ────────────────────────────────────────────────
/** One-tap retry: planning error → plan again; unviewed trailing fallback → drop it (epoch bump) so the next generate runs. */
export async function retrySession(sessionId: string): Promise<{ session: Session; action: "replan" | "regenerate" | "none" }> {
  const { store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  if (session.status === "error") {
    const s = await store.updateSession(sessionId, { status: "planning", error: null, sourceMeta: { ...session.sourceMeta, planningStartedAt: nowIso() } });
    return { session: s, action: "replan" };
  }
  return withSessionLock(sessionId, async () => {
    const fresh = await store.getSession(sessionId);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    const all = await store.listAllCards(sessionId);
    const last = all[all.length - 1];
    if (last && isFallback(last.payload) && !last.viewedAt) {
      const prev = all[all.length - 2] ?? null;
      const s = await dropRunwayLocked(store, fresh, prev?.idx ?? null);
      return { session: s, action: "regenerate" as const };
    }
    return { session: fresh, action: "none" as const };
  });
}

export async function remixSession(sessionId: string, settings: Partial<Session["settings"]>): Promise<Session> {
  const { store } = await deps();
  const src = await store.getSession(sessionId);
  if (!src) throw new HttpError(404, "not_found", "session not found");
  return createSession({
    input: src.sourceText,
    sourceKind: src.sourceKind,
    sourceMeta: { ...src.sourceMeta, remixOf: src.id },
    settings: { ...src.settings, ...settings },
    title: src.title,
  });
}

/**
 * Settings/position/title/status patch (learner prefs follow chill/depth).
 * Turning chill mode ON drops the unviewed runway past the user's frontier (D7):
 * bets already written must never show; the next generate rebuilds it.
 */
export async function patchSession(sessionId: string, patch: { settings?: Partial<Session["settings"]>; position?: number; title?: string; status?: "archived" | "active" }): Promise<Session> {
  const { store } = await deps();
  return withSessionLock(sessionId, async () => {
    const fresh = await store.getSession(sessionId);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    const out: Partial<Session> = {};
    if (patch.settings) {
      out.settings = { ...fresh.settings, ...patch.settings };
      out.learnerState = withPrefs(fresh.learnerState, { chillMode: out.settings.chillMode, depthPreset: out.settings.depthPreset });
    }
    if (patch.position !== undefined) out.position = patch.position;
    if (patch.title !== undefined) out.title = patch.title;
    if (patch.status !== undefined && fresh.status !== "planning" && fresh.status !== "error") out.status = patch.status;
    if (fresh.status !== "planning") out.lastOpenedAt = nowIso();
    const chillOn = patch.settings?.chillMode === true && !fresh.settings.chillMode && fresh.status !== "planning";
    if (chillOn) {
      const all = await store.listAllCards(sessionId);
      // past the furthest viewed row; a never-opened session keeps its plan-authored opening (hook + concepts, no bets)
      const cutoff = lastViewedIdx(all) ?? all.filter((c) => c.batchId === null).at(-1)?.idx ?? null;
      return dropRunwayLocked(store, fresh, cutoff, out);
    }
    return store.updateSession(sessionId, out);
  });
}

/**
 * Zod 4 quirk: `SessionSettingsSchema.partial()` still fills defaults for
 * missing keys, so a PATCH of `{ chillMode: true }` would silently reset
 * depthPreset. Keep only the keys the client actually sent.
 */
export function providedSettings(parsed: Partial<Session["settings"]> | undefined, rawSettings: unknown): Partial<Session["settings"]> {
  if (!parsed) return {};
  if (!rawSettings || typeof rawSettings !== "object") return {};
  const out: Partial<Session["settings"]> = {};
  for (const k of Object.keys(rawSettings as Record<string, unknown>) as (keyof Session["settings"])[]) {
    if (k in parsed) (out as Record<string, unknown>)[k] = parsed[k];
  }
  return out;
}

/** GET session: lazy watchdog + not-found (non-uuid ids never reach the store). */
export async function getSessionOr404(sessionId: string): Promise<Session> {
  const { store } = await deps();
  const session = isUuid(sessionId) ? await store.getSession(sessionId) : null;
  if (!session) throw new HttpError(404, "not_found", "session not found");
  return (await reapIfStuck(session)) ?? session;
}

export async function listCardsPage(sessionId: string, after: string | null, limit: number): Promise<{ cards: CardRow[]; hasMore: boolean }> {
  const { store } = await deps();
  const page = await store.listCards(sessionId, { after, limit: limit + 1 });
  return { cards: page.slice(0, limit), hasMore: page.length > limit };
}

export async function listSessions(): Promise<Session[]> {
  const { store } = await deps();
  return store.listSessions();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { store } = await deps();
  await store.deleteSession(sessionId);
  watchdogs.delete(sessionId);
}

export async function countCards(sessionId: string): Promise<number> {
  const { store } = await deps();
  return (await store.listAllCards(sessionId)).length;
}
