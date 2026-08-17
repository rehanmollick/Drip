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
