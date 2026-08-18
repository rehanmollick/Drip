import type { DetourContext } from "@/lib/llm-types";
import {
  bullets, cardForPrompt, difficultyDirective, learnerSummary, recentTypesBlock, sliceCorpus,
  storylineBlock, type Prompt,
} from "./shared";
import { WRITE_CORPUS_CHARS, buildWriteSystem } from "./write";

export const PROMPT_VERSION = "detour.v2";

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
    `the card they were on when they asked: ${cardForPrompt(ctx.currentCard, 2_000)}`,
    [
      `shape:`,
      `- the FIRST card answers the question directly — a "concept" (or a "hook" whose headline IS the answer, when the answer is one bold line, or a "stat" when the answer IS a number). no throat-clearing.`,
      `- then mixed shapes that deepen it: "diagram"/"code" when the answer has structure, "stat" when it has a number, a "reveal" for the twist${interactiveAllowed && !chill ? `, and one bet (binary/predict) near the end so the answer sticks` : ` (chill mode: no bets)`}.`,
      `- never two prose cards (concept/recap) in a row. a detour that is three paragraphs is a worse answer than two pictures.`,
      `- the last card leaves them clear, not with a cliffhanger — the main thread resumes after this.`,
      `- asking about this implies it needs reinforcement: keep it concrete, one example, no jargon they haven't earned. anything they might not know goes in that card's "terms".`,
    ].join("\n"),
    `set on every card: "topicNodeId": "${topicNodeId}", "detourId": "${ctx.detourId}".`,
    `allowed card types for this call: ${ctx.allowedTypes.join(", ")}.`,
    difficultyDirective(ctx.learnerState),
    storylineBlock(ctx.storyline),
    recentTypesBlock(ctx.recentTypes),
    `learner:\n${learnerSummary(ctx.learnerState)}`,
    ctx.extraDirectives.length ? `extra directives:\n${bullets(ctx.extraDirectives)}` : null,
    ctx.recent.length ? `recent cards (do NOT repeat):\n${bullets(ctx.recent.map((r) => `${r.type}: ${r.gist}${r.metaphor ? ` [metaphor: ${r.metaphor}]` : ""}`))}` : null,
    `metaphors already used (never reuse):\n${bullets(ctx.usedMetaphors)}`,
    `source kind: ${ctx.sourceKind}. grounding slice:\n<<<SOURCE\n${sliceCorpus(ctx.corpusSlice, WRITE_CORPUS_CHARS) || "(no source text — say so on-screen when you go general, eyebrow \"off-source\")"}\nSOURCE>>>`,
    `now emit {"cards":[…]} — exactly ${ctx.cardCount} cards.`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}
