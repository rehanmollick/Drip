# BUILD_LOG.md — autonomous build self-review notes

One entry per phase (spec §13). Each entry: what was checked, what was fixed, what was deferred to MANUAL_CHECKLIST.md.

## Phase 0 — scaffold + contracts
- Next 15.5 (App Router) + Tailwind v4 (PostCSS) + TS strict; pnpm.
- Contracts written before any feature code: card schemas (13 spec types + internal `notice` and `clarify`), VisualSpec, ThemeSchema with curated 16-face font enums, plan/persona/triage/learner-state/session/card/detour/batch/llm_call schemas, API contract for every route, response envelope, Store interface, LLM layer types, CSS-variable theme contract, CardViewProps/Slide contract, ThemeRoot.
- Verified: `pnpm typecheck`, `pnpm build` (all 16 Google fonts self-host at build), pushed to GitHub.
- Decision: no Supabase/Anthropic credentials exist on this machine → the app selects a local JSON store (`.data/`) when Supabase env is absent and supports `LLM_MODE=mock` for deterministic end-to-end testing. Real credentials flip both automatically via env.

## Phase 1 — skeleton + themed snap-scroll feed with hardcoded sample cards
- `/dev/cards` (terminal-noir, dark) and `/dev/cards/light` (field-notes, light) render `lib/sample/cards.ts` — every card type — inside the real Feed in static mode.
- Checked (Playwright, WebKit iPhone 14 Pro 393×852 @3x — `e2e/prime-directive.spec.ts`): `scroll-snap-type: y mandatory`, `scroll-snap-stop: always`, `scroll-snap-align: start`, `overscroll-behavior-y: contain`, every card exactly 852px tall, no element overflows its card, no card scrolls internally, no horizontal scroll, no banned words in rendered text, no "N/M" counters, reduced-motion still shows content, binary tap → payoff copy, reveal flip, slider drives output. Screenshot review of all 18 slides in both themes: no Prime Directive violations found.
- Fixed: diagram card header sat under the back chevron (top-anchored card) → header now clears it; Next dev badge overlapped the ask bar in screenshots → `devIndicators: false`.
- Deferred to MANUAL_CHECKLIST: snap feel / momentum, standalone chrome, thumb drag on sequence/slider.

## Phase 2 — diagram component library
- 6 variants (flow, boxes, timeline, compare, cycle, layers) as pure layout functions + one themed animated SVG renderer; 43 layout tests (containment at 361×460 / 345×520 / 300×300, no NaN, unknown edge ids dropped, orientation, cycle order, no node overlap). Nodes stagger once, edges draw after, tap-notes as floating chips.
- Screenshot-checked in both themes and inside a real detour ("qos: which pod dies first", layers variant).

## Phase 3 — LLM layer + planner + writer, first real end-to-end session
- `lib/llm.ts` is the only SDK importer; spend cap from `llm_calls` (fails closed), every call logged with `PROMPT_VERSION`, Zod → retry once with the error → failure as data. `LLM_MODE=mock` for tests.
- Real run (Sonnet 4.6 plan + Haiku 4.5 batches, local store): plan for "how kubernetes schedules pods onto nodes…" landed in 31.5s / 1 attempt after tuning (theme "cluster ops console" — brackets signature, space-grotesk / ibm-plex-sans / jetbrains-mono, mechanical motion; persona "ctrl", 6-node outline; hook + 2 concepts). Batches: 4 cards in 8–15s (concept/diagram/binary/checkpoint; hook/concept/diagram/binary). Triage inline in 3s, detour spliced after the current card, dial toast in persona voice ("real talk: rewind the jargon…").
- Fixed from that run: adaptive thinking + 12k max_tokens on the plan blew the 90s watchdog → no thinking, streamed call, 8k cap; length-cap validation failures on never-on-screen fields (mood, briefs, traits) → word-boundary soft-clamps + a hard-cap cheat sheet in the prompts (`plan.v2`, `write.v2`); a banned word ("test the model") survived the retry → synonym scrub before anything reaches the screen; stray `*markdown*` in copy → stripped (code fields exempt); raw output now logged on double failure (spec §12.2).
- Not verified live: Supabase store (no tables yet — migration must be applied in the SQL editor); URL/repo/YouTube ingestion against live sites (unit-tested on fixtures).

