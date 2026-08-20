# CLAUDE.md — DRIP

> New here? Read `HANDOFF.md` first — it carries what this file can't: what was deliberately NOT
> built (and why, so it doesn't get rebuilt), and the two things still needing a human's eye.

DRIP: TikTok's format, a great teacher's brain. Paste anything → an infinite, adaptive, snap-scrolling feed that teaches it. `dripSpec.md` is the source of truth; this file is the working contract for anyone (human or Claude) touching the code.

## 0. The Prime Directive

> **Does this feel like a feed I opened to kill time, or a course I enrolled in?**

If it feels like a course, it is wrong.

1. **Never use school vocabulary on screen.** Banned in any user-facing string: `quiz, test, lesson, module, objective, curriculum, assessment, exam, chapter, homework, syllabus` (word-boundary, case-insensitive; enforced by `lib/copy/banned.ts` + tests). Fine in code and identifiers.
2. **Every card is complete on its own screen.** No scrolling within a card. Too much content → two cards.
3. **The feed never dead-ends and never shows a spinner mid-scroll.** Buffered generation makes waiting invisible; the only "waiting" surface is a themed `notice` card. It does not, however, run on forever: at each topic boundary a `crossroads` card asks where to go and generation STOPS (`progress.awaitingChoice`) until the reader picks. Asking is not a dead end.
4. **Interactions are disguised as content.** Question cards read like hot takes or bets.
5. **Progress reads like flexing, not grading.** Never "3/47", never "80%", never a progress meter carrying a number. Checkpoints say "you now know more about X than most Y". Numbers on screen are allowed only when they are about the SUBJECT (a `stat` card's headline figure, a `slider`'s output) — never about the reader.
6. **Motion is juice.** Snap physics, springs, tactile taps. Exact values in spec §5.

## 1. Architecture rules

- **A placeholder under the thumb is sacred.** The reader's current slide never changes identity or slot. Client-side pseudo slides are pinned while active (`lib/feed/placeholder.ts`) and the engine never inserts a card above the furthest row the reader has viewed. This is the one bug users notice instantly ("my slide turned into something else").
- **Variety is enforced in code, not just asked for in the prompt** (`lib/generation/variety.ts`): never two prose cards (`PROSE_CARD_TYPES`) back to back across the batch boundary, ≤2 concepts in any window of 4 consecutive cards, and every batch of 3+ carries one of `VISUAL_CARD_TYPES`. A deck of headline+paragraph cards is the failure mode the reader actually complains about.
- **The storyline is carried, not re-derived** (`session.storyline`: spine / covered / next). Last-6-card summaries keep local continuity; the storyline keeps a card 40 slides deep on the same thread.
- **Explain without spending words**: cards carry `terms: [{term, gloss}]`; the renderer underlines the term and a tap shows the gloss. Never assume, never pad.
- **AI fills schemas, components render them. The AI never generates markup.** Every card is JSON validated by `CardSchema` (`lib/schemas/cards.ts`) before anything renders. Invalid → regenerate once with the Zod error appended → second failure inserts one `fallback` card and logs raw output. The feed cannot crash on content.
- **One-file LLM rule.** `lib/llm.ts` is the ONLY file that imports `@anthropic-ai/sdk`. Every call: spend-cap check (fails closed) → call → log to `llm_calls` → Zod validate → retry once → return or fallback. `ANTHROPIC_API_KEY` exists only in server env; all model calls happen in API routes.
- **Prompts** live as versioned `.ts` files in `lib/prompts/`; each exports `PROMPT_VERSION`, logged with every call.
- **Response envelope everywhere:** `{ data, error, meta }` (`lib/api/envelope.ts`). Route handlers are wrapped in `handle()`; thrown errors become enveloped errors. One error grammar.
- **Failure as data.** Generation returns `{ ok: false, fallbackCard }`, never throws across the feed boundary.
- **Idempotent generation.** Frontier-keyed batches (`batches` table); duplicate triggers return the in-flight/done batch. Never cache a failure — only validated batches persist.
- **Versioned everything.** `CARD_SCHEMA_VERSION` in cache keys (`cardbatch:v{N}:{sessionId}:{nodeId}:{stateHash}`), `PROMPT_VERSION` in logs, `learnerState.version` in the blob. Bump `CARD_SCHEMA_VERSION` whenever a card schema changes shape.
- **Immutable history.** Viewed cards never change; only unviewed runway regenerates.
- **`learnerStateHash` is a closed whitelist** (`lib/adapt/learner.ts`). It is part of every frontier key, so anything volatile that leaks into it re-keys the frontier and makes the session pay the model twice for the same cards. Adding a field there is a deliberate decision, never a side effect of adding a field to the state.
- **Themes are CSS variables.** `lib/theme/cssVars.ts` defines the contract (`--bg --bg-to --ink --ink-2 --accent --accent-alt --accent-ink --accent-soft --surface --surface-2 --line --state-correct --state-wrong --font-display --font-body --font-mono --shiki-*`, `data-texture data-motion data-signature`). Components consume ONLY variables — never a hardcoded colour. Fonts come from the curated list in `lib/theme/fonts.ts`; the AI cannot invent fonts.
- **Card ordering** uses `fractional-indexing` string keys in `cards.idx` (lexicographic). Detour splices never rewrite rows.
- **Learner state:** always write NEW objects, never mutate in place.
- **Persistence:** `Store` interface (`lib/db/store.ts`). Supabase in production (`supabase/migrations`), local JSON store in `.data/` when Supabase env is absent (dev/tests only). Handle Supabase cold start: retry once after 3s behind the app-shell splash.
- **Dwell timer integrity:** pause on `visibilitychange`/`pagehide`, resume on return, hard-cap any single dwell at 60s.
- **iOS haptics: `navigator.vibrate` does not exist on iOS Safari. Do not use it, do not debug its absence.** Tactility = visual spring (scale 0.97 on press) + optional very quiet Web Audio ticks (init after first interaction, off by default).
- **Standalone PWA is the real target.** `position: fixed` app shell, `100dvh` on the scroll container, `overscroll-behavior-y: contain`, explicit in-app refresh affordance (long-press the right-edge depth rail → the thread sheet). Test from the installed home-screen icon, not just the Safari tab.
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
pnpm db:migrate     # prints the pending Supabase migration to paste into the SQL editor
```

Env: see `.env.example`. `LLM_MODE=mock` runs the entire pipeline (spend cap, logging, Zod, retries) against deterministic canned output — used by Playwright; never in real use.

## 4. Schemas — where the real ones live

**`lib/schemas/*.ts` is the only source of truth for every shape the AI fills.** This section used to
inline a verbatim copy of them. The copy went stale inside one schema version and three separate
people wrote code against a card list that no longer existed, so it is a pointer now and stays one.
Read the .ts files — they are short, and every field carries the comment that says why it is there.
The only things below that are safe to write down are the ones that do not rot: what each file is
*for*.

- **`cards.ts`** — THE contract between the writer and the renderer, and the one to read first.
  `CARD_TYPES` is everything the feed can render; `WRITER_CARD_TYPES` is the subset a normal batch
  may contain; `VISUAL_CARD_TYPES` / `PROSE_CARD_TYPES` / `CHILL_EXCLUDED_TYPES` / `SCORED_TYPES` are
  the derived sets the rest of the code reasons in (variety, chill mode, calibration) — use them,
  never a hand-written list of type names. Two fields cut across nearly every card: `terms` (up to 3
  `{term, gloss}` pairs; the renderer underlines each occurrence and a tap shows the gloss — this is
  how a card avoids assuming knowledge without spending its word budget) and `anchor` (a slug the
  writer reuses, NEVER rendered, that joins the card teaching an idea to the card betting on it 26
  slides later). `CARD_SCHEMA_VERSION` lives here and is part of every cache key.
- **`visual.ts`** — the only visual treatments the AI may request on a card, from a closed list of
  kinds and a closed list of icon names. No image URLs, no generated images, no markup.
- **`theme.ts`** — the per-session visual identity the planner invents out of the subject's own
  world: one accent, a font triple, a texture, a motion register, and ONE signature device. All of it
  becomes CSS variables (§1). The font list and the signature list are closed enums — the AI picks
  from them, it cannot invent one.
- **`plan.ts`** — what the planner returns once per session (`{title, theme, persona, outline,
  clarifiers, firstCards}`) and what ask-bar triage returns (`inline` answer vs. `detour`). The
  persona is the voice contract: traits/tics/humor/neverDoes, plus the analogy world every metaphor
  in the session is drawn from and one sample card the writer imitates instead of guessing.
- **`learner.ts`** — session settings and the learner-state blob, which is a memory rather than a
  pile of counters: `ability` is the running read of how they are actually doing, `level` is the
  single number handed to the writer and it moves slowly on purpose, `ledger` records every idea they
  have MET keyed by `anchor` so nothing nailed 30 slides ago gets re-taught, and `directives` is the
  derived part passed verbatim into the prompt. Additive JSONB: old blobs parse and pick up defaults.
- **`session.ts`** — the persisted rows (session, card, detour, batch, llm_call) plus two blobs worth
  knowing: `progress` is where generation stands (`nodeIdx`, `epoch`, `awaitingChoice`, `deeperCards`)
  and `storyline` is the through-line carried across every writer call so a card 40 slides deep still
  belongs to the same story.

`lib/api/contract.ts` does the same job for the wire — request and response `data` shapes for every
route — and is equally authoritative. `lib/generation/frontier.ts` owns "where generation actually
is", counted from rows that exist; the client draws the bar from that census and never re-derives a
position from `estCards`.

**Changing a card shape** means: edit the schema, bump `CARD_SCHEMA_VERSION`, teach the writer prompt
in `lib/prompts/` about it, add or update the renderer in `components/cards/`, and check
`lib/generation/variety.ts` still classifies it. Update this file only if a RULE changed — never to
re-paste a schema.

## 5. Model policy

`LLM_PLAN_MODEL` (default `claude-sonnet-4-6`) for planning/theming; `LLM_WRITE_MODEL` (default `claude-haiku-4-5`) for card writing, triage, detours. Daily cap `LLM_DAILY_CALL_CAP` (default 500) computed from `llm_calls`; fails closed. When the cap hits mid-session the next card is a themed `notice` in the persona's voice ("we hit today's budget. resets at midnight. go touch grass, legend.").
