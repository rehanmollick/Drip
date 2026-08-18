import type { CardSummary, WriteContext } from "@/lib/llm-types";
import { CardBatchSchema, PROSE_CARD_TYPES, VISUAL_CARD_TYPES, type CardType } from "@/lib/schemas/cards";
import type { Persona } from "@/lib/schemas/plan";
import type { Theme } from "@/lib/schemas/theme";
import {
  BASE_CARD_FIELDS, HOW_TO_EXPLAIN, JSON_ONLY, NO_ASSUMING, PRIME_DIRECTIVE, SHOW_DONT_TELL,
  VOICE_IN_THE_SENTENCE, WRITER_RULES, bullets, cardSchemaBlock, difficultyDirective, dueBlock,
  glossaryBlock, learnerSummary, personaBlock, recentTypesBlock, sliceCorpus, storylineBlock,
  themeGroundingBlock, type Prompt,
} from "./shared";

export const PROMPT_VERSION = "write.v5";

/** Corpus budget for one writer call (chars). The caller already slices per node; this is a hard ceiling. */
export const WRITE_CORPUS_CHARS = 12_000;
export const TEASER_CORPUS_CHARS = 2_000;

const OUTPUT_HINT = `output: {"cards":[ …card objects… ]}. schema for the wrapper: ${JSON.stringify({ type: "object", properties: { cards: { type: "array", minItems: 1, maxItems: 8, items: { $ref: "#card" } } }, required: ["cards"] })}`;

const VISUAL_LIST = VISUAL_CARD_TYPES.join(" / ");
const PROSE_LIST = PROSE_CARD_TYPES.map((t) => `"${t}"`).join(" or ");

const CRAFT = `craft:
- lead with tension. a hook opens; a stat lands a number; a diagram draws a mechanism; a bet or a slider makes them feel it; a reveal pays off; an "open" makes them say it back; a checkpoint flexes.
- mix shapes hard. never the same type twice in a row, and never two prose cards (${PROSE_LIST}) in a row — that is the paragraph deck, and it is the thing readers quit over.
- write from the source. quote numbers, names, and specifics from it. when you must go beyond it, say "the source doesn't cover this, but generally…" and set eyebrow "off-source".
- continuity: read the recent-card summaries and the through-line. do not repeat their claims, examples, or metaphors. build on them.
- every string fits its cap. shorter is better. one idea per card. lowercase.
- visuals: only the schema-listed kinds; icons from the allowed icon list.
- anchors: stamp "anchor" on every card, and REUSE the slug an idea already has (the recent ones are listed in the user turn) rather than coining a second one. it is invisible to the reader and it is what lets a card come back to an idea instead of re-teaching it.
- a callback is a bet, not a reminder. when you come back to an older idea, it arrives in a new shape and never says that it is coming back.`;

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
    SHOW_DONT_TELL,
    NO_ASSUMING,
    HOW_TO_EXPLAIN,
    VOICE_IN_THE_SENTENCE,
    CRAFT,
    BASE_CARD_FIELDS,
    cardSchemaBlock(allowedTypes),
    JSON_ONLY,
    OUTPUT_HINT,
  ].join("\n\n");
}

function recentBlock(recent: CardSummary[]): string {
  if (!recent.length) return `recent cards: none yet — this is the opening.`;
  const rows = bullets(recent.map((r) => `${r.type}: ${r.gist}${r.anchor ? ` [anchor: ${r.anchor}]` : ""}${r.metaphor ? ` [metaphor: ${r.metaphor}]` : ""}`));
  const anchors = Array.from(new Set(recent.map((r) => r.anchor).filter(Boolean)));
  const reuse = anchors.length
    ? `\nthe anchors above are the slugs already in play: ${anchors.join(", ")}. a card about one of those ideas carries the SAME slug — never a new spelling of it.`
    : "";
  return `recent cards (most recent last; do NOT repeat these):\n${rows}${reuse}`;
}

/**
 * The glossary ledger: whole-session when the caller has it, otherwise whatever the recent
 * summaries carry. The fallback matters — a writer that re-glosses "diction" every six cards is
 * spending the same screen twice, and the recent window is the part we always have.
 */
