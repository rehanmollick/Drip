# CLAUDE.md — DRIP

DRIP: TikTok's format, a great teacher's brain. Paste anything → an infinite, adaptive, snap-scrolling feed that teaches it. `dripSpec.md` is the source of truth; this file is the working contract for anyone (human or Claude) touching the code.

## 0. The Prime Directive

> **Does this feel like a feed I opened to kill time, or a course I enrolled in?**

If it feels like a course, it is wrong.

1. **Never use school vocabulary on screen.** Banned in any user-facing string: `quiz, test, lesson, module, objective, curriculum, assessment, exam, chapter, homework, syllabus` (word-boundary, case-insensitive; enforced by `lib/copy/banned.ts` + tests). Fine in code and identifiers.
2. **Every card is complete on its own screen.** No scrolling within a card. Too much content → two cards.
3. **The feed never dead-ends and never shows a spinner mid-scroll.** Buffered generation makes waiting invisible; the only "waiting" surface is a themed `notice` card.
4. **Interactions are disguised as content.** Question cards read like hot takes or bets.
5. **Progress reads like flexing, not grading.** Never "3/47", never "80%". Checkpoints say "you now know more about X than most Y".
6. **Motion is juice.** Snap physics, springs, tactile taps. Exact values in spec §5.

## 1. Architecture rules

- **AI fills schemas, components render them. The AI never generates markup.** Every card is JSON validated by `CardSchema` (`lib/schemas/cards.ts`) before anything renders. Invalid → regenerate once with the Zod error appended → second failure inserts one `fallback` card and logs raw output. The feed cannot crash on content.
- **One-file LLM rule.** `lib/llm.ts` is the ONLY file that imports `@anthropic-ai/sdk`. Every call: spend-cap check (fails closed) → call → log to `llm_calls` → Zod validate → retry once → return or fallback. `ANTHROPIC_API_KEY` exists only in server env; all model calls happen in API routes.
- **Prompts** live as versioned `.ts` files in `lib/prompts/`; each exports `PROMPT_VERSION`, logged with every call.
- **Response envelope everywhere:** `{ data, error, meta }` (`lib/api/envelope.ts`). Route handlers are wrapped in `handle()`; thrown errors become enveloped errors. One error grammar.
- **Failure as data.** Generation returns `{ ok: false, fallbackCard }`, never throws across the feed boundary.
- **Idempotent generation.** Frontier-keyed batches (`batches` table); duplicate triggers return the in-flight/done batch. Never cache a failure — only validated batches persist.
- **Versioned everything.** `CARD_SCHEMA_VERSION` in cache keys (`cardbatch:v{N}:{sessionId}:{nodeId}:{stateHash}`), `PROMPT_VERSION` in logs, `learnerState.version` in the blob. Bump `CARD_SCHEMA_VERSION` whenever a card schema changes shape.
- **Immutable history.** Viewed cards never change; only unviewed runway regenerates.
- **Themes are CSS variables.** `lib/theme/cssVars.ts` defines the contract (`--bg --ink --ink-2 --accent --accent-alt --accent-ink --accent-soft --surface --line --state-correct --state-wrong --font-display --font-body --font-mono`, `data-texture data-motion data-signature`). Components consume ONLY variables. Fonts come from the curated list in `lib/theme/fonts.ts`; the AI cannot invent fonts.
- **Card ordering** uses `fractional-indexing` string keys in `cards.idx` (lexicographic). Detour splices never rewrite rows.
- **Learner state:** always write NEW objects, never mutate in place.
- **Persistence:** `Store` interface (`lib/db/store.ts`). Supabase in production (`supabase/migrations`), local JSON store in `.data/` when Supabase env is absent (dev/tests only). Handle Supabase cold start: retry once after 3s behind the app-shell splash.
- **Dwell timer integrity:** pause on `visibilitychange`/`pagehide`, resume on return, hard-cap any single dwell at 60s.
- **iOS haptics: `navigator.vibrate` does not exist on iOS Safari. Do not use it, do not debug its absence.** Tactility = visual spring (scale 0.97 on press) + optional very quiet Web Audio ticks (init after first interaction, off by default).
- **Standalone PWA is the real target.** `position: fixed` app shell, `100dvh` on the scroll container, `overscroll-behavior-y: contain`, explicit in-app refresh affordance (long-press the progress hairline). Test from the installed home-screen icon, not just the Safari tab.
- **Use these libraries, do not reinvent:** `fractional-indexing`, `@mozilla/readability` + `jsdom`, `youtube-transcript`, `shiki` (server-side, css-variables theme), `next/font` (Google, self-hosted), `framer-motion`, `@tanstack/react-query`, `zod`.

