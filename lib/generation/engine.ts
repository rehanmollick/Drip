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
 *   createSession → startPlanning (teaser cards → plan → first cards)
 *   generateNext  → idempotent frontier-keyed batches, recap/scaffold prepends,
 *                   infinite continuation, budget notice / fallback as data
 *   interact      → learner-state reduction, auto recap insertion
 *   dial          → level ±1, drop unviewed runway (regeneration happens lazily)
 *   ask           → triage → inline | detour splice (nesting-safe)
 *   answerClarifiers / replan, retry, remix, watchdog
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
export const MAX_UNVIEWED_RUNWAY = 16;
const POLL_MS = 400;
const CORPUS_SLICE_CHARS = 6000;

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

// ── per-session mutex (in-process) ──────────────────────────────────────────
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

/** Read-modify-write a session under the lock; `fn` returns the patch. */
async function updateSessionLocked(store: Store, id: string, fn: (fresh: Session) => Partial<Session> | null): Promise<Session> {
  return withSessionLock(id, async () => {
    const fresh = await store.getSession(id);
    if (!fresh) throw new HttpError(404, "not_found", "session not found");
    const patch = fn(fresh);
    return patch ? store.updateSession(id, patch) : fresh;
  });
}

// ── small helpers ───────────────────────────────────────────────────────────
export function autoTitle(text: string): string {
  const first = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first || "untitled";
}

const sameUtcDay = (aIso: string, bIso: string) => aIso.slice(0, 10) === bIso.slice(0, 10);

function row(sessionId: string, idx: string, payload: Card, batchId: string | null, createdAt = nowIso()): CardRow {
  return { id: payload.id, sessionId, idx, type: payload.type, payload, detourId: payload.detourId, batchId, viewedAt: null, interaction: null, createdAt };
}

