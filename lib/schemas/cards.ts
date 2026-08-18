import { z } from "zod";
import { VisualSpec } from "./visual";

/**
 * Card schemas — THE contract between the AI and the renderer.
 *
 * Every card the writer emits must validate against CardSchema. A batch that
 * fails validation is regenerated once with the Zod error appended to the
 * prompt; a second failure inserts a single `fallback` card and logs the raw
 * output. The feed NEVER renders unvalidated JSON and NEVER crashes on a bad
 * card. The AI NEVER emits HTML/JSX — it fills these schemas, React renders.
 *
 * Bump CARD_SCHEMA_VERSION whenever any schema here changes shape. It is part
 * of every cache key (`cardbatch:v{N}:...`) so stale batches can never be
 * replayed against a renderer that doesn't understand them.
 */
export const CARD_SCHEMA_VERSION = 2;

export const CARD_TYPES = [
  "hook", "concept", "code", "diagram", "binary", "predict", "sequence",
  "slider", "reveal", "checkpoint", "detour_marker", "recap", "fallback",
  "stat",       // one number, huge, with the line that makes it mean something
  "open",       // answer in your own words; the reply speaks to what YOU said
  // internal additions (not written by the batch writer unless asked):
  "notice",     // budget / offline / catching-up / planning messages, themed, in-feed
  "clarify",    // tap-to-answer setup question when the input sentence is ambiguous
  "crossroads", // end of a topic: keep going / go deeper / ask / wrap up — generation waits here
  "wrap",       // the ending you asked for: the whole thread in a few beats
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Card types the writer may produce in a normal batch. */
export const WRITER_CARD_TYPES = [
  "hook", "concept", "code", "diagram", "binary", "predict", "sequence",
  "slider", "reveal", "checkpoint", "recap", "stat", "open",
] as const;

/**
 * Types that carry their idea through something other than a paragraph. Every batch needs one:
 * a deck of headline-plus-prose reads like a wall no matter how good the prose is.
 */
export const VISUAL_CARD_TYPES = ["diagram", "code", "slider", "sequence", "stat"] as const;

/** Prose-forward types — at most two per batch, never two in a row (see lib/generation/variety.ts). */
export const PROSE_CARD_TYPES = ["concept", "recap"] as const;

/** Interactive types excluded in chill mode. */
export const CHILL_EXCLUDED_TYPES = ["binary", "predict", "sequence", "slider", "open"] as const;

/** Types whose result feeds calibration (hit/miss). */
export const SCORED_TYPES = ["binary", "predict", "sequence", "open"] as const;

const Difficulty = z.number().min(1).max(5);

/**
 * Inline glossary. The writer marks up to 3 terms it used that a newcomer might not have; the
 * renderer underlines each occurrence in the card's copy and a tap shows the gloss. This is how
 * a card can avoid assuming knowledge WITHOUT spending its word budget defining things.
 */
export const GlossTerm = z.object({
  term: z.string().max(32),
  gloss: z.string().max(140),
});
export const Terms = z.array(GlossTerm).max(3);

export const BaseCard = z.object({
  id: z.uuid(),
  type: z.enum(CARD_TYPES),
  topicNodeId: z.string(),          // which outline node this serves ("clarify" / "system" for non-outline cards)
  detourId: z.string().nullable(),  // non-null inside a question detour
  eyebrow: z.string().max(28).optional(), // tiny label, e.g. "the footgun"
});

export const HookCard = BaseCard.extend({
  type: z.literal("hook"),
  headline: z.string().max(90),     // one bold claim/question, huge type
  sub: z.string().max(120).optional(),
  visual: VisualSpec.optional(),
});

export const ConceptCard = BaseCard.extend({
  type: z.literal("concept"),
  headline: z.string().max(64),
  body: z.string().max(320),        // ~55 words hard cap
  visual: VisualSpec.optional(),
  terms: Terms.optional(),
});

/** Server-side shiki output, attached AFTER validation, before persistence. */
export const HighlightToken = z.object({ t: z.string(), c: z.string().optional() }); // text, css color (var(--shiki-*))
export const HighlightedLine = z.array(HighlightToken);

export const CodeCard = BaseCard.extend({
  type: z.literal("code"),
  title: z.string().max(48).optional(),
  lang: z.string().max(24),         // shiki language id ("ts", "python", "bash", "sql"...)
  code: z.string().max(1200),       // must fit one phone viewport (~14 lines)
  annotations: z.array(z.object({
    line: z.number().int().min(1),  // 1-based line number in `code`
    note: z.string().max(160),
  })).max(8),
  highlighted: z.array(HighlightedLine).optional(), // filled by lib/highlight.ts, never by the AI
});

export const DIAGRAM_VARIANTS = ["flow", "boxes", "timeline", "compare", "cycle", "layers"] as const;

export const DiagramCard = BaseCard.extend({
  type: z.literal("diagram"),
  variant: z.enum(DIAGRAM_VARIANTS),
  title: z.string().max(48),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string().max(24),
    sub: z.string().max(40).optional(),
    emphasis: z.boolean().optional(),
  })).min(2).max(8),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().max(20).optional(),
  })).max(12),
  tapNotes: z.record(z.string(), z.string().max(160)).optional(), // nodeId -> note
});