## 2. Autonomous build gating

Phases are built strictly in order (spec §13). A phase is complete only when (a) its Playwright checks pass, (b) a screenshot review at 393×852 (deviceScaleFactor 3) finds no Prime Directive violation, (c) `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass. Log a short self-review note per phase in `BUILD_LOG.md`. Anything only a real device can verify goes in `MANUAL_CHECKLIST.md`.

**Screenshot-and-critique rule:** after ANY visual change, screenshot at 393×852 (iPhone viewport, DSF 3) via Playwright and self-critique against the Prime Directive before proceeding.

Device loop: inner = Playwright headless iPhone viewport; mid = iOS Simulator (`open -a Simulator && xcrun simctl openurl booted http://localhost:3000`) — truthful for layout, not scroll feel; outer = real iPhone installed as PWA via a Vercel preview URL (HTTPS required for SW/installability).

## 3. Commands

```
pnpm dev            # http://localhost:3000
pnpm build && pnpm start
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e       # Playwright (uses LLM_MODE=mock + local store)
```

Env: see `.env.example`. `LLM_MODE=mock` runs the entire pipeline (spend cap, logging, Zod, retries) against deterministic canned output — used by Playwright; never in real use.

## 4. Card + theme schemas (verbatim copy of `lib/schemas/*.ts` at time of writing — the .ts files win if they ever differ)

### lib/schemas/visual.ts
```ts
import { z } from "zod";

/**
 * VisualSpec — the ONLY visual treatments the AI may request on hook/concept/
 * checkpoint cards. No image URLs, no generated images, no markup. The renderer
 * (components/cards/Visual.tsx) knows how to draw exactly these.
 */
export const ICON_NAMES = [
  "bolt", "shield", "cpu", "database", "cloud", "lock", "key", "wave", "leaf",
  "flask", "dna", "brain", "globe", "rocket", "clock", "chart", "code", "branch",
  "server", "network", "fire", "drop", "sun", "moon", "star", "heart", "eye",
  "book", "pen", "mic", "map", "compass", "anchor", "gear", "puzzle", "layers",
  "box", "link", "tag", "flag", "target", "trophy", "warning", "question",
  "check", "x", "arrow", "loop", "scale", "coin", "atom", "wrench", "bug",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const VisualSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("icon"), icon: z.enum(ICON_NAMES) }),
  z.object({
    kind: z.literal("stat"),
    value: z.string().max(12),           // "80%", "3ms", "1.2M"
    label: z.string().max(40),
  }),
  z.object({
    kind: z.literal("ascii"),
    lines: z.array(z.string().max(32)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("spark"),
    values: z.array(z.number()).min(3).max(24),
    label: z.string().max(40).optional(),
  }),
]);
export type VisualSpec = z.infer<typeof VisualSpec>;
```

### lib/schemas/cards.ts
```ts
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
export const CARD_SCHEMA_VERSION = 1;

export const CARD_TYPES = [
  "hook", "concept", "code", "diagram", "binary", "predict", "sequence",
  "slider", "reveal", "checkpoint", "detour_marker", "recap", "fallback",
  // internal additions (not written by the batch writer unless asked):
  "notice",   // budget / offline / catching-up / planning messages, themed, in-feed
  "clarify",  // tap-to-answer setup question when the input sentence is ambiguous
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Card types the writer may produce in a normal batch. */
export const WRITER_CARD_TYPES = [
  "hook", "concept", "code", "diagram", "binary", "predict", "sequence",
  "slider", "reveal", "checkpoint", "recap",
] as const;

/** Interactive types excluded in chill mode. */
export const CHILL_EXCLUDED_TYPES = ["binary", "predict", "sequence", "slider"] as const;

/** Types whose result feeds calibration (hit/miss). */
export const SCORED_TYPES = ["binary", "predict", "sequence"] as const;

const Difficulty = z.number().min(1).max(5);

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

/** The writer returns a batch of cards; we validate the array as a whole. */
export const CardBatchSchema = z.object({ cards: z.array(CardSchema).min(1).max(8) });

export function isInteractive(card: Card): boolean {
  return card.type === "binary" || card.type === "predict" || card.type === "sequence" || card.type === "slider";
}
export function isScored(card: Card): boolean {
  return card.type === "binary" || card.type === "predict" || card.type === "sequence";
}
```

