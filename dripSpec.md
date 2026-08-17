# DRIP — Full Product Spec & Build Plan (v1.1)
### (working name; rename freely)

> v1.1 changes: YouTube ingestion added (raw video files stay v2); iOS haptics corrected (no vibration API on iOS Safari); standalone-PWA testing requirements; fast-path first cards on session start; dwell-timer visibility guard; new Section 15 (tooling: MCPs, libraries, device-testing workflow).

**One-liner:** TikTok's format, a great teacher's brain. Paste anything (a sentence, a doc dump, a URL, a repo, a lecture transcript) and get an infinite, adaptive, snap-scrolling feed that teaches it, with visuals tailored to the subject.

**This document is the source of truth.** It is written to be handed to Claude Code. Build exactly this. Where a detail is unspecified, choose the option that maximizes the "this feels like TikTok, not a course" test.

---

## 0. THE PRIME DIRECTIVE (read before anything else)

Every decision, from copy to animation curves to quiz design, is judged against one test:

> **Does this feel like a feed I opened to kill time, or a course I enrolled in?**

If it feels like a course, it is wrong. Concrete implications:

1. **Never use school vocabulary on screen.** Banned words in any user-facing string: quiz, test, lesson, module, objective, curriculum, assessment, exam, chapter, homework, syllabus. In code these words are fine; on screen, never.
2. **Every card is complete on its own screen.** No scrolling *within* a card. If content doesn't fit one viewport, it becomes two cards.
3. **The feed never dead-ends and never shows a spinner mid-scroll.** Buffered generation (Section 7) makes waiting invisible.
4. **Interactions are disguised as content.** A question card reads like a hot take or a bet, not an exam item. ("hot take: killing Redis takes the whole site down. real or nah?")
5. **Progress reads like flexing, not grading.** Checkpoint cards say "you now know more about flood scoring than most lenders," never "Module 3 complete: 80%."
6. **Motion is juice.** Snap physics, spring transitions, tactile feedback on taps. Section 5 defines exact values.

---

## 1. PLATFORM & STACK

- **PWA-first.** Installable to iOS home screen (manifest + service worker + standalone display). Wraps in Capacitor later if ever needed; no native code now.
- **Next.js 15 (App Router) + TypeScript + Tailwind v4.** Single deployment; API routes are the backend. No separate FastAPI/Celery service; there are no minute-long pipelines here, only streamed LLM calls.
- **Framer Motion** for card transitions, tap feedback, reveals.
- **TanStack Query** for buffer polling and mutation state.
- **Supabase (Postgres)** for persistence. Free tier. Note: free tier auto-pauses after inactivity; the app must handle a cold first query gracefully (retry once with backoff, show the app shell meanwhile).
- **Zod** for validating every LLM output against card schemas before anything renders. Non-negotiable.
- **Auth:** none in v1. This is a personal app. Single hardcoded user row. (Clerk drop-in later if it ever goes multi-user.)
- **LLM:** Anthropic API. `claude-sonnet-4-6` for planning/theming (rare, high-stakes calls), `claude-haiku-4-5` for card writing, triage, and chat (constant, cheap calls). All calls go through ONE file: `lib/llm.ts`. Nothing else imports the SDK. (The Freshet one-file rule; it is what makes spend caps unbypassable and provider swaps trivial.)
- **The Anthropic API key lives ONLY in server env vars.** All model calls happen in API routes. The browser never sees the key. Even for a personal app, do not skip this; a PWA on a phone is a browser.

---

## 2. INFORMATION ARCHITECTURE

Three screens total. Resist adding more.

