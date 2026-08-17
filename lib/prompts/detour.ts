import type { DetourContext } from "@/lib/llm-types";
import { bullets, difficultyDirective, jsonForPrompt, learnerSummary, sliceCorpus, type Prompt } from "./shared";
import { WRITE_CORPUS_CHARS, buildWriteSystem } from "./write";

export const PROMPT_VERSION = "detour.v1";

/**
 * Detour writer: same system prompt as the batch writer (persona + theme +
 * rules + schemas — so it shares the prompt cache), with detour-specific
 * instructions in the user turn.
 */
export function buildDetourPrompt(ctx: DetourContext): Prompt {
  const system = buildWriteSystem(ctx.persona, ctx.theme, ctx.allowedTypes);
  const chill = ctx.settings.chillMode || ctx.learnerState.prefs.chillMode;
  const interactiveAllowed = ctx.allowedTypes.some((t) => t === "binary" || t === "predict" || t === "sequence" || t === "slider");
  const topicNodeId = ctx.currentCard.topicNodeId;

  const user = [
    `mode: detour. someone paused on a card and asked a question. write EXACTLY ${ctx.cardCount} cards that answer it as a mini-thread spliced right after the card they're on.`,
    `their question: ${ctx.question}`,
    `what the detour must land (focus): ${ctx.focus}`,
    `the card they were on when they asked: ${jsonForPrompt(ctx.currentCard, 2_000)}`,
    [
      `shape:`,
      `- the FIRST card answers the question directly — a "concept" (or a "hook" whose headline IS the answer, when the answer is one bold line). no throat-clearing.`,
      `- then mixed types that deepen it: diagram/code when the answer has structure, a reveal for the twist${interactiveAllowed && !chill ? `, and one bet (binary/predict) near the end so the answer sticks` : ` (chill mode: no bets)`}.`,
      `- the last card leaves them clear, not with a cliffhanger — the main thread resumes after this.`,
      `- asking about this implies it needs reinforcement: keep it concrete, one example, no jargon they haven't earned.`,
    ].join("\n"),
    `set on every card: "topicNodeId": "${topicNodeId}", "detourId": "${ctx.detourId}".`,
    `allowed card types for this call: ${ctx.allowedTypes.join(", ")}.`,
    difficultyDirective(ctx.learnerState),
    `learner:\n${learnerSummary(ctx.learnerState)}`,
    ctx.extraDirectives.length ? `extra directives:\n${bullets(ctx.extraDirectives)}` : null,
    ctx.recent.length ? `recent cards (do NOT repeat):\n${bullets(ctx.recent.map((r) => `${r.type}: ${r.gist}${r.metaphor ? ` [metaphor: ${r.metaphor}]` : ""}`))}` : null,
    `metaphors already used (never reuse):\n${bullets(ctx.usedMetaphors)}`,
    `source kind: ${ctx.sourceKind}. grounding slice:\n<<<SOURCE\n${sliceCorpus(ctx.corpusSlice, WRITE_CORPUS_CHARS) || "(no source text — say so on-screen when you go general, eyebrow \"off-source\")"}\nSOURCE>>>`,
    `now emit {"cards":[…]} — exactly ${ctx.cardCount} cards.`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}