export const BinaryCard = BaseCard.extend({
  type: z.literal("binary"),
  prompt: z.string().max(140),      // reads like a hot take
  options: z.tuple([z.string().max(40), z.string().max(40)]),
  correctIndex: z.union([z.literal(0), z.literal(1)]),
  revealCopy: z.string().max(240),  // the payoff after tapping (wrong tap still teaches)
  difficulty: Difficulty,
});

export const PredictCard = BaseCard.extend({
  type: z.literal("predict"),
  prompt: z.string().max(140),      // "what happens next?"
  options: z.array(z.string().max(40)).min(2).max(4),
  correctIndex: z.number().int().min(0).max(3),
  revealHeadline: z.string().max(64),   // shown on the NEXT slide
  revealBody: z.string().max(240),
  difficulty: Difficulty,
});

export const SequenceCard = BaseCard.extend({
  type: z.literal("sequence"),
  prompt: z.string().max(120),
  items: z.array(z.object({ id: z.string(), label: z.string().max(40) })).min(3).max(6), // in CORRECT order; client shuffles
  revealCopy: z.string().max(240),
  difficulty: Difficulty,
});

export const SliderCard = BaseCard.extend({
  type: z.literal("slider"),
  prompt: z.string().max(120),
  label: z.string().max(40),        // what the slider controls ("requests/sec")
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  defaultValue: z.number(),
  unit: z.string().max(12).optional(),
  // Safe expression in `x`. Evaluated by lib/expr.ts (no eval). Allowed:
  // numbers, x, + - * / ^ %, parentheses, sqrt log ln exp abs min max pow floor ceil round sin cos.
  expression: z.string().max(120),
  outputLabel: z.string().max(40),
  outputUnit: z.string().max(12).optional(),
  outputFormat: z.enum(["number", "int", "percent", "currency", "ms", "compact"]).default("number"),
  insight: z.string().max(200).optional(), // one line that reframes what the user just felt
});

export const RevealCard = BaseCard.extend({
  type: z.literal("reveal"),
  setup: z.string().max(140),       // one setup line
  payoff: z.string().max(240),      // hidden until tap
  visual: VisualSpec.optional(),
  terms: Terms.optional(),
});

export const CheckpointCard = BaseCard.extend({
  type: z.literal("checkpoint"),
  headline: z.string().max(80),     // flex copy: "you now know more about X than most Y"
  sub: z.string().max(160).optional(),
  stat: z.object({ value: z.string().max(12), label: z.string().max(40) }).optional(),
  visual: VisualSpec.optional(),
});

export const DetourMarkerCard = BaseCard.extend({
  type: z.literal("detour_marker"),
  kind: z.enum(["open", "close"]),
  question: z.string().max(140).optional(), // the user's question (open marker)
  label: z.string().max(60),                // "detour: your question" / "back to the main thread"
});

export const RecapCard = BaseCard.extend({
  type: z.literal("recap"),
  headline: z.string().max(64),
  beats: z.tuple([z.string().max(120), z.string().max(120), z.string().max(120)]),
  metaphor: z.string().max(80).optional(), // the NEW metaphor used (never repeat a prior one)
});

export const StatCard = BaseCard.extend({
  type: z.literal("stat"),
  value: z.string().max(12),          // "80%", "3ms", "1.2M" — rendered huge
  unit: z.string().max(12).optional(),
  label: z.string().max(48),          // what the number IS
  context: z.string().max(160),       // the line that makes it land ("that's 10x fewer db reads")
  compare: z.object({                 // optional second bar for scale
    value: z.string().max(12),
    label: z.string().max(40),
  }).optional(),
  terms: Terms.optional(),
});

/**
 * Answer in your own words. The reply is written against WHAT YOU SAID, which is the closest
 * this format gets to being asked to explain something back.
 */