```
┌─────────────────────────────────────────────────┐
│ HOME (session grid)                             │
│  - session cards: title, theme swatch,          │
│    progress ring, "resume" tap target           │
│  - big "+" → NEW SESSION sheet                  │
│  - long-press session → settings / delete /     │
│    remix                                        │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│ FEED (the product)                              │
│  - full-screen snap-scroll cards                │
│  - persistent minimal chrome: back chevron      │
│    (top-left, fades out while scrolling),       │
│    ask-bar trigger (bottom, fades out while     │
│    scrolling, reappears on pause)               │
│  - simpler/deeper controls live ON cards        │
└──────────────┬──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│ NEW SESSION (bottom sheet, not a page)          │
│  - one text box: type a sentence OR paste a     │
│    wall of text OR a URL                        │
│  - attach: .txt / .md file                      │
│  - toggle row: chill mode (no interactives),    │
│    depth preset (skim / standard / deep)        │
└─────────────────────────────────────────────────┘
```

Session creation clarifications (when the input is one vague sentence) are asked **as the first cards of the feed itself**, tap-to-answer. Even setup is scroll-native. Never a form.

---

## 3. THE CARD SYSTEM

The atomic unit is a **card**: one viewport-height, snap-scrolled unit, rendered from validated JSON. The AI fills schemas; React components render them. The AI NEVER emits HTML/JSX. This is what guarantees visual consistency and prevents broken renders.

### 3.1 Card types (v1 ships all of these)

| type | job | interactive? |
|---|---|---|
| `hook` | one bold claim/question, huge type, sets up next cards | no |
| `concept` | one idea, ≤ 55 words, with a visual slot | no |
| `code` | highlighted snippet, tap lines to reveal annotations | tap |
| `diagram` | structured spec rendered to SVG by our components | optional tap |
| `binary` | two-choice bet ("real or nah", "which is the lie") | tap → reveal |
| `predict` | "what happens next?" — answer revealed on NEXT card | tap |
| `sequence` | drag chips into order (e.g., request lifecycle) | drag |
| `slider` | a slider that live-drives a formula/visual output | drag |
| `reveal` | tap-to-flip fact, one setup line + hidden payoff | tap |
| `checkpoint` | milestone flex + streak, subject-flavored copy | no |
| `detour_marker` | entering/exiting a question detour | no |
| `recap` | auto-inserted 3-beat refresher when confusion detected | no |
| `fallback` | static styled card shown if a batch fails validation twice; copy: "hit a pothole, pull to retry" with a retry affordance | tap |

