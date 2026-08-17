/**
 * lib/llm.ts — THE ONLY FILE THAT IMPORTS @anthropic-ai/sdk.
 *
 * Every function: spend-cap check (fails closed) → call → log to llm_calls →
 * Zod validate → retry once with the error appended → return LlmResult.
 * Failure is data: nothing here throws across the generation boundary.
 *
 * STUB — real implementation lands with the LLM-layer work package. The
 * signatures below are the contract callers code against (see lib/llm-types.ts).
 */
import type { LlmApi } from "./llm-types";

const notReady = () => Promise.resolve({ ok: false as const, code: "api" as const, error: "llm layer not implemented" });

export const llm: LlmApi = {
  plan: notReady,
  writeBatch: notReady,
  triage: notReady,
  writeDetour: notReady,
  dialToast: async ({ direction }) => (direction === "simpler" ? "say less. rewinding the jargon." : "bet. going a layer deeper."),
};

export const { plan, writeBatch, triage, writeDetour, dialToast } = llm;
