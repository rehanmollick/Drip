import type { CardSummary, WriteContext } from "@/lib/llm-types";
import { CardBatchSchema, type CardType } from "@/lib/schemas/cards";
import type { Persona } from "@/lib/schemas/plan";
import type { Theme } from "@/lib/schemas/theme";
import {
  BASE_CARD_FIELDS, JSON_ONLY, PRIME_DIRECTIVE, WRITER_RULES, bullets, cardSchemaBlock, difficultyDirective,
  learnerSummary, personaBlock, sliceCorpus, themeGroundingBlock, type Prompt,
} from "./shared";

export const PROMPT_VERSION = "write.v1";

/** Corpus budget for one writer call (chars). The caller already slices per node; this is a hard ceiling. */
export const WRITE_CORPUS_CHARS = 12_000;
export const TEASER_CORPUS_CHARS = 2_000;

const OUTPUT_HINT = `output: {"cards":[ …card objects… ]}. schema for the wrapper: ${JSON.stringify({ type: "object", properties: { cards: { type: "array", minItems: 1, maxItems: 8, items: { $ref: "#card" } } }, required: ["cards"] })}`;

const CRAFT = `craft:
- lead with tension. a hook opens; concepts land ONE idea each; a bet or a slider makes them feel it; a reveal pays off; a checkpoint flexes.
- mix types. never two identical types back-to-back unless asked. never a wall of concept cards.
- write from the source. quote numbers, names, and specifics from it. when you must go beyond it, say "the source doesn't cover this, but generally…" and set eyebrow "off-source".
- continuity: read the recent-card summaries; do not repeat their claims, examples, or metaphors. build on them.
- every string fits its cap. shorter is better. one idea per card. lowercase.
- visuals: only the schema-listed kinds; icons from the allowed icon list.`;

/**
 * System prompt: persona + theme are stapled in (grounding — callers can never
 * remove them). Byte-stable per session so it prompt-caches across batches.
 */
export function buildWriteSystem(
  persona: Persona,
  theme: Pick<Theme, "name" | "mood" | "signature">,
  allowedTypes: readonly CardType[],
): string {
  return [
    `you are the writer for DRIP — tiktok's format, a great teacher's brain. you turn a source into full-screen, snap-scrolling cards. you write JSON only; the app renders it.`,
    personaBlock(persona),
    themeGroundingBlock(theme),
    PRIME_DIRECTIVE,
    WRITER_RULES,
    CRAFT,
    BASE_CARD_FIELDS,
    cardSchemaBlock(allowedTypes),
      JSON_ONLY,
    OUTPUT_HINT,
  ].join("\n\n");
}

function recentBlock(recent: CardSummary[]): string {
  if (!recent.length) return `recent cards: none yet — this is the opening.`;
  return `recent cards (most recent last; do NOT repeat these):\n${bullets(recent.map((r) => `${r.type}: ${r.gist}${r.metaphor ? ` [metaphor: ${r.metaphor}]` : ""}`))}`;
}

function metaphorBlock(used: string[]): string {
  return `metaphors already used (NEVER reuse any of these; find a new one):\n${bullets(used)}`;
}