## Phase 4/5/6/7 — interactions, adaptation, detours, home, ingestion
- Built and unit-tested (313→316 tests): learner reducer rules (§8), engine idempotency under 5 concurrent generates, budget → single notice, failure → single fallback, dial deletes unviewed only, detour splice/nesting order, local store, supabase mapping round-trips, ingestion parsers, SW compiles, expr evaluator, banned words over samples + component strings.
- E2E (`e2e/flow.spec.ts`, mock LLM): create → one wait → first cards → runway grows past 12 with no duplicate ids; ask → inline bubble; "why…" → detour markers spliced right after the current card; chill mode → zero interactive cards; `[[BUDGET]]` / `[[FAIL]]` → themed notice / fallback with retry, no error strings on screen.
- Adversarial review pass (see next entry) ran after this.

## Phase 8 — adversarial review + fixes
- Seven independent reviewers (feed mechanics, engine/API, adaptation, LLM/prompts, persistence, ingest/PWA/security, client↔server contract) produced 127 candidate findings against the spec. A refuter panel and my own triage cut them to the ones that reproduce; five fixers applied them in disjoint areas.
- The class of bug that mattered most was **the feed dead-ending**: a permanently-failing interact post blocked the outbox forever → the server never saw views → the runway guard returned nothing → a permanent "catching up…" tail. Fixed by dropping non-retryable 4xx from the outbox, plus a `progress.epoch` that invalidates superseded batches and a `reason` on empty generate responses so the client can react instead of backing off blindly.
- Others worth naming: clarifier answers went through two paths and raced the server's re-plan (one path now, and the client waits for `pendingReplan` to clear); the recap trigger could be consumed twice (interact owns it); `pinnedFetch` skipped its address pin for IP-literal hosts *and* could ride a pooled keep-alive socket opened for a different vetted set (one non-pooling agent per request); reduced-motion turned looping keyframes into 6.7 Hz strobes; entry staggers replayed on remount.
- Verified: 444 unit tests, 8 Playwright e2e (WebKit, 393×852), typecheck, lint, `pnpm build` — all green. Screenshot review of the sample deck (both themes) and a worst-case deck built from schema-maximum copy: no card overflows, no internal scrolling, no horizontal scroll.

## Phase 9 — real-model verification (Sonnet 4.6 + Haiku 4.5)
Three live sessions against the real API (local JSON store; Supabase project has no tables yet).

- **Per-session identity works**: "how kubernetes schedules pods" → *cluster ops console* (phosphor green on near-black, Space Grotesk/JetBrains Mono, mechanical motion, bracket signature, persona "ctrl"); "how tide pools survive between high tides" → *waterproof field notebook* (kelp green on dark teal, Fraunces/Source Serif, fluid motion, water-lines signature, persona "dr. cold-and-wet"). Unmistakably different decks, as §4 requires.
- Timings: plan 31–45s (one Sonnet call), batches 8–16s (4 cards), triage 1–4s, detour 19s end-to-end (triage + 4 spliced cards), recap 7s.
- Fixes this surfaced, each verified after the change:
  - adaptive thinking + a 12k cap on the plan call blew the 90s watchdog → no thinking, streamed, 8k cap (31s, first attempt);
  - length-cap failures on never-on-screen fields (mood, briefs, traits) → word-boundary soft clamps;
  - recap beats came back ~200 chars against a 120 cap and burned both attempts → the prompt now *shows* the right size, and it lands first try;
  - triage answered "how does X work" questions inline (the killer feature under-firing) → a mechanical two-sentence test, now correctly returns detour;
  - the detour writer overshot `nodes[].label`/`body` → concrete examples for the four most-overshot fields, plus a **salvage pass**: one over-long card no longer discards three good ones;
  - a real compare diagram put its edge label on top of both columns → the gutter now sizes to its label.
