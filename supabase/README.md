# Supabase for DRIP

Production persistence is Supabase Postgres (`lib/db/supabase.ts`). Without the
env vars below, DRIP falls back to a local JSON store in `.data/` (dev/tests only).

## 1. Create a project

1. https://supabase.com → New project (any region; free tier is fine).
2. Wait for the database to provision (~1 min).

## 2. Apply the migration

Print it:

```
pnpm db:migrate
```

Then either paste the output into **SQL editor → New query → Run**, or with the CLI:

```
supabase link --project-ref <your-project-ref>
supabase db push
```

Migrations live in `supabase/migrations/*.sql` and are applied in filename order.

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
| `cards`     | validated card JSON, `idx` = fractional-indexing string key |
| `detours`   | ask-bar detours (nesting via `parent_detour_id`)            |
| `batches`   | idempotency guard: unique `(session_id, frontier_key)`      |
| `llm_calls` | every model call; daily spend cap is computed from here     |
