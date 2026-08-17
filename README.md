# drip

TikTok's format, a great teacher's brain. Paste anything — a sentence, a doc dump, a URL, a GitHub repo, a YouTube link, a lecture transcript — and get an infinite, adaptive, snap-scrolling feed that teaches it, with a visual identity generated from the subject itself.

`dripSpec.md` is the source of truth. `CLAUDE.md` is the working contract.

## Run it

```bash
pnpm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY (+ Supabase for real persistence)
pnpm dev                     # http://localhost:3000
```

Without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` the app uses a local JSON store in `.data/` (fine for dev on one machine). Without `ANTHROPIC_API_KEY` generation degrades to fallback cards (the feed never crashes). `LLM_MODE=mock` runs the whole pipeline on deterministic canned output — that's what Playwright uses.

## Supabase

Create a free project, run `supabase/migrations/0001_init.sql` in the SQL editor (or `pnpm db:migrate` to print it), then set the two env vars. Free tier pauses after inactivity; the app retries the first cold query once.

## Verify

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit
pnpm test:e2e                              # Playwright, iPhone 14 Pro viewport 393×852 @3x
```

Real-device checks (standalone PWA scroll feel, offline, lock-screen dwell) live in `MANUAL_CHECKLIST.md`. Build notes per phase are in `BUILD_LOG.md`.

## Deploy

Vercel: import the repo, set the env vars, deploy. Open the preview URL on an iPhone → Share → Add to Home Screen.
