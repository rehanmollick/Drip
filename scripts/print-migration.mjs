#!/usr/bin/env node
// `pnpm db:migrate` — prints the SQL migrations so you can paste them into the
// Supabase SQL editor (or `supabase init` + `supabase db push` if you use the CLI).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

process.stderr.write(
  [
    "",
    "DRIP — database migration",
    "─────────────────────────",
    "Apply the SQL below to your Supabase project (all statements are idempotent; re-running is safe):",
    "  1. Supabase dashboard → SQL editor → new query → paste → run",
    "  2. or with the CLI: supabase init (keep existing migrations) && supabase link --project-ref <ref> && supabase db push",
    "Then set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local (see supabase/README.md).",
    "",
    "",
  ].join("\n"),
);

for (const f of files) {
  process.stdout.write(`-- ==== ${f} ====\n`);
  process.stdout.write(readFileSync(join(dir, f), "utf8"));
  process.stdout.write("\n");
}