function glossedFor(ctx: WriteContext): string[] {
  if (ctx.glossedTerms?.length) return ctx.glossedTerms;
  return ctx.recent.flatMap((r) => r.terms ?? []);
}

function metaphorBlock(used: string[]): string {
  return `metaphors already used (NEVER reuse any of these; find a new one):\n${bullets(used)}`;
}

/** Which shapes are actually on the table for this call. */
function availability(allowed: readonly CardType[]) {
  const has = (t: CardType) => allowed.includes(t);
  return {
    has,
    visual: VISUAL_CARD_TYPES.filter(has),
    interactive: (["binary", "predict", "sequence", "slider"] as const).filter(has),
    open: has("open"),
  };
}

/**
 * The batch-composition contract. This is the concrete form of "show, don't tell":
 * it names what has to be in the batch rather than hoping the doctrine sticks.
 */
function batchShape(ctx: WriteContext, n: number): string {
  const a = availability(ctx.allowedTypes);
  const wantVisual = Math.min(2, Math.max(1, Math.floor(n / 2)));
  // a one- or two-card batch can't carry a visual, an interactive AND an "explain it back" beat.
  const openDue = a.open && n >= 3 && !(ctx.recentTypes ?? []).includes("open");
  const lines = [
    `batch shape — this is the part that decides whether the feed is good:`,
    a.visual.length
      ? `- LEAD with the most concrete thing this node has. a number → "stat". a mechanism → "diagram". an order → "sequence". real code → "code". a relationship you feel by moving it → "slider". and when the material has none of those — a passage, an argument, a ruling, a movement — real lines worth hunting through → "spot", two positions that disagree → "diagram" variant "compare", something that shifts over time → "scrub". your first card is NOT a "concept".`
      : `- LEAD with the most concrete thing this node has — the surprising claim, the twist, the number in the copy. your first card is NOT a "concept".`,
    a.visual.length ? `- at least ${wantVisual === 1 ? "ONE card" : `${wantVisual} cards`} of ${VISUAL_LIST} in this batch. these are the cards that don't read like a wall.` : null,
    `- at most ONE "concept" card here, and only if the point is genuinely none of the shapes above. if you write it, it carries a "visual" and it is under 55 words.`,
    `- never two prose cards (${PROSE_LIST}) in a row.`,
    n > 2 ? `- ${Math.min(n, 4)} different types in ${n} cards. no type twice in a row.` : null,
    a.open
      ? openDue
        ? `- include ONE "open" card: they type the idea back in their own words. put it AFTER the idea has landed, never first. this is the beat readers ask for.`
        : `- an "open" card already went by recently — only add another if this node lands a genuinely new idea worth saying back.`
      : null,
    `- glossary: any word a curious outsider wouldn't have goes in that card's "terms" (max 3), or gets glossed inline in ≤ 6 words. never both, never neither.`,
  ];
  return lines.filter(Boolean).join("\n");
}

