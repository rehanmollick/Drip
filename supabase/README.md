# Supabase for DRIP

Production persistence is Supabase Postgres (`lib/db/supabase.ts`). Without the
env vars below, DRIP falls back to a local JSON store in `.data/` (dev/tests only).

## 1. Create a project

1. https://supabase.com → New project (any region; free tier is fine).
2. Wait for the database to provision (~1 min).

## 2. Apply the migrations

The documented path is the SQL editor — it needs nothing but the dashboard:

```
pnpm db:migrate
```

prints every file in `supabase/migrations/*.sql` in filename order. Paste the
output into **SQL editor → New query → Run**. Every statement is idempotent
(`create … if not exists`, `alter … type`), so re-running the whole thing on a
project that already has some of it applied is safe.

If you prefer the Supabase CLI, the repo ships only the migrations (no
`supabase/config.toml`), so initialise first:

```
supabase init            # creates supabase/config.toml — keep the existing migrations when asked
supabase link --project-ref <your-project-ref>
supabase db push
```

### Already applied `0001_init.sql` before `0002_idx_collation.sql` existed?

Run `0002_idx_collation.sql` (via `pnpm db:migrate` or the CLI). It switches
`cards.idx` / `detours.inserted_after_idx` to `collate "C"` (byte order), which
the fractional-indexing keys require. Without it Postgres orders `'aa'` before
`'aA'` and the feed stalls after ~37 cards; the store logs
`cards.idx is not collated in byte order` and falls back to app-side ordering
until you do.

## 3. Get the URL + service role key

Project → **Settings → API**:

- `Project URL` → `SUPABASE_URL`
- `service_role` secret (NOT the anon key) → `SUPABASE_SERVICE_ROLE_KEY`

Put both in `.env.local` (never commit them). The service role key bypasses RLS,
which is why the tables ship with RLS enabled and no policies: only the server
(API routes) can read/write. It must never reach the browser.

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

`DRIP_STORE=supabase|local` forces a store regardless of env presence.

## Cold starts

Free-tier projects pause after inactivity. The store retries the first failing
query once after 3s (spec §12.8); the app-shell splash covers that.

## Tables

| table       | purpose                                                     |
|-------------|-------------------------------------------------------------|
| `sessions`  | one row per feed: theme/persona/outline/learner state       |
| `cards`     | validated card JSON, `idx` = fractional-indexing key (`collate "C"`) |
| `detours`   | ask-bar detours (nesting via `parent_detour_id`)            |
| `batches`   | idempotency guard: unique `(session_id, frontier_key)`      |
| `llm_calls` | every model call; daily spend cap is computed from here     |
