-- DRIP — initial schema (spec §9). Apply in the Supabase SQL editor or via
-- `supabase db push`. `pnpm db:migrate` prints this file.
--
-- Notes
--   * cards.idx is a fractional-indexing string key ordered lexicographically
--     (detour splices never rewrite rows). unique per session.
--   * batches (session_id, frontier_key) is the idempotency guard for generation.
--   * enums are text + check constraints so adding a value is a one-line migration.

create extension if not exists "pgcrypto";

-- ── sessions ────────────────────────────────────────────────────────────────
create table if not exists sessions (
  id                uuid primary key,
  title             text not null,
  source_kind       text not null check (source_kind in ('sentence','paste','url','repo','youtube','transcript')),
  source_meta       jsonb not null default '{}'::jsonb,
  source_text       text not null default '',
  theme             jsonb,
  persona           jsonb,
  outline           jsonb not null default '[]'::jsonb,
  settings          jsonb not null default '{}'::jsonb,
  learner_state     jsonb not null default '{}'::jsonb,
  progress          jsonb not null default '{}'::jsonb,
  clarifier_answers jsonb not null default '{}'::jsonb,
  status            text not null check (status in ('planning','active','archived','error')),
  error             text,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  last_opened_at    timestamptz not null default now()
);
create index if not exists sessions_last_opened_idx on sessions (last_opened_at desc);

-- ── cards ───────────────────────────────────────────────────────────────────
create table if not exists cards (
  id          uuid primary key,
  session_id  uuid not null references sessions(id) on delete cascade,
  idx         text not null,
  type        text not null,
  payload     jsonb not null,
  detour_id   uuid,
  batch_id    uuid,
  viewed_at   timestamptz,
  interaction jsonb,
  created_at  timestamptz not null default now(),
  unique (session_id, idx)
);
create index if not exists cards_session_idx_idx on cards (session_id, idx);

-- ── detours ─────────────────────────────────────────────────────────────────
create table if not exists detours (
  id                 uuid primary key,
  session_id         uuid not null references sessions(id) on delete cascade,
  parent_detour_id   uuid,
  question           text not null,
  inserted_after_idx text not null,
  created_at         timestamptz not null default now()
);
create index if not exists detours_session_idx on detours (session_id);

-- ── batches (idempotent generation) ─────────────────────────────────────────
create table if not exists batches (
  id           uuid primary key,
  session_id   uuid not null references sessions(id) on delete cascade,
  frontier_key text not null,
  status       text not null check (status in ('pending','done','failed')),
  card_ids     jsonb not null default '[]'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (session_id, frontier_key)
);

-- ── llm_calls (observability + spend cap) ───────────────────────────────────
create table if not exists llm_calls (
  id             uuid primary key,
  session_id     text,
  purpose        text not null check (purpose in ('plan','write','triage','chat','detour','replan')),
  model          text not null,
  prompt_version text not null default '',
  in_tokens      integer not null default 0,
  out_tokens     integer not null default 0,
  latency_ms     integer not null default 0,
  ok             boolean not null,
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists llm_calls_created_idx on llm_calls (created_at desc);
create index if not exists llm_calls_session_idx on llm_calls (session_id, created_at desc);

-- Row level security: the app talks to Postgres with the service role key
-- (server-only), so RLS is enabled with no policies — the anon key can't read anything.
alter table sessions  enable row level security;
alter table cards     enable row level security;
alter table detours   enable row level security;
alter table batches   enable row level security;
alter table llm_calls enable row level security;