- Not verified live: Supabase persistence (tables not created yet — an un-migrated project now answers with an actionable `schema_missing` message instead of a generic 500); URL/repo/YouTube ingestion against live sites (unit-tested against fixtures and a local HTTP server).
- Note on measurement: several long calls recorded 600–970s. That is this Mac DarkWaking mid-request, not the app — `caffeinate` makes the same calls finish in 15–20s. The deadline handling behaved correctly throughout: bounded wait, clean error, retryable session.

## v2 — "it all looks the same, and it never asks me anything"

Six things the reader named, plus the bug they hit. Verified against the real models (Sonnet 4.6 planning, Haiku 4.5 writing) unless noted.

- **~70% of cards were a title + a paragraph.** The writer could always fall back to `concept`, so it did. Now there is a **variety governor** in code, not in the prompt: two prose cards may never sit adjacent (`concept`/`recap`), at most 2 concepts in any window of 4, and any batch of 3+ must carry something to look at (`diagram`/`code`/`slider`/`sequence`/`stat`). Violations are dropped and fed back as directives on the next call, sharpening under repeat pressure. New card types: `stat` (one number, big), `open`, `crossroads`, `wrap`. A live deck now comes back `hook, stat, diagram, binary, slider, open, checkpoint, crossroads` — **zero prose-slab concepts**, against ~70% before.
- **"better explanations, not more text."** Length caps went *down*, not up. Instead: inline glossary `terms` (max 3, ≤140 chars each) so a card can use the real word and gloss it in place rather than either skipping it or spending a paragraph on it — the "don't assume stuff" half of the ask without the "more text" half.
- **"don't just keep autogenerating."** Generation now **stops at every topic boundary** and asks: keep going / one more layer here / ask something / wrap it up. `progress.awaitingChoice` gates the runway pump — while it waits, nothing generates and no catching-up tail appears. The crossroads and wrap cards are assembled from outline titles with **no model call**, so the question always arrives instantly.
- **"it should always remember the main story line."** A `storyline` — `{spine, covered[], next}` — is carried into every writer call and advanced as cards land. Before this, a card 40 slides deep only knew the last 6 cards. Needs `0003_storyline.sql`; without the column the app runs fine and the field stays null (see below).
- **"where am I on the scrolls."** A hairline timeline at the top: one segment per outline topic, filling as you move, detours reading as off the main thread. Long-press opens the thread — the whole session as a map, with a tap taking you back to any topic you've been through. **Never a counter** — the reader asked where they are, not for a grade.
- **Open-ended answers.** `open` cards take typed text and grade it against what was actually written, not against a key.
- **The bug: "my slide gets regenerated into something else."** Not regeneration — real cards are never rewritten. The placeholder the reader was standing on held its position with an `idx` watermark, so a batch landing with keys that sorted earlier (a detour splice, a backfill against a stale frontier) slotted itself *above* them and shoved them down two slides — and those cards were stranded up there, unreachable. A pin now records **the set of rows above it, decided once**; nothing arriving later can move the reader, whatever key it carries. Proven from an instrumented render log (`index 8 → 10`), regression-tested red-then-green in both unit and e2e form.

Also: a fork headline no longer wears a whole sentence as a noun (planner titles are clauses — `"that's sound is pressure, and pressure c…"` reached the screen); and **a deploy that lands before its migration no longer takes the app down** — a column the database doesn't have yet is told apart from an un-migrated project, and the write retries without it. That distinction was found the hard way: pushing v2 broke the live app and blamed the wrong thing ("the tables are missing" — they weren't).

Verified: 616 unit tests, 23 Playwright e2e (WebKit, 393×852) green twice back to back including on a dirty store, typecheck, lint, `pnpm build`. Live session on production after deploy: session active, 6-topic outline, cards landing, `storyline` null pending the migration. Cost ≈ $0.086/session.

## v3 — the prose baseline, captured before any prompt was touched

`DRIP_LIVE_WRITE=1 pnpm exec vitest run tests/write.live.test.ts` — three real batches, three
subject families that share no vocabulary, `claude-haiku-4-5`, prompt `write.v4+shared.v3.3157015f`.
Nothing in this repo had ever looked at a sentence of real card prose before this; all 748 unit tests
and 35 e2e run against canned mock output, which made every claim about writing quality
unfalsifiable — including the ones v3 is about to make.