### lib/schemas/theme.ts
```ts
import { z } from "zod";

/**
 * Per-session visual identity. Generated by the planner from the SUBJECT's own
 * world. All values become CSS custom properties on the feed root
 * (lib/theme/cssVars.ts); components consume ONLY the variables.
 */
export const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "hex color");

/**
 * Curated, self-hosted font list (next/font/google, loaded in lib/theme/fonts.ts).
 * The AI picks from these; it cannot invent fonts. Keys are the values the
 * planner emits; each maps to a CSS variable exported by fonts.ts.
 */
export const DISPLAY_FONTS = [
  "space-grotesk",       // grotesk, technical
  "bricolage-grotesque", // grotesk with character
  "syne",                // wide, art-school
  "unbounded",           // heavy, poster
  "fraunces",            // soft editorial serif
  "playfair-display",    // high-contrast editorial serif
  "instrument-serif",    // elegant, narrow serif
  "zilla-slab",          // slab
  "dm-sans",             // clean geometric humanist
  "manrope",             // rounded-geometric
  "nunito",              // rounded, friendly
] as const;

export const BODY_FONTS = [
  "dm-sans", "ibm-plex-sans", "manrope", "nunito", "source-serif-4",
  "fraunces", "zilla-slab", "space-grotesk", "bricolage-grotesque",
] as const;

export const MONO_FONTS = ["jetbrains-mono", "ibm-plex-mono", "fira-code"] as const;

export const ALL_FONTS = Array.from(new Set([...DISPLAY_FONTS, ...BODY_FONTS, ...MONO_FONTS]));
export type FontKey = (typeof ALL_FONTS)[number];

export const TEXTURES = ["none", "grain", "grid", "scanlines", "dots"] as const;
export const MOTIONS = ["snappy", "fluid", "mechanical", "bouncy"] as const;

export const ThemeSchema = z.object({
  name: z.string().max(40),                     // "terminal noir", "field notes"
  mood: z.string().max(120),                    // one-line art direction, must justify itself from the subject
  bg: z.object({
    base: Hex,
    gradientTo: Hex.optional(),
    texture: z.enum(TEXTURES),
  }),
  ink: z.object({ primary: Hex, secondary: Hex }),
  accent: Hex,                                  // exactly ONE accent color
  accentAlt: Hex.optional(),                    // only for correct/incorrect states
  display: z.enum(DISPLAY_FONTS),
  body: z.enum(BODY_FONTS),
  mono: z.enum(MONO_FONTS),
  motion: z.enum(MOTIONS),
  signature: z.string().max(160),               // ONE distinctive device, appears on hooks + checkpoints
  signatureKind: z.enum([
    "hex-addresses",     // section numbers rendered as hex addresses
    "water-lines",       // accent underlines drawn like water levels
    "cursor-blink",      // cursor blink on hook headlines
    "stamp",             // rubber-stamp eyebrow badge
    "ticker",            // scrolling ticker strip under headline
    "ruled-notes",       // ruled paper lines behind hooks
    "waveform",          // audio waveform bar under headline
    "constellation",     // dotted constellation behind headline
    "brackets",          // heavy typographic brackets framing headline
    "underline-sweep",   // accent underline sweeps in
  ]).default("underline-sweep"),
});
export type Theme = z.infer<typeof ThemeSchema>;
```

### lib/schemas/plan.ts, learner.ts, session.ts
See the files — planner output (`{title, theme, persona, outline, clarifiers, firstCards}`), triage output (`inline | detour`), learner state (calibration target ~80% hit rate; >90% over last 10 → +1 difficulty + curveballs; <65% → −1 + scaffold; two consecutive misses on one concept → `recap` card; median dwell <1.8s over 5+ non-interactive cards → compress; dwell >25s or scroll-up → recap), session/card/detour/batch/llm_call rows.

## 5. Model policy

`LLM_PLAN_MODEL` (default `claude-sonnet-4-6`) for planning/theming; `LLM_WRITE_MODEL` (default `claude-haiku-4-5`) for card writing, triage, detours. Daily cap `LLM_DAILY_CALL_CAP` (default 500) computed from `llm_calls`; fails closed. When the cap hits mid-session the next card is a themed `notice` in the persona's voice ("we hit today's budget. resets at midnight. go touch grass, legend.").