export const OpenCard = BaseCard.extend({
  type: z.literal("open"),
  prompt: z.string().max(160),
  placeholder: z.string().max(48).optional(),
  /** For the grader only, never on screen: what a good answer contains. */
  rubric: z.string().max(240),
  /** Shown if they'd rather not type — the answer they can compare against. */
  modelAnswer: z.string().max(280),
  difficulty: Difficulty,
  terms: Terms.optional(),
});

/**
 * End of a topic. Generation STOPS here until the reader picks — the feed asks instead of
 * running on forever (and this is where "am I still on the same thing?" gets answered).
 */
export const CROSSROADS_CHOICES = ["continue", "deeper", "ask", "wrap"] as const;
export const CrossroadsCard = BaseCard.extend({
  type: z.literal("crossroads"),
  finished: z.string().max(60),           // the topic just closed, in its own words
  upNext: z.string().max(60).nullable(),  // the next topic, or null when the outline is done
  headline: z.string().max(80),           // "that's the scheduler. where to?"
  choices: z.array(z.object({
    kind: z.enum(CROSSROADS_CHOICES),
    label: z.string().max(40),            // "keep going" / "one layer deeper" / "ask something" / "wrap it up"
  })).min(2).max(4),
});

/** The ending, when it's asked for: the whole thread in a few beats. Never auto-inserted. */
export const WrapCard = BaseCard.extend({
  type: z.literal("wrap"),
  headline: z.string().max(80),
  beats: z.array(z.string().max(120)).min(3).max(5),
  stat: z.object({ value: z.string().max(12), label: z.string().max(40) }).optional(),
  openThread: z.string().max(140).optional(),  // the thing left unexplored, as an invitation
});

export const FallbackCard = BaseCard.extend({
  type: z.literal("fallback"),
  reason: z.string().max(200).optional(),   // internal; never shown verbatim
  retryable: z.boolean().default(true),
  retryKey: z.string().optional(),          // frontier key to retry
});

export const NoticeCard = BaseCard.extend({
  type: z.literal("notice"),
  kind: z.enum(["budget", "catching_up", "offline", "planning", "error"]),
  headline: z.string().max(80),
  body: z.string().max(200).optional(),
});

export const ClarifyCard = BaseCard.extend({
  type: z.literal("clarify"),
  key: z.string().max(40),                  // stable key the planner uses to refine ("audience", "angle"...)
  prompt: z.string().max(140),
  options: z.array(z.string().max(40)).min(2).max(3),
});

export const CardSchema = z.discriminatedUnion("type", [
  HookCard, ConceptCard, CodeCard, DiagramCard, BinaryCard, PredictCard,
  SequenceCard, SliderCard, RevealCard, CheckpointCard, DetourMarkerCard,
  RecapCard, FallbackCard, NoticeCard, ClarifyCard,
  StatCard, OpenCard, CrossroadsCard, WrapCard,
]);
export type Card = z.infer<typeof CardSchema>;
export type CardOf<T extends CardType> = Extract<Card, { type: T }>;

export type HookCard = z.infer<typeof HookCard>;
export type ConceptCard = z.infer<typeof ConceptCard>;
export type CodeCard = z.infer<typeof CodeCard>;
export type DiagramCard = z.infer<typeof DiagramCard>;
export type BinaryCard = z.infer<typeof BinaryCard>;
export type PredictCard = z.infer<typeof PredictCard>;
export type SequenceCard = z.infer<typeof SequenceCard>;
export type SliderCard = z.infer<typeof SliderCard>;
export type RevealCard = z.infer<typeof RevealCard>;
export type CheckpointCard = z.infer<typeof CheckpointCard>;
export type DetourMarkerCard = z.infer<typeof DetourMarkerCard>;
export type RecapCard = z.infer<typeof RecapCard>;
export type FallbackCard = z.infer<typeof FallbackCard>;
export type NoticeCard = z.infer<typeof NoticeCard>;
export type ClarifyCard = z.infer<typeof ClarifyCard>;
export type StatCard = z.infer<typeof StatCard>;
export type OpenCard = z.infer<typeof OpenCard>;
export type CrossroadsCard = z.infer<typeof CrossroadsCard>;
export type WrapCard = z.infer<typeof WrapCard>;
export type GlossTerm = z.infer<typeof GlossTerm>;

/** The writer returns a batch of cards; we validate the array as a whole. */
export const CardBatchSchema = z.object({ cards: z.array(CardSchema).min(1).max(8) });

export function isInteractive(card: Card): boolean {
  return card.type === "binary" || card.type === "predict" || card.type === "sequence" || card.type === "slider" || card.type === "open";
}
export function isScored(card: Card): boolean {
  return card.type === "binary" || card.type === "predict" || card.type === "sequence" || card.type === "open";
}