/** Fresh server-side ids + thread fields; the model's ids are never trusted. */
function adopt(cards: Card[], topicNodeId: string, detourId: string | null): Card[] {
  return cards.map((c) => ({ ...c, id: uuid(), topicNodeId, detourId }));
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

async function insertAfterLast(store: Store, sessionId: string, cards: Card[], batchId: string | null): Promise<CardRow[]> {
  // Two attempts: a concurrent splice at the very end (ask detour) can steal our keys.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await store.lastCard(sessionId);
    const keys = keysBetween(last?.idx ?? null, null, cards.length);
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

/** Recompute the frontier after cards were dropped (dial / replan). */
export function recomputeProgress(session: Session, cards: CardRow[]): Session["progress"] {
  const outlineIds = new Set(session.outline.map((n) => n.id));
  const main = cards.filter((c) => !c.detourId && outlineIds.has(c.payload.topicNodeId));
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
    status: "planning",
    error: null,
    position: 0,
    createdAt: now,
    lastOpenedAt: now,
  };
  return store.createSession(session);
}

/**
 * Plan a session: (big corpus) teaser cards first so the feed has something
 * within seconds → planner → clarifier cards + first cards → status active.
 * Safe to call from `after()` or synchronously in tests. Never throws.
 */
export async function startPlanning(sessionId: string): Promise<Session | null> {
  const { llm, store } = await deps();
  const existing = await store.getSession(sessionId);
  if (!existing) return null;
  const startedAt = nowIso();
  let session = await store.updateSession(sessionId, {
    status: "planning",
    error: null,
    sourceMeta: { ...existing.sourceMeta, planningStartedAt: startedAt },
  });
  scheduleWatchdog(sessionId);
  try {
    const cards = await store.listAllCards(sessionId);
    if (session.sourceText.length > TEASER_THRESHOLD_CHARS && cards.length === 0) {
      const teaser = await llm.writeBatch({
        ...baseContext(session, [], null),
        mode: "teaser",
        batchSize: 2,
        corpusSlice: session.sourceText.slice(0, 2000),
        extraDirectives: ["planning is still running: two quick cards that tease what's coming, in a warm neutral voice"],
      });
      if (teaser.ok && teaser.value.length) {
        const adopted = await highlightCards(adopt(teaser.value.slice(0, 2), "teaser", null));
        const rows = await insertAfterLast(store, sessionId, adopted, null);
        session = await store.updateSession(sessionId, {
          progress: { ...session.progress, totalGenerated: session.progress.totalGenerated + rows.length, lastIdx: rows[rows.length - 1].idx },
        });
      }
    }
    const plan = await llm.plan({
      sessionId,
      sourceKind: session.sourceKind,
      sourceText: session.sourceText,
      sourceMeta: session.sourceMeta,
      settings: session.settings,
      clarifierAnswers: Object.keys(session.clarifierAnswers).length ? session.clarifierAnswers : undefined,
    });
    if (!plan.ok) {
      return await store.updateSession(sessionId, { status: "error", error: failureMessage(plan) });
    }
    return await applyPlan(store, session, plan.value, { replan: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[engine] planning failed", sessionId, message);
    return store.updateSession(sessionId, { status: "error", error: message.slice(0, 200) }).catch(() => null);
  } finally {
    const t = watchdogs.get(sessionId);
    if (t) clearTimeout(t);
    watchdogs.delete(sessionId);
  }
}

async function applyPlan(store: Store, session: Session, plan: PlanOutput, opts: { replan: boolean }): Promise<Session> {
  const firstNode = plan.outline[0];
  const payloads: Card[] = [];
  if (!opts.replan) {
    for (const c of plan.clarifiers.slice(0, 3)) {
      const card: ClarifyCard = { id: uuid(), type: "clarify", topicNodeId: "clarify", detourId: null, eyebrow: "quick one", key: c.key, prompt: c.prompt, options: c.options };
      payloads.push(card);
    }
  } else {
    // regenerate the runway: viewed history stays, unviewed goes
    await store.deleteUnviewedAfter(session.id, null);
  }
  const first = await highlightCards(adopt(plan.firstCards, firstNode?.id ?? SYSTEM_NODE, null));
  payloads.push(...first);
  const rows = await insertAfterLast(store, session.id, payloads, null);
  const all = await store.listAllCards(session.id);
  const { planningStartedAt: _dropped, ...sourceMeta } = session.sourceMeta as Record<string, unknown> & { planningStartedAt?: unknown };
  void _dropped;
  const titleIsAuto = session.title === autoTitle(session.sourceText) || session.title === "untitled";
  return store.updateSession(session.id, {
    title: titleIsAuto ? plan.title : session.title,
    theme: opts.replan && session.theme ? session.theme : plan.theme,
    persona: plan.persona,
    outline: plan.outline,
    status: "active",
    error: null,
    sourceMeta: opts.replan ? { ...sourceMeta, replannedAt: nowIso() } : sourceMeta,
    progress: {
      ...session.progress,
      nodeIdx: 0,
      cardsInNode: first.length,
      exhausted: false,
      extensions: 0,
      totalGenerated: all.length,
      lastIdx: rows[rows.length - 1]?.idx ?? session.progress.lastIdx,
    },
  });
}

// ── generation ──────────────────────────────────────────────────────────────
type PseudoBatch = GenerateData["batch"];
const pseudo = (id: string, status: PseudoBatch["status"], frontierKey: string): PseudoBatch => ({ id, status, frontierKey });
const toWire = (b: Batch): PseudoBatch => ({ id: b.id, status: b.status, frontierKey: b.frontierKey });

export function frontierKeyFor(session: Session, lastIdx: string | null): string {
  return `cardbatch:v${CARD_SCHEMA_VERSION}:${session.id}:${lastIdx ?? "start"}:${learnerStateHash(session.learnerState)}`;
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

/**
 * Next batch for the frontier. Idempotent: the same frontier (last card +
 * learner state) maps to one batch; concurrent callers wait for the owner.
 */
export async function generateNext(sessionId: string, opts: { waitMs?: number } = {}): Promise<GenerateData> {
  const { llm, store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  if (session.status === "planning") return { batch: pseudo("planning", "pending", `planning:${sessionId}`), cards: [] };
  if (session.status === "error") return { batch: pseudo("error", "failed", `error:${sessionId}`), cards: [] };

  const all = await store.listAllCards(sessionId);
  const last = all[all.length - 1] ?? null;
  const now = nowIso();

  // Guards: don't stack budget notices or fallbacks; don't run past a sane runway.
  if (last && isBudgetNotice(last.payload) && sameUtcDay(last.createdAt, now)) {
    return { batch: pseudo("budget", "done", `budget:${sessionId}`), cards: [last] };
  }
  if (last && isFallback(last.payload) && !last.viewedAt) {
    return { batch: pseudo("fallback", "failed", last.payload.retryKey ?? `fallback:${sessionId}`), cards: [last] };
  }
  const unviewed = all.filter((c) => !c.viewedAt).length;
  if (unviewed >= MAX_UNVIEWED_RUNWAY) {
    return { batch: pseudo("runway_full", "done", `runway:${sessionId}:${last?.idx ?? "start"}`), cards: [] };
  }

  const frontierKey = frontierKeyFor(session, last?.idx ?? null);
  const claim = await store.claimBatch({ id: uuid(), sessionId, frontierKey, status: "pending", cardIds: [], error: null, createdAt: now, updatedAt: now });
  let batch = claim.batch;
  if (!claim.created) {
    if (batch.status === "done") return { batch: toWire(batch), cards: await cardsOfBatch(store, batch) };
    const stale = batch.status === "pending" && Date.now() - Date.parse(batch.updatedAt) > STALE_BATCH_MS;
    if (batch.status === "pending" && !stale) {
      const settled = await waitForBatch(store, sessionId, frontierKey, opts.waitMs ?? BATCH_WAIT_MS);
      if (!settled) return { batch: toWire(batch), cards: [] };
      return { batch: toWire(settled), cards: settled.status === "done" ? await cardsOfBatch(store, settled) : [] };
    }
    // failed (explicit retry) or stale pending (owner died): take it over
    batch = await store.updateBatch(batch.id, { status: "pending", error: null, cardIds: [], updatedAt: now });
  }

  // ── we own the batch ──
  try {
    const built = await buildBatch(llm, session, all);
    const status: Batch["status"] = built.outcome === "failed" ? "failed" : "done";
    const rows = await insertAfterLast(store, sessionId, built.cards, batch.id);
    await store.updateBatch(batch.id, { status, cardIds: rows.map((r) => r.id), error: built.error ?? null, updatedAt: nowIso() });
    await updateSessionLocked(store, sessionId, (fresh) => {
      let state = fresh.learnerState;
      if (built.consumedRecap) state = clearRecap(state);
      if (built.consumedScaffold) state = clearScaffold(state);
      const p = { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + rows.length, lastIdx: rows[rows.length - 1]?.idx ?? fresh.progress.lastIdx };
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
      return { learnerState: state, progress: p };
    });
    return { batch: { id: batch.id, status, frontierKey }, cards: rows };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    console.error("[engine] generate failed", sessionId, message);
    // failure as data: one fallback card, batch marked failed
    let rows: CardRow[] = [];
    try {
      rows = await insertAfterLast(store, sessionId, [fallbackCard(message, frontierKey)], batch.id);
    } catch {
      /* the store itself is down; the route surfaces an enveloped error */
    }
    await store.updateBatch(batch.id, { status: "failed", cardIds: rows.map((r) => r.id), error: message, updatedAt: nowIso() }).catch(() => undefined);
    return { batch: { id: batch.id, status: "failed", frontierKey }, cards: rows };
  }
}

type Built = {
  cards: Card[];
  outcome: "ok" | "budget" | "failed";
  error?: string;
  node: OutlineNode | null;
  mainCount: number;
  consumedRecap: boolean;
  consumedScaffold: boolean;
};

/** Compose one batch: optional recap + optional scaffold + the main write. */
async function buildBatch(llm: LlmApi, session: Session, all: CardRow[]): Promise<Built> {
  const node = currentNode(session);
  const base = baseContext(session, all, node);
  const d = session.learnerState.directives;
  const cards: Card[] = [];
  const topic = node?.id ?? SYSTEM_NODE;
  const st: { outcome: Built["outcome"]; error?: string } = { outcome: "ok" };
  let consumedRecap = false;
  let consumedScaffold = false;

  const write = async (ctx: WriteContext): Promise<Card[] | null> => {
    const r = await llm.writeBatch(ctx);
    if (r.ok) return r.value;
    if (r.code === "budget") st.outcome = "budget";
    else st.error = failureMessage(r);
    return null;
  };

  if (d.recapDue) {
    const r = await write({ ...base, mode: "recap", batchSize: 1, missedConcepts: [d.recapDue], extraDirectives: [...base.extraDirectives, `the learner missed "${d.recapDue}" twice — one recap card: 3 beats, brand-new metaphor`] });
    if (r?.length) {
      cards.push(...adopt(r.slice(0, 1), topic, null));
      consumedRecap = true;
    }
    if (st.outcome === "budget") return { cards: [...cards, budgetNotice()], outcome: "budget", node, mainCount: 0, consumedRecap, consumedScaffold };
  }
  if (d.scaffoldNext.length) {
    const r = await write({ ...base, mode: "scaffold", batchSize: 1, missedConcepts: d.scaffoldNext, extraDirectives: [...base.extraDirectives, `re-angle "${d.scaffoldNext[0]}" as one concept card before the next bet — new example, plainer words`] });
    if (r?.length) {
      cards.push(...adopt(r.slice(0, 1), topic, null));
      consumedScaffold = true;
    }
    if (st.outcome === "budget") return { cards: [...cards, budgetNotice()], outcome: "budget", node, mainCount: 0, consumedRecap, consumedScaffold };
  }

  // main write
  let main: Card[] | null = null;
  let mainTopic = topic;
  if (node) {
    const completes = session.progress.cardsInNode + BATCH_SIZE >= node.estCards;
    const extra = [...base.extraDirectives];
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
        useResurface
          ? "the outline is done: reframe these near-misses as fresh bets — new angle, never the same wording"
          : "the outline is done: two 'adjacent waters' cards — a hook that offers to go one layer deeper into a neighbouring idea (\"wanna go one layer deeper into X? keep scrolling\") and one concept that starts it",
      ],
    });
  }
  if (main?.length) {
    cards.push(...adopt(main, mainTopic, null));
  } else if (st.outcome === "budget") {
    return { cards: [...cards, budgetNotice()], outcome: "budget", node, mainCount: 0, consumedRecap, consumedScaffold };
  } else {
    const key = frontierKeyFor(session, all[all.length - 1]?.idx ?? null);
    const error = st.error ?? "writer returned nothing";
    return { cards: [...cards, fallbackCard(error, key)], outcome: "failed", error, node, mainCount: 0, consumedRecap, consumedScaffold };
  }
  const highlighted = await highlightCards(cards);
  return { cards: highlighted, outcome: "ok", node, mainCount: main.length, consumedRecap, consumedScaffold };
}

// ── interact ────────────────────────────────────────────────────────────────
const CONTENT_TYPES = new Set<string>(WRITER_CARD_TYPES);

export type InteractResult = { card: CardRow; learnerState: LearnerState; inserted: CardRow[]; /** clarify card answered → every clarifier answered → route should schedule replan() */ replanReady?: boolean };

export async function interact(cardId: string, body: InteractBody): Promise<InteractResult> {
  const { llm, store } = await deps();
  const card = await store.getCard(cardId);
  if (!card) throw new HttpError(404, "not_found", "card not found");
  const session = await store.getSession(card.sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");

  const now = nowIso();
  const visitDwell = typeof body.dwellMs === "number" ? Math.max(0, Math.min(60_000, body.dwellMs)) : undefined;
  const prev = card.interaction ?? null;
  const firstAnswer = body.correct !== undefined && prev?.correct === undefined;
  const merged: Interaction = { ...(prev ?? {}), at: now };
  if (body.choice !== undefined) merged.choice = body.choice;
  if (body.correct !== undefined && prev?.correct === undefined) merged.correct = body.correct;
  if (body.value !== undefined) merged.value = body.value;
  if (visitDwell !== undefined) merged.dwellMs = Math.min(60_000 * 4, (prev?.dwellMs ?? 0) + visitDwell);

  const updated = await store.updateCard(cardId, { viewedAt: card.viewedAt ?? now, interaction: merged });

  if (!CONTENT_TYPES.has(card.type)) {
    // clarify cards: the tap IS the answer (no model call here; the replan runs after the response)
    if (card.payload.type === "clarify" && body.choice !== undefined) {
      const opts = card.payload.options;
      const answer = typeof body.choice === "number" ? opts[body.choice] : Array.isArray(body.choice) ? body.choice[0] : body.choice;
      if (answer !== undefined) {
        const { session: s2, ready } = await answerClarifiers(session.id, { [card.payload.key]: String(answer) });
        return { card: updated, learnerState: s2.learnerState, inserted: [], replanReady: ready };
      }
    }
    return { card: updated, learnerState: session.learnerState, inserted: [] };
  }

  // reduce learner state under the session lock (write a NEW object)
  let state = (await updateSessionLocked(store, session.id, (fresh) => ({
    learnerState: applyInteraction(fresh.learnerState, {
      card: card.payload,
      interaction: { ...merged, dwellMs: visitDwell },
      scrollBack: body.scrollBack,
      firstAnswer,
    }),
  }))).learnerState;

  const inserted: CardRow[] = [];
  if (state.directives.recapDue) {
    const runway = await store.listCards(session.id, { after: card.idx, limit: 8 });
    const pending = runway.some((r) => r.type === "recap" && !r.viewedAt);
    if (!pending) {
      const concept = state.directives.recapDue;
      const all = await store.listAllCards(session.id);
      const node = session.outline.find((n) => n.id === card.payload.topicNodeId) ?? currentNode(session);
      const r = await llm.writeBatch({
        ...baseContext({ ...session, learnerState: state }, all, node),
        mode: "recap",
        batchSize: 1,
        detourId: card.detourId,
        missedConcepts: [concept],
        extraDirectives: [...directiveLines(state), `the learner is stuck on "${concept}" — one recap card: 3 beats, brand-new metaphor, never the same wording`],
      });
      if (r.ok && r.value.length) {
        const [payload] = await highlightCards(adopt(r.value.slice(0, 1), card.payload.topicNodeId, card.detourId));
        const key = keyBetween(card.idx, runway[0]?.idx ?? null);
        try {
          inserted.push(...(await store.insertCards([row(session.id, key, payload, null)])));
        } catch (e) {
          console.warn("[engine] recap insert failed", e instanceof Error ? e.message : e);
        }
      }
    }
    // one attempt per trigger, whatever happened
    state = (await updateSessionLocked(store, session.id, (fresh) => ({
      learnerState: clearRecap(fresh.learnerState),
      progress: { ...fresh.progress, totalGenerated: fresh.progress.totalGenerated + inserted.length },
    }))).learnerState;
  }
  return { card: updated, learnerState: state, inserted };
}

// ── dial ────────────────────────────────────────────────────────────────────
export async function dial(sessionId: string, direction: "simpler" | "deeper", currentCardId: string): Promise<{ session: Session; toast: string; removedAfter: string | null }> {
  const { llm, store } = await deps();
  const card = await store.getCard(currentCardId);
  if (!card || card.sessionId !== sessionId) throw new HttpError(404, "not_found", "card not found");
  await store.deleteUnviewedAfter(sessionId, card.idx);
  const remaining = await store.listAllCards(sessionId);
  const session = await updateSessionLocked(store, sessionId, (fresh) => ({
    learnerState: applyDial(fresh.learnerState, direction),
    progress: recomputeProgress(fresh, remaining),
  }));
  let toast = direction === "simpler" ? COPY.toastSimpler : COPY.toastDeeper;
  if (session.persona) {
    try {
      toast = (await llm.dialToast({ sessionId, persona: session.persona, direction })) || toast;
    } catch {
      /* canned toast */
    }
  }
  return { session, toast, removedAfter: card.idx };
}
export type { DialData };

// ── ask → inline | detour ───────────────────────────────────────────────────
export async function ask(sessionId: string, question: string, currentCardId: string): Promise<AskData> {
  const { llm, store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  const card = await store.getCard(currentCardId);
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
  if (!written.ok || written.value.length === 0) {
    return { kind: "inline", answer: !written.ok && written.code === "budget" ? COPY.askBudget : COPY.detourUnavailable };
  }
  const cards = await highlightCards(adopt(written.value.slice(0, 6), card.payload.topicNodeId, detourId));
  const detour: Detour = { id: detourId, sessionId, parentDetourId: card.detourId, question, insertedAfterIdx: card.idx, createdAt: nowIso() };

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
/** Merge answers; `ready` when every clarify card has an answer and no replan ran yet. */
export async function answerClarifiers(sessionId: string, answers: Record<string, string>): Promise<{ session: Session; ready: boolean }> {
  const { store } = await deps();
  const session = await updateSessionLocked(store, sessionId, (fresh) => ({ clarifierAnswers: { ...fresh.clarifierAnswers, ...answers } }));
  const clarify = (await store.listAllCards(sessionId)).filter((c): c is CardRow & { payload: ClarifyCard } => c.payload.type === "clarify");
  const ready =
    clarify.length > 0 &&
    clarify.every((c) => session.clarifierAnswers[c.payload.key] !== undefined) &&
    session.sourceMeta.replannedAt === undefined &&
    session.status === "active";
  return { session, ready };
}

/** Re-plan with the clarifier answers: new outline/persona, unviewed runway regenerated. Never throws. */
export async function replan(sessionId: string): Promise<Session | null> {
  const { llm, store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session || !session.persona || !session.theme || session.sourceMeta.replannedAt !== undefined) return session;
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
      return await store.updateSession(sessionId, { sourceMeta: { ...session.sourceMeta, replannedAt: nowIso(), replanError: failureMessage(plan) } });
    }
    return await applyPlan(store, session, plan.value, { replan: true });
  } catch (e) {
    console.error("[engine] replan failed", sessionId, e instanceof Error ? e.message : e);
    return store.updateSession(sessionId, { sourceMeta: { ...session.sourceMeta, replannedAt: nowIso() } }).catch(() => null);
  }
}

// ── retry / remix / settings ────────────────────────────────────────────────
/** One-tap retry: planning error → plan again; unviewed trailing fallback → drop it so the next generate runs. */
export async function retrySession(sessionId: string): Promise<{ session: Session; action: "replan" | "regenerate" | "none" }> {
  const { store } = await deps();
  const session = await store.getSession(sessionId);
  if (!session) throw new HttpError(404, "not_found", "session not found");
  if (session.status === "error") {
    const s = await store.updateSession(sessionId, { status: "planning", error: null, sourceMeta: { ...session.sourceMeta, planningStartedAt: nowIso() } });
    return { session: s, action: "replan" };
  }
  const all = await store.listAllCards(sessionId);
  const last = all[all.length - 1];
  if (last && isFallback(last.payload) && !last.viewedAt) {
    const prev = all[all.length - 2] ?? null;
    await store.deleteUnviewedAfter(sessionId, prev?.idx ?? null);
    const s = await updateSessionLocked(store, sessionId, (fresh) => ({ progress: recomputeProgress(fresh, all.slice(0, -1)) }));
    return { session: s, action: "regenerate" };
  }
  return { session, action: "none" };
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

/** Settings/position/title/status patch (learner prefs follow chill/depth). */
export async function patchSession(sessionId: string, patch: { settings?: Partial<Session["settings"]>; position?: number; title?: string; status?: "archived" | "active" }): Promise<Session> {
  const { store } = await deps();
  return updateSessionLocked(store, sessionId, (fresh) => {
    const out: Partial<Session> = {};
    if (patch.settings) {
      out.settings = { ...fresh.settings, ...patch.settings };
      out.learnerState = withPrefs(fresh.learnerState, { chillMode: out.settings.chillMode, depthPreset: out.settings.depthPreset });
    }
    if (patch.position !== undefined) out.position = patch.position;
    if (patch.title !== undefined) out.title = patch.title;
    if (patch.status !== undefined && fresh.status !== "planning" && fresh.status !== "error") out.status = patch.status;
    if (fresh.status !== "planning") out.lastOpenedAt = nowIso();
    return out;
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

/** GET session: lazy watchdog + not-found. */
export async function getSessionOr404(sessionId: string): Promise<Session> {
  const { store } = await deps();
  const session = await store.getSession(sessionId);
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
