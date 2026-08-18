import type { Card, CardType } from "@/lib/schemas/cards";
import type { LearnerState, SessionSettings } from "@/lib/schemas/learner";
import type { OutlineNode, Persona, PlanOutput, TriageOutput } from "@/lib/schemas/plan";
import type { SourceKind, Storyline } from "@/lib/schemas/session";
import type { Theme } from "@/lib/schemas/theme";

/**
 * Types shared between lib/llm.ts (the only SDK importer) and its callers in
 * lib/generation/**. Kept in a separate file so callers never import the SDK.
 */

export type LlmMeta = {
  model: string;
  promptVersion: string;
  latencyMs: number;
  inTokens: number;
  outTokens: number;
  attempts: number;
};

export type LlmFailureCode =
  | "budget"        // daily cap reached (or count unreadable → fails closed)
  | "no_key"        // ANTHROPIC_API_KEY missing
  | "validation"    // failed Zod twice
  | "api"           // network / 4xx / 5xx after SDK retries
  | "refusal";      // stop_reason refusal

export type LlmResult<T> =
  | { ok: true; value: T; meta: LlmMeta }
  | { ok: false; code: LlmFailureCode; error: string; raw?: string; meta?: Partial<LlmMeta> };

/** Compact summary of a recent card, for continuity + zero repetition. */
export type CardSummary = { type: CardType; gist: string; metaphor?: string };

export type PlanInput = {
  sessionId: string;
  sourceKind: SourceKind;
  sourceText: string;                 // full corpus (the planner sees a bounded slice; see prompts)
  sourceMeta: Record<string, unknown>;
  settings: SessionSettings;
  clarifierAnswers?: Record<string, string>;
  previousPlan?: PlanOutput;          // set on re-plan after clarifiers are answered
};

export type WriteMode =
  | "normal"        // next 4 cards for the current outline node
  | "teaser"        // 2 quick "reading your stuff…" cards from the first 2k chars (planning still running)
  | "resurface"     // outline exhausted: near-miss items reframed as fresh bets
  | "adjacent"      // outline exhausted: "adjacent waters" cards / accepted extension
  | "recap"         // one recap card (3 beats, new metaphor) for a confused concept
  | "scaffold";     // one concept re-angle card before the next interactive on a missed concept

export type WriteContext = {
  /** The session's through-line (spine / covered / next) — keeps a card 40 slides deep on-story. */
  storyline?: Storyline | null;
  /** Types used by the last few cards, so the writer stops reaching for `concept` every time. */
  recentTypes?: CardType[];
  sessionId: string;
  mode: WriteMode;
  persona: Persona;
  theme: Pick<Theme, "name" | "mood" | "signature">;
  node: OutlineNode | null;           // null in teaser/resurface/adjacent modes
  corpusSlice: string;                // grounding text relevant to this node (bounded)
  sourceKind: SourceKind;
  learnerState: LearnerState;
  settings: SessionSettings;
  recent: CardSummary[];              // last 6 card summaries
  usedMetaphors: string[];            // never repeat
  allowedTypes: readonly CardType[];  // chill mode removes interactives
  batchSize: number;                  // 4 normally
  detourId: string | null;
  extraDirectives: string[];          // e.g. "user missed 'TTL' twice", "asked about X → reinforce"
  missedConcepts?: string[];          // for resurface/recap/scaffold modes
};

export type TriageInput = {
  sessionId: string;
  question: string;
  currentCard: Card;
  sessionSummary: string;             // title + outline titles + current node
  persona: Persona;
  corpusSlice: string;                // small, relevant slice for a grounded inline answer
};

export type DetourContext = Omit<WriteContext, "mode" | "node"> & {
  question: string;
  focus: string;
  cardCount: number;                  // 2..6
  currentCard: Card;
  detourId: string;
};

export type OpenVerdict = "got_it" | "close" | "not_yet";
export type OpenEvaluation = {
  verdict: OpenVerdict;
  /** Speaks to what THEY wrote — names what they got, then adds the missing piece. Persona voice. */
  feedback: string;
  /** Concepts they missed, for the learner state. */
  missed: string[];
};

export type EvaluateOpenInput = {
  sessionId: string;
  prompt: string;
  rubric: string;
  modelAnswer: string;
  answer: string;
  persona: Persona;
  corpusSlice: string;
};

export type StorylineInput = {
  sessionId: string;
  prev: Storyline | null;
  title: string;
  outline: OutlineNode[];
  nodeIdx: number;
  recent: CardSummary[];
  corpusSlice: string;
};

export type WrapContext = {
  sessionId: string;
  persona: Persona;
  theme: Pick<Theme, "name" | "mood" | "signature">;
  storyline: Storyline | null;
  outline: OutlineNode[];
  covered: CardSummary[];
  learnerState: LearnerState;
};

export interface LlmApi {
  plan(input: PlanInput): Promise<LlmResult<PlanOutput>>;
  writeBatch(ctx: WriteContext): Promise<LlmResult<Card[]>>;
  triage(input: TriageInput): Promise<LlmResult<TriageOutput>>;
  writeDetour(ctx: DetourContext): Promise<LlmResult<Card[]>>;
  /** Cheap dial toast in the persona's voice ("say less. rewinding the jargon."). Never fails: falls back to canned copy. */
  dialToast(input: { sessionId: string; persona: Persona; direction: "simpler" | "deeper" }): Promise<string>;
  /** Grade a typed answer against the card's rubric and reply to what they actually wrote. */
  evaluateOpen(input: EvaluateOpenInput): Promise<LlmResult<OpenEvaluation>>;
  /** Refresh the session's through-line as topics complete; cheap, and it keeps long sessions coherent. */
  updateStoryline(input: StorylineInput): Promise<LlmResult<Storyline>>;
  /** The ending, when the reader asks to wrap: the whole thread in a few beats. */
  writeWrap(ctx: WrapContext): Promise<LlmResult<Card>>;
}