function modeInstructions(ctx: WriteContext): string {
  const n = ctx.batchSize;
  const node = ctx.node;
  const chill = ctx.settings.chillMode || ctx.learnerState.prefs.chillMode;
  const wantsCheckpoint = ctx.extraDirectives.some((d) => /checkpoint/i.test(d));
  const missed = ctx.missedConcepts ?? [];
  const a = availability(ctx.allowedTypes);
  const interactiveAllowed = a.interactive.length > 0;

  switch (ctx.mode) {
    case "normal": {
      const lines = [
        `mode: normal. write EXACTLY ${n} cards for the outline node "${node?.title ?? "(current)"}" (topicNodeId "${node?.id ?? "n1"}").`,
        node?.brief ? `what this node must land: ${node.brief}` : null,
        node?.corpusHint ? `where it lives in the source: ${node.corpusHint}` : null,
        batchShape(ctx, n),
        chill || !interactiveAllowed
          ? `chill mode: no bets, no sliders — pace with stats, diagrams, code, reveals, hooks.`
          : `include at least ONE interactive (${a.interactive.join("/")}), disguised as content.`,
        `over the life of a node, land at least one code card (when the subject has code) and one diagram card. if the recent shapes had neither, that's this batch.`,
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
        `the concept card carries a "visual" and stays under 40 words — it's a teaser, not the explanation.`,
      ].join("\n");
    case "resurface":
      return [
        `mode: resurface. the outline is done; the feed never ends. write EXACTLY ${n} cards that resurface near-misses as FRESH bets — new framing, new examples, never the earlier wording.`,
        `near-miss concepts to resurface: ${missed.length ? missed.join("; ") : "(use the recent summaries to pick what wobbled)"}.`,
        interactiveAllowed && !chill
          ? `use ${a.interactive.join("/")} for the bets${a.open ? ` and one "open" if the idea is worth saying back in their own words` : ""}; one concept card may set up a bet if it needs it.`
          : `chill mode: resurface as reveals, stats and concept re-angles instead of bets.`,
        `a resurfaced idea is a NEW shape: if it was a paragraph the first time, it is a stat, a diagram or a bet now.`,
        `topicNodeId "${node?.id ?? "resurface"}".`,
        difficultyDirective(ctx.learnerState),
      ].join("\n");
    case "adjacent":
      return [
        `mode: adjacent waters. the outline is done; offer to go one layer deeper. write EXACTLY 2 cards: 1 "hook" whose headline is an offer like "wanna go one layer deeper into ${node?.title ?? "this"}? keep scrolling" then 1 card that opens that deeper layer — pick its shape from what the layer actually is (a number → "stat", a mechanism → "diagram", otherwise "concept" with a visual).`,
        node?.brief ? `the deeper layer: ${node.brief}` : `pick the most natural next layer from the source and the recent cards.`,
        `topicNodeId "${node?.id ?? "adjacent"}".`,
      ].join("\n");
    case "recap":
      return [
        `mode: recap. they missed the same idea twice (or stalled on it). write EXACTLY 1 "recap" card: headline + 3 beats that re-explain it through a NEW metaphor. never the earlier wording, never a used metaphor.`,
        // beats render as three short lines on one phone screen; long ones fail validation and cost a whole retry
        `each beat is ONE short sentence, 120 characters MAX — count them. this is the shape and length: "a branch is a sticky note with a name on it: move the note, nothing else moves." three beats, three angles, no beat longer than that example by much.`,
        `the idea: ${missed.length ? missed.join("; ") : ctx.learnerState.directives.recapDue ?? node?.title ?? "(see recent cards)"}.`,
        `topicNodeId "${node?.id ?? "recap"}".`,
      ].join("\n");
    case "scaffold":
      return [
        `mode: scaffold. before the next bet, write EXACTLY 1 card that re-angles the missed idea gently. prefer a "diagram" or a "stat" if the idea has a shape or a number in it — the first pass was words and the words didn't land. otherwise a "concept" with a visual.`,
        `concrete, one example, no jargon they haven't earned. put anything they might not know in "terms".`,
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
    storylineBlock(ctx.storyline),
    recentTypesBlock(ctx.recentTypes),
    `learner:\n${learnerSummary(ctx.learnerState)}`,
    dueBlock(ctx.learnerState),
    ctx.extraDirectives.length ? `extra directives:\n${bullets(ctx.extraDirectives)}` : null,
    recentBlock(ctx.recent),
    glossaryBlock(glossedFor(ctx)),
    metaphorBlock(ctx.usedMetaphors),
    `source kind: ${ctx.sourceKind}. grounding slice for this node:\n<<<SOURCE\n${corpus || "(no source text for this node — say so on-screen when you go general, eyebrow \"off-source\")"}\nSOURCE>>>`,
    `now emit {"cards":[…]} — exactly the count asked for. before you emit, two passes: (1) if more than one card is a headline plus a paragraph, rewrite it as a stat, a diagram, a sequence, a spot, a scrub or a reveal — "there was nothing to draw" is never the reason, there is always a shape. (2) count the longest string on each card against its cap and cut it back, because a card over a cap is a card the reader never sees.`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}

/** Exposed for tests + llm.ts: the schema a write call validates against. */
export const WRITE_OUTPUT_SCHEMA = CardBatchSchema;