function modeInstructions(ctx: WriteContext): string {
  const n = ctx.batchSize;
  const node = ctx.node;
  const chill = ctx.settings.chillMode || ctx.learnerState.prefs.chillMode;
  const wantsCheckpoint = ctx.extraDirectives.some((d) => /checkpoint/i.test(d));
  const missed = ctx.missedConcepts ?? [];
  const interactiveAllowed = ctx.allowedTypes.some((t) => t === "binary" || t === "predict" || t === "sequence" || t === "slider");

  switch (ctx.mode) {
    case "normal": {
      const lines = [
        `mode: normal. write EXACTLY ${n} cards for the outline node "${node?.title ?? "(current)"}" (topicNodeId "${node?.id ?? "n1"}").`,
        node?.brief ? `what this node must land: ${node.brief}` : null,
        node?.corpusHint ? `where it lives in the source: ${node.corpusHint}` : null,
        `mix types from the allowed list. ${chill || !interactiveAllowed ? `chill mode: no bets, no sliders — pace with hooks, reveals, diagrams, code.` : `include at least ONE interactive (binary/predict/sequence/slider), disguised as content.`}`,
        `over the life of a node, include at least one code card (when the subject has code) and one diagram card. if the recent cards had neither, favor one now.`,
        wantsCheckpoint ? `this batch ENDS the node: make the LAST card a "checkpoint" that flexes what they now know in this subject's world ("you now know more about X than most Y").` : null,
        difficultyDirective(ctx.learnerState),
        ctx.learnerState.directives.pace === "compress" ? `pace: compress — bigger claims, fewer words, land the node in fewer cards.` : null,
      ];
      return lines.filter(Boolean).join("\n");
    }
    case "teaser":
      return [
        `mode: teaser. planning is still running; write EXACTLY 2 cards from the first ~2k chars of the source: 1 "hook" then 1 "concept". eyebrow on both: "reading your stuff". topicNodeId "${node?.id ?? "teaser"}".`,
        `tease the single most surprising thing in the excerpt. do not promise structure you can't see yet.`,
      ].join("\n");
    case "resurface":
      return [
        `mode: resurface. the outline is done; the feed never ends. write EXACTLY ${n} cards that resurface near-misses as FRESH bets — new framing, new examples, never the earlier wording.`,
        `near-miss concepts to resurface: ${missed.length ? missed.join("; ") : "(use the recent summaries to pick what wobbled)"}.`,
        interactiveAllowed && !chill
          ? `use binary/predict/sequence for the bets; one concept card may set up a bet if it needs it.`
          : `chill mode: resurface as reveals and concept re-angles instead of bets.`,
        `topicNodeId "${node?.id ?? "resurface"}".`,
        difficultyDirective(ctx.learnerState),
      ].join("\n");
    case "adjacent":
      return [
        `mode: adjacent waters. the outline is done; offer to go one layer deeper. write EXACTLY 2 cards: 1 "hook" whose headline is an offer like "wanna go one layer deeper into ${node?.title ?? "this"}? keep scrolling" then 1 "concept" that opens that deeper layer.`,
        node?.brief ? `the deeper layer: ${node.brief}` : `pick the most natural next layer from the source and the recent cards.`,
        `topicNodeId "${node?.id ?? "adjacent"}".`,
      ].join("\n");
    case "recap":
      return [
        `mode: recap. they missed the same idea twice (or stalled on it). write EXACTLY 1 "recap" card: headline + 3 beats that re-explain it through a NEW metaphor. never the earlier wording, never a used metaphor.`,
        `the idea: ${missed.length ? missed.join("; ") : ctx.learnerState.directives.recapDue ?? node?.title ?? "(see recent cards)"}.`,
        `topicNodeId "${node?.id ?? "recap"}".`,
      ].join("\n");
    case "scaffold":
      return [
        `mode: scaffold. before the next bet, write EXACTLY 1 "concept" card that re-angles the missed idea gently: concrete, one example, no jargon they haven't earned.`,
        `the idea: ${missed.length ? missed.join("; ") : ctx.learnerState.directives.scaffoldNext.join("; ") || node?.title || "(see recent cards)"}.`,
        `topicNodeId "${node?.id ?? "scaffold"}".`,
      ].join("\n");
  }
}

export function buildWritePrompt(ctx: WriteContext): Prompt {
  const system = buildWriteSystem(ctx.persona, ctx.theme, ctx.allowedTypes);
  const corpusCap = ctx.mode === "teaser" ? TEASER_CORPUS_CHARS : WRITE_CORPUS_CHARS;
  const corpus = sliceCorpus(ctx.corpusSlice, corpusCap);

  const user = [
    modeInstructions(ctx),
    `allowed card types for this call: ${ctx.allowedTypes.join(", ")}.`,
    `set on every card: "topicNodeId" as instructed above, "detourId": ${ctx.detourId ? `"${ctx.detourId}"` : "null"}.`,
    `learner:\n${learnerSummary(ctx.learnerState)}`,
    ctx.extraDirectives.length ? `extra directives:\n${bullets(ctx.extraDirectives)}` : null,
    recentBlock(ctx.recent),
    metaphorBlock(ctx.usedMetaphors),
    `source kind: ${ctx.sourceKind}. grounding slice for this node:\n<<<SOURCE\n${corpus || "(no source text for this node — say so on-screen when you go general, eyebrow \"off-source\")"}\nSOURCE>>>`,
    `now emit {"cards":[…]} — exactly the count asked for.`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}

/** Exposed for tests + llm.ts: the schema a write call validates against. */
export const WRITE_OUTPUT_SCHEMA = CardBatchSchema;