**technical** (git's object model) and **science** both passed: each batch carried at least one card
whose idea is a shape, zero banned words, every card inside its caps.

**humanities** (free indirect style — deliberately the hard case: no numbers, no mechanism, nothing
to draw) FAILED, and the failure is the finding:

- The batch came back `reveal → open`. **0 of 2 cards carry a shape.** A wall of prose — exactly the
  reader's original complaint, surviving every v2 mitigation, on the material where it matters most.
- It asked for 4 cards and **2 were dropped by the salvage pass** for overshooting caps
  (`revealCopy` 200, `predict.prompt` 140, two `options` at 40, `revealCopy` 240). Literary prose runs
  long, so the abstract subjects are also the ones that lose cards — the thinning and the prose-slab
  are the same failure.
- The prose itself is *good*: "those words are emma's, sitting in the narrator's mouth. the grammar
  stays third person. the diction defects to her." Voice, nuance, no jargon, glossary terms carrying
  `diction` and `deixis`. **The sentences were never the problem. The routing is.**

The diagnosis: every visual route in `SHOW_DONT_TELL` presupposes something concrete — a quantity
(stat), a mechanism (diagram), real code (code), a formula (slider), a series (scrub). Hand the
writer a subject with none of those and it has nowhere to go but prose, so it writes prose and the
governor can only watch. `spot` — added this cycle — is the missing route for text: *find the line
where the narrator's voice slips into the character's* is the mechanic for free indirect style. It
needs a routing line that does not mention numbers.

One thing that did NOT go wrong, and was worth checking: "caching vocabulary from the prompt's gold
examples: none". All three gold examples in `SHOW_DONT_TELL` are caching, and none of it leaked into
a literature session.

## v3 — the same three batches, after the prompt pass

`write.v5+shared.v4.3148e0a3`, same subjects, same model, same day.

| | before (`write.v4+shared.v3`) | after |
|---|---|---|
| technical | passed | `stat → diagram` · 2/2 carry a shape |
| science | passed | `reveal → slider → diagram → open` · 2/4 |
| **humanities** | **`reveal → open` · 0/2 · 2 of 4 cards dropped · FAILED** | **`spot → open` · 1/2 · nothing dropped** |

All three: 0% headline-plus-paragraph, variety clean, **one attempt each** — no retries burned on
cap overshoot, where the baseline lost half a batch.

The humanities fix is the one that mattered, and it landed exactly where the diagnosis pointed. The
writer now reaches for `spot` on text: three real sentences from *Emma*, and you hunt for the one
where the narrator's voice defects to the character.

> ✗ "It was a wretched business, indeed!" — *'wretched' — that word choice, that exclamation. hers.
> the narrator lent her the sentence without endorsing it.*
>
> reveal: *the grammar never left third person past tense. the diction defected to her, and you were
> never told it switched hands. that is the whole trick.*

Two things worth naming beyond the shape count. The other two sentences carry notes explaining why
they are NOT the tell ("flat report. anyone standing in the room could have written it") — a wrong
tap teaches, which is the rule the schema could never enforce. And `anchor` came back populated
(`free-indirect-tells`, `the-trick-explained`): before this pass NO prompt had ever mentioned the
field, so every anchor in production was a copy-derived guess and callbacks were joining on guesses.

Also fixed this cycle, from a 24-slide read-through rather than a test: every batch was ending
`checkpoint → crossroads`. `completes` fires at every node boundary and a planner whose estCards sits
near BATCH_SIZE makes that EVERY batch — four flexes in 24 slides, ~17% of the feed being cards about
the feed. The crossroads already names what just finished, so the checkpoint was the second voice
saying it. A flex now waits 12 rows for its turn.

Known and not fixed: `buildWriteSystem` is byte-stable across mode/recent/batchSize but NOT across
`allowedTypes`, which the variety governor narrows per batch — so a session ping-pongs between up to
four ~10k-token system prompts and misses the prompt cache on each flip. Pre-existing, and a
deliberate trade: a narrowed schema means the writer *cannot* emit a concept, where a prompt-level
ban is only a nudge that costs a retry when ignored.

## v4 — the depth rail, home covers, and both audits paid down

Started from the owner's list: a truthful position indicator he'd actually like the look of, a big
UI/UX pass, no more placeholders, better session tiles, a better scroll, better prompts, research-
backed teaching, a logic audit, and a user-visible list of what the AI does. Ran five research
sweeps (distilled in RESEARCH.md) and two end-to-end code audits before designing anything.

- **The top hairline is dead. The indicator is now a vertical DEPTH RAIL** on the right edge —
  position maps to geometry in the axis the feed actually moves in. Solid above the thumb = read;
  bright below = cards that exist; dashed fading = planned; the pulse sits at the written frontier
  only while a batch is in flight; a fork is a gate mark with everything downstream dimmed (no
  pulse — generation truly stops); wrapped is a hard end cap. Topic ticks get proportional spans
  (impossible in 393px of width, trivial in 700px of height). Endowed start: the thumb never begins
  at zero — the paste and the plan count as distance travelled (Nunes & Drèze). Ambient like an iOS
  scrollbar: swells while scrolling, fades at rest. Long-press → the thread sheet, now styled as a
  vertical path speaking the rail's language, carrying the app's only number ("~3 min left in this
  thread", on demand, time-as-effort).
- **Home tiles became covers.** Each tile is typeset in its own session's palette, texture and
  display font — the shelf reads as a shelf of magazines. State lines in feed voice ("parked at a
  fork", "fresh cards waiting", "wrapped — the thread's still there"), relative recency, a wordless
  rail sliver for depth. The unexplained ring and gradient strip are gone; wrapped sessions show
  again (they were filtered out entirely — "wrapped" tiles could never render); the FAB overlaps
  nothing.
- **Planning is theatre, not skeletons**: the palette surfaces, the persona introduces itself, the
  outline ticks onto a proto-rail that becomes the rail. No grey rectangles, no fake progress.
- **"how this works"** — a panel on home and in the tile menu: ~20 one-liners in feed voice, one per
  real capability, enumerated from code ("how you answer quietly sets how hard it runs — lucky taps
  barely move it, real ones do"; "it carries the plot the whole way — card 40 still knows what card
  1 promised").
- **The generation audit paid down**: the planner's spine now actually seeds the storyline (it was
  computed, demanded at length, and thrown away); detours go through the variety governor like
  everything else; a recap trigger survives a failed write; the frontier supersede check compares
  the full key, not just the epoch; duplicate directives deduped (one owner per signal); the
  crossroads button stops saying its topic twice, once truncated; checkpoint prediction reconciled
  with what the governor actually kept.
- **The feed audit paid down**: the catching-up tail can no longer render below an unanswered
  crossroads; refetchAll pages past 100 rows; a deliberate map jump no longer reads as a confusion
  scroll-back; a forced pump can't be swallowed by an in-flight one; WebKit's snap-point cache is
  busted after every deck mutation (protects the pin on real devices); fast flicks land on settled
  cards, slow arrivals get the cascade.
- **Three research wins in the writer**: causal threading (each card opens off the previous one's
  idea — a batch reads as an argument), bet-before-explain ordering (the pretesting effect done
  feed-natively: the scored card sorts before the concept that resolves it, on the same anchor),
  and a 1-in-5-with-jitter jackpot cadence (variable-ratio anticipation, Fiorillo 2003).
- **Card polish**: emoji dial pills (🧒/🎓 — a graduation cap, in this app) replaced with
  typographic chips; per-type optical anchoring so the dead bottom third works; body measure in ch;
  contrast repair on planner themes (never reject, always nudge to AA/AAA); hooks push a size larger
  when short.

Verified: 819 unit / 42 e2e green (I re-ran the full gate myself after the workflow's own pass),
live prose re-run against the new prompts — all three families pass, humanities now
`spot → binary → diagram → open` with visible threading (the binary builds on the spot card's find)
and nothing dropped. Screenshot review of every new surface at 393×852 DSF3.

Known and open: the two standing human judgments (callback density on a real phone; composition
airiness), the mock planner's 3 canned themes making a mock shelf look samey, and diagram SVGs
top-anchoring in their fill area.