**Chill mode** (per-session setting): `binary`, `predict`, `sequence`, `slider` are excluded from generation; `reveal` and tap-annotations stay (they're consumption, not testing). The planner is told the mode so pacing compensates.

### 3.2 Card schema (the contract; put this verbatim in CLAUDE.md)

```ts
// Every card the writer emits must validate against CardSchema.
// A batch that fails validation is regenerated once with the Zod
// error appended to the prompt; a second failure inserts a single
// `fallback` card and logs the raw output. The feed NEVER renders
// unvalidated JSON and NEVER crashes on a bad card.

const BaseCard = z.object({
  id: z.string().uuid(),
  type: z.enum([...all types above]),
  topicNodeId: z.string(),        // which outline node this serves
  detourId: z.string().nullable(),// non-null inside a question detour
  eyebrow: z.string().max(28).optional(), // tiny label, e.g. "the footgun"
});

// Each type extends BaseCard with its own fields, e.g.:

const ConceptCard = BaseCard.extend({
  type: z.literal("concept"),
  headline: z.string().max(64),
  body: z.string().max(320),           // ~55 words hard cap
  visual: VisualSpec.optional(),
});

const BinaryCard = BaseCard.extend({
  type: z.literal("binary"),
  prompt: z.string().max(140),          // reads like a hot take
  options: z.tuple([z.string().max(40), z.string().max(40)]),
  correctIndex: z.union([z.literal(0), z.literal(1)]),
  revealCopy: z.string().max(240),      // the payoff after tapping
  difficulty: z.number().min(1).max(5), // used by calibration
});

const DiagramCard = BaseCard.extend({
  type: z.literal("diagram"),
  variant: z.enum(["flow","boxes","timeline","compare","cycle","layers"]),
  title: z.string().max(48),
  nodes: z.array(z.object({
    id: z.string(), label: z.string().max(24),
    sub: z.string().max(40).optional(),
    emphasis: z.boolean().optional(),
  })).max(8),
  edges: z.array(z.object({
    from: z.string(), to: z.string(), label: z.string().max(20).optional(),
  })).max(12),
  tapNotes: z.record(z.string(), z.string().max(160)).optional(),
});
// ...analogous schemas for every type. Define ALL of them before
// writing any generation prompt.
```

`VisualSpec` (used by `concept`, `hook`, `checkpoint`) is a constrained enum of visual treatments the renderer knows how to draw: `{ kind: "icon" | "stat" | "ascii" | "spark" | "none", ... }`. No arbitrary image URLs, no generated images in v1. Visual impressiveness comes from theming + typography + motion + the diagram renderer, not from image generation (slow, expensive, off-brand).

### 3.3 The diagram renderer is a real component library, not AI SVG

Build 6 diagram variants (`flow`, `boxes`, `timeline`, `compare`, `cycle`, `layers`) as polished, themed, animated React/SVG components. Nodes stagger in on card entry; tapping an emphasized node opens its `tapNote` as a floating chip. The AI supplies structure; the components supply beauty. This is the single highest-leverage piece of UI work in the app; give it disproportionate build time.

---

## 4. PER-SESSION VISUAL IDENTITY (the "doesn't feel like a learning app" engine)

Each session gets a **theme object** generated by the planner, derived from the SUBJECT's own world. A comp-arch deck and a marine-biology deck must be visually unmistakable from each other.

```ts
const ThemeSchema = z.object({
  name: z.string(),                    // "terminal noir", "field notes"
  mood: z.string().max(120),           // one-line art direction
  bg: z.object({ base: Hex, gradientTo: Hex.optional(),
                 texture: z.enum(["none","grain","grid","scanlines","dots"]) }),
  ink: z.object({ primary: Hex, secondary: Hex }),
  accent: Hex,                          // exactly ONE accent color
  accentAlt: Hex.optional(),            // only for correct/incorrect states
  display: z.enum([...curated display font list]),
  body: z.enum([...curated body font list]),
  mono: z.enum([...curated mono list]),
  motion: z.enum(["snappy","fluid","mechanical","bouncy"]),
  signature: z.string().max(160),       // ONE distinctive device, e.g.
  // "section numbers rendered as hex addresses", "accent underlines
  // drawn like water levels", "cursor-blink on hook headlines"
});
```

Rules for the theme generator (encode in the planner prompt):
- Fonts come from a **curated list of ~14 self-hosted faces** spanning personalities (grotesk, humanist, slab, mono, editorial serif, rounded). The AI picks from the list; it cannot invent fonts. Self-host via `next/font`; no runtime font loading jank.
- **One accent color.** Correct/incorrect feedback may use accentAlt. Everything else is bg/ink shades. Restraint is what reads as premium.
- The **signature** device must appear on hooks and checkpoints and derive from the subject matter. This is the thing that makes each deck memorable.
- Dark backgrounds are the default vibe (feed apps live in dark), but the theme may choose light when the subject calls for it (e.g., "field notes" for ecology).
- All theme values become CSS custom properties on the feed root. Card components consume ONLY the variables, never hardcoded colors. One themed component set, infinite skins.
- Ban the AI-design clichés in the prompt: no cream-and-terracotta default, no near-black + acid green default unless the subject genuinely earns it. The theme must justify itself from the subject in its `mood` line.

---

## 5. FEED MECHANICS & MOTION (exact values)

- Container: `height: 100dvh`, `scroll-snap-type: y mandatory`; each card `scroll-snap-align: start; scroll-snap-stop: always;` (`always` gives the one-card-per-flick TikTok feel; no skipping three cards with one hard flick).
- `overscroll-behavior-y: contain` to stop iOS rubber-banding into browser chrome.
- Card entry animation: content elements stagger in (60ms stagger, spring `{ stiffness: 380, damping: 30 }`) when card crosses 60% visibility (IntersectionObserver). Elements animate ONCE per card; scrolling back up does not replay (replay feels like a slideshow).
- Tap feedback: scale to 0.97 with spring on press. **iOS Safari does NOT support `navigator.vibrate`; do not use it and do not debug its absence.** Tactility on iOS comes from the visual spring plus optional subtle audio ticks (Web Audio API, initialized after first user interaction, correct-answer tick + reveal whoosh, mutable in settings, off by default when the device is on silent is not detectable so keep ticks very quiet). Real haptics arrive only with a future Capacitor wrap.
- Binary/reveal answers: correct → accent flash + confetti burst LOCAL to the tapped element (never full-screen); incorrect → short shake (x: ±6px, 3 cycles) + the reveal copy slides in. Both paths end with the payoff copy visible; a wrong tap still teaches.
- `prefers-reduced-motion`: all springs become 150ms fades. Respect it.
- Progress: a 2px top hairline fill (position within topic), plus the streak counter that appears only on checkpoint cards. No visible card numbers ("3/47" is school).
- The ask-bar and back chevron fade to 0 opacity while scrolling; reappear after 400ms of rest.
- **Standalone PWA mode is the real target, and it behaves differently from a Safari tab:** no pull-to-refresh, edge-swipe back may be absent, and `100dvh` resolves differently without browser chrome. All viewport sizing must use `100dvh` on the scroll container with `position: fixed` app shell; test every scroll behavior from the installed home-screen icon, not just the Safari tab. Provide an explicit in-app refresh affordance (long-press the progress hairline) since pull-to-refresh doesn't exist standalone.

---

## 6. SESSION LIFECYCLE

### 6.1 Ingestion → Plan
Input paths (all funnel into one `sourceText` + `sourceMeta`):
1. **Sentence** → if the planner judges it ambiguous, it emits up to 3 `binary`/tap clarifier cards as the feed's first cards; answers refine the plan. Feed starts instantly either way.
2. **Paste dump** (like the Freshet doc) → becomes the grounding corpus; the planner treats it as source of truth and the card writer is instructed to prefer it over general knowledge and to say when the corpus doesn't cover something.
3. **URL** → server-side fetch, strip to readable text (use a readability lib), same as paste.
4. **GitHub repo URL** → shallow clone via API route (tarball download), extract file tree + README + package/config files into planner context. The card writer receives specific file contents on demand as the plan reaches them (a `getFile(path)` tool made available to generation calls). Never dump a whole repo into one context.
5. **YouTube URL** → server-side caption pull via the `youtube-transcript` package (no API key, no cost), concatenated into `sourceText` with timestamps preserved in `sourceMeta` (the writer may reference "around the 12-minute mark" for flavor). If a video has no captions, return a clear in-sheet error: "this video has no captions; paste a transcript instead." Never attempt audio transcription in v1.
6. **Lecture transcript** → paste or .txt upload. Raw video/audio file transcription is explicitly v2 (Deepgram credits exist for exactly this; do not build upload/transcription plumbing now).

**Planner call (Sonnet, once per session):** emits `{ theme, persona, outline }`.
- `outline`: ordered tree of topic nodes, each with `id, title, est_cards (3-8), depends_on[]`.
- `persona`: a voice spec for this subject (name optional, 3 traits, 2 signature verbal tics, humor register, one thing it never does). Jarvis-tier intelligence is constant; the FLAVOR changes per subject. The persona spec + theme mood are stapled into every card-writer call (grounding pattern: the client can never alter or remove it).
- **Fast-path first cards:** the planner call ALSO emits the session's first 3 cards inline (`hook` + 2 `concept`), so the moment planning completes the feed is scrollable. The normal batch loop takes over behind them. A new session must go from "create" to "first card on screen" with exactly one wait, never two.

### 6.2 Generation loop (buffered, lazy)
- The writer (Haiku) generates cards in **batches of 4**, given: persona, theme mood, the current outline node, the grounding corpus slice for that node, learner state, and the last 6 cards' summaries (for continuity and zero repetition).
- Client keeps **8 cards of runway** past the user's position. When runway ≤ 4, it requests the next batch. At median scroll pace (~6s/card) a batch has ~24s to land; Haiku batches take 3-8s. The user never waits. If runway somehow hits 0 (offline, API blip), the feed shows ONE branded "catching up…" shimmer card with the theme's signature device, and retries with backoff. Never a raw spinner, never an error string.
- Batches are persisted to Postgres as they're accepted, so reopening a session replays instantly from DB and generation resumes from the frontier. Cards are immutable once viewed; only unviewed runway can be regenerated (e.g., after a simpler/deeper tap).
- **Cache keys are versioned** (`cardbatch:v1:{sessionId}:{nodeId}:{stateHash}`). Bump the version constant whenever any card schema changes shape. (You know exactly why. FEMA v2. Never again.)

### 6.3 Infinite scroll semantics
When the outline is exhausted, the feed does not end. It rolls into: (a) resurfaced near-miss items reframed as fresh bets, (b) "adjacent waters" cards offering to extend the outline ("wanna go one layer deeper into X? tap to keep going"), generated on acceptance. The feed never shows "The End."

---

## 7. ASK ANYTHING → DETOURS (the killer feature)

- Ask-bar at the bottom of every card (plus long-press a card → "ask about this").
- The question + current card JSON + session summary go to a **triage call** (Haiku, fast, cheap). It returns one of:
  - `{ kind: "inline", answer }` → renders as a floating chat bubble over the current card (for quick factual asks). Dismiss by scrolling.
  - `{ kind: "detour", cardCount: 2-6 }` → generates a detour batch and **splices it immediately after the current card**. A slim `detour_marker` card opens it ("detour: your question") and another closes it ("back to the main thread"). Detour cards carry a subtle visual tag (accent left-border) so the feed's structure stays legible.
- Detours nest: asking inside a detour opens a child detour. Internally the deck is a tree; the user experiences a line. Track with `detourId` + parent pointers.
- Detour content updates learner state like any other cards (asking about X implies X needs reinforcement; the writer is told).

---

## 8. ADAPTATION & CALIBRATION

**Learner state** (small JSON blob per session, versioned, passed to every writer call):

```ts
{
  globalLevel: 1-5,            // starts 3
  perNode: { [nodeId]: { level, attempts, hits, lastMissConcepts[] } },
  rolling: { last10Interactive: { hits, attempts }, avgDwellMs },
  prefs: { chillMode, depthPreset, simplerTaps, deeperTaps }
}
```

**Calibration target: ~80% hit rate** on interactive cards (the flow zone; gears turn, no rage-quit). The writer receives the rolling hit rate and a difficulty directive:
- hit rate > 90% over last 10 → raise `difficulty` by 1, add curveballs (plausible-wrong options, "which is the LIE" formats).
- hit rate < 65% → lower difficulty, and the NEXT interactive on a missed concept gets scaffolding (a `concept` re-angle card inserted before it).
- Two consecutive misses on one concept → auto-insert one `recap` card (3 beats, new metaphor, never the same wording as before) and re-test later, disguised as a fresh bet.

**Explicit dials on cards:** small "🧒 simpler" / "🎓 deeper" ghosts on concept/diagram cards. A tap adjusts `globalLevel`, regenerates the UNVIEWED runway at the new level (viewed cards are history), and shows a 1-line toast in the persona's voice ("say less. rewinding the jargon.").

**Implicit signals (v1, keep it simple):** median dwell < 1.8s across 5+ consecutive non-interactive cards → pacing is too slow; writer directive: compress, bigger claims, fewer cards per node. Dwell > 25s or scroll-up returns → insert a `recap`. Do not over-engineer inference beyond these two; explicit dials + interactive results carry the load.

**Dwell timer integrity (required):** pause the dwell clock on `visibilitychange` (app backgrounded, phone locked) and on `pagehide`; resume on return. Additionally hard-cap any single recorded dwell at 60s. Without this, locking the phone mid-card records a 40-minute dwell and the adaptation engine wrongly concludes catastrophic confusion.

---

## 9. DATA MODEL (Supabase)

```
sessions
  id uuid pk, title text, source_kind enum(sentence|paste|url|repo|youtube|transcript),
  source_meta jsonb, theme jsonb, persona jsonb, outline jsonb,
  settings jsonb (chillMode, depthPreset), learner_state jsonb,
  status enum(planning|active|archived), position int (last viewed card index),
  created_at, last_opened_at

cards
  id uuid pk, session_id fk, idx int (feed order; detours renumber via
  fractional indexing e.g. 12.1, 12.2 so splices never rewrite rows),
  type text, payload jsonb (the validated card), detour_id uuid null,
  viewed_at timestamptz null, interaction jsonb null (choice, correct, dwellMs)

detours
  id uuid pk, session_id fk, parent_detour_id null, question text,
  inserted_after_idx numeric, created_at

llm_calls   -- observability + spend accounting, every call logged
  id, session_id, purpose enum(plan|write|triage|chat), model,
  in_tokens, out_tokens, latency_ms, ok bool, error text null, created_at
```

Spend caps: computed from `llm_calls` daily aggregates, enforced in `lib/llm.ts` BEFORE dispatch. Cap: 500 calls/day (~comfortably under a few $/day on Haiku-dominant traffic). **Fails closed**: if the count can't be read, no paid call. When the cap hits mid-session, the next "card" is a themed in-feed card in the persona's voice: "we hit today's budget. resets at midnight. go touch grass, legend." (The Freshet in-stream budget message; it is the correct pattern.)

---

## 10. API ROUTES

```
POST /api/sessions              create (ingest → plan job)
GET  /api/sessions              list for home
GET  /api/sessions/:id          detail incl. settings/theme
PATCH /api/sessions/:id         settings, position, archive
GET  /api/sessions/:id/cards?after=idx&limit=12    replay + runway fetch
POST /api/sessions/:id/generate                    next batch (server
     enforces idempotency: if a batch for this frontier is in flight
     or done, return it; never double-generate)
POST /api/sessions/:id/ask      triage → inline answer | detour splice
POST /api/cards/:id/interact    record choice/dwell, update learner state
POST /api/ingest/url            fetch+strip (@mozilla/readability)
POST /api/ingest/repo           tarball → tree+key files
POST /api/ingest/youtube        caption pull → transcript text
```

Planning for big corpora can take 10-20s: return the session immediately with `status: planning`, feed shows a themed "reading your stuff…" sequence (2-3 pre-baked cards that tease what's coming, generated from the first 2k chars fast-path), TanStack Query polls until active. Never a blank wait.

One response envelope everywhere: `{ data, error, meta }`, including thrown errors (wrap in middleware). One error grammar.

---

## 11. LLM LAYER (`lib/llm.ts`, the only file allowed to import the SDK)

- `plan(input) → {theme, persona, outline}` (Sonnet, JSON mode, Zod-validated, 1 retry with error appended)
- `writeBatch(ctx) → Card[4]` (Haiku, same validation contract)
- `triage(question, ctx) → inline | detour` (Haiku)
- `writeDetour(question, ctx) → Card[2-6]` (Haiku)
- Every function: spend-cap check → call → log to `llm_calls` → validate → (retry once) → return or fallback.
- Prompts live as versioned `.ts` template files in `lib/prompts/` (not scattered strings). Each prompt file exports `PROMPT_VERSION`; version is logged with every call so bad generations are traceable to a prompt change.
- System prompts hard-forbid: school vocabulary on-screen, fabricating facts not in the corpus (must say "the source doesn't cover this, but generally…" and mark it), repeating a metaphor already used (last-6-cards summary is provided for this), exceeding word caps (Zod enforces anyway).

---

## 12. RELIABILITY RULES (the "I don't want bugs" section)

1. **Failure as data.** Every generation returns a normal-shaped result even on failure (`{ok:false, fallbackCard}`). No exceptions cross the feed boundary. The feed cannot crash on content.
2. **Zod at every LLM boundary.** Invalid → retry once with the validation error in-prompt → fallback card. Log raw output on double failure.
3. **Idempotent generation.** Frontier-keyed; duplicate triggers return the in-flight/done batch. A double-tap or flaky network can never produce duplicate cards.
4. **Never cache a failure.** Only validated batches persist.
5. **Versioned everything:** card schema version in cache keys, `PROMPT_VERSION` in logs, `learner_state.version` in the blob.
6. **Immutable history.** Viewed cards never change; only unviewed runway regenerates. (Prevents the two-pollers-disagree class of bug: the DB rows you've seen ARE the truth; there is no second source to conflict with.)
7. **Offline-graceful.** Service worker caches the shell + all viewed cards of the active session. Offline mid-feed: you can re-read everything viewed; the frontier shows one themed "back online soon" card.
8. **Supabase cold start** (free-tier pause): first query retries once after 3s behind the app-shell splash. Known non-bug; handle it, don't debug it at 2am.
9. **JSONB mutation gotcha carries over conceptually:** always write NEW learner-state objects, never mutate-in-place patterns that ORMs/serializers can miss.
10. **Watchdog:** any session in `planning` > 90s flips to a retryable error state with a one-tap retry card.

---

## 13. BUILD ORDER FOR CLAUDE CODE (autonomous one-shot mode)

Phases are still built strictly in order, but the gate between phases is SELF-VERIFICATION, not human approval. A phase is complete only when: (a) its Playwright checks pass, (b) a screenshot review at 393×852 finds no violation of the Prime Directive, and (c) `npm run build` and all tests pass. Log a short self-review note per phase in BUILD_LOG.md (what was checked, what was fixed) so the human can audit the run afterward. Items that only a real device can verify (scroll feel, standalone install) are collected into MANUAL_CHECKLIST.md for the human to run at the end; everything else must be verified automatically.

CLAUDE.md must contain: the prime directive, the full card + theme Zod schemas, the one-file LLM rule, the response envelope, the banned-words list, the rule "AI fills schemas, components render them; never generate markup," and this autonomous gating rule.

1. **Skeleton:** Next.js + Tailwind + Supabase schema + PWA manifest/service worker + the snap-scroll feed rendering HARDCODED sample cards of every type, fully themed via CSS vars, with all motion. *Get the feel perfect on real iPhone Safari before any AI exists.* This phase is where "visually impressive" is won or lost.
2. **Diagram component library:** all 6 variants, themed, animated, tap-notes. Build against hardcoded specs.
3. **LLM layer + planner + writer:** sentence + paste ingestion, theme generation, buffered batches, Zod pipeline, spend caps. First real end-to-end session.
4. **Interactions + adaptation:** interactive card recording, calibration loop, simpler/deeper regeneration, recap insertion, chill mode.
5. **Ask/detours:** triage, splicing with fractional indices, nesting, markers.
6. **Home + polish:** session grid, resume, remix, infinite-scroll continuation, offline caching, budget card.
7. **Ingestion long-tail:** URL, repo walker, transcript upload.

### Acceptance checklist (run on a real iPhone, FROM THE INSTALLED HOME-SCREEN ICON, before trusting it)
- [ ] Hard-flick scrolls exactly one card, every time, no half-states — verified in standalone mode, not just the Safari tab
- [ ] Airplane mode mid-feed: viewed cards readable, one graceful frontier card, recovers on reconnect
- [ ] Paste the full Freshet doc: plan lands, theme is subject-derived, zero fabricated facts in 30 cards (spot-check against the doc)
- [ ] Tap wrong on 3 binaries in a row on one concept → a recap card appears within the next 4 cards
- [ ] Spam-tap "generate" conditions (fast scroll to frontier repeatedly) → no duplicate cards ever
- [ ] Kill the API key in env → feed degrades to fallback card, app does not crash
- [ ] Chill mode session contains zero interactive card types
- [ ] Ask a question → detour splices after current card and returns to thread cleanly; ask inside the detour → nests
- [ ] `prefers-reduced-motion` on → no springs, content still staggers as fades
- [ ] Add to Home Screen → launches standalone, no Safari chrome, splash themed
- [ ] YouTube URL with captions → session builds; URL without captions → clear in-sheet error, no hang
- [ ] Lock the phone for 5 minutes mid-card → recorded dwell ≤ 60s, no recap spam on return
- [ ] New session shows its first card after exactly one wait (plan), never a second wait for the first batch

---

## 14. EXPLICIT NON-GOALS (v1)
No accounts/auth. No app store. No image generation. No raw video/audio file transcription (YouTube captions and pasted transcripts only). No social/leaderboards. No payments. No Android testing beyond "probably works."

---

## 15. TOOLING: MCPs, LIBRARIES, AND THE DEVICE-TESTING WORKFLOW

### 15.1 MCPs (Claude Code setup)
- **Playwright MCP (required, already installed).** Claude Code's eyes. Rule for CLAUDE.md: *after any visual change, screenshot at 393×852 (iPhone viewport, deviceScaleFactor 3) and self-critique against the Prime Directive before proceeding.* Also used to automate the non-feel parts of the acceptance checklist (tap flows, offline simulation via context offline mode).
- **Context7 (already installed).** Pull current docs for Tailwind v4, Next.js 15 App Router, and Framer Motion before writing code that touches them; training-data knowledge of Tailwind v4 in particular is unreliable.
- **Supabase MCP (add it).** Schema inspection, live queries, debugging learner-state blobs directly instead of guessing.

### 15.2 Libraries (hand these to Claude Code; do not let it reinvent them)
- `fractional-indexing` — detour splice ordering. Replaces the naive "12.1, 12.2" numeric scheme implied in Section 9; use this library's string keys in `cards.idx` (column type text, ordered lexicographically).
- `@mozilla/readability` + `jsdom` — URL → readable text.
- `youtube-transcript` — caption pull, no key.
- `shiki` — code card highlighting (server-side, themed via CSS vars; this is what makes code cards look premium).
- `next/font` with Google Fonts — the curated ~14-face font list, self-hosted at build time, zero runtime font jank, zero licensing questions.
- Framer Motion, TanStack Query, Zod (already specified).

### 15.3 Device-testing workflow (three tiers, all used)
1. **Inner loop — Playwright MCP.** Headless iPhone-viewport screenshots on every visual change. Runs constantly, no human needed.
2. **Mid loop — iOS Simulator (requires Xcode installed).** Real WebKit. Claude Code drives it directly:
   ```bash
   open -a Simulator
   xcrun simctl openurl booted http://localhost:3000
   ```
   Truthful for layout and Safari quirks; NOT truthful for scroll feel (mouse ≠ thumb). Use every few changes.
3. **Outer loop — real iPhone, installed as PWA.** The only truth for snap physics, momentum, and jank. Two paths:
   - **Vercel preview deployments** (default): push a branch, open the preview URL on the phone, Add to Home Screen. HTTPS for free, which service workers and installability REQUIRE; a plain local-IP-over-WiFi URL cannot test the PWA properly.
   - **cloudflared / ngrok tunnel** for rapid local-dev-on-real-phone moments: temporary HTTPS URL pointed at localhost:3000.
   Run the full acceptance checklist here, from the home-screen icon, at every phase boundary.

### 15.4 CLAUDE.md must additionally contain
The screenshot-and-critique rule (15.1), the library list (15.2, "use these, do not reinvent"), the iOS haptics prohibition (Section 5), and the standalone-mode testing requirement (Section 5 / checklist).