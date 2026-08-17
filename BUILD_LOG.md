# BUILD_LOG.md — autonomous build self-review notes

One entry per phase (spec §13). Each entry: what was checked, what was fixed, what was deferred to MANUAL_CHECKLIST.md.

## Phase 0 — scaffold + contracts
- Next 15.5 (App Router) + Tailwind v4 (PostCSS) + TS strict; pnpm.
- Contracts written before any feature code: card schemas (13 spec types + internal `notice` and `clarify`), VisualSpec, ThemeSchema with curated 16-face font enums, plan/persona/triage/learner-state/session/card/detour/batch/llm_call schemas, API contract for every route, response envelope, Store interface, LLM layer types, CSS-variable theme contract, CardViewProps/Slide contract, ThemeRoot.
- Verified: `pnpm typecheck`, `pnpm build` (all 16 Google fonts self-host at build), pushed to GitHub.
- Decision: no Supabase/Anthropic credentials exist on this machine → the app selects a local JSON store (`.data/`) when Supabase env is absent and supports `LLM_MODE=mock` for deterministic end-to-end testing. Real credentials flip both automatically via env.
