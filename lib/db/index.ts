import type { Store } from "./store";

/**
 * Store selection: Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 * (or DRIP_STORE=supabase), otherwise the local JSON store (dev/tests only).
 * STUB — implementations land with the DB work package (local.ts, supabase.ts).
 */
let cached: Store | null = null;

export function storeKind(): "supabase" | "local" {
  const forced = process.env.DRIP_STORE;
  if (forced === "supabase" || forced === "local") return forced;
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (storeKind() === "supabase") {
    const { createSupabaseStore } = await import("./supabase");
    cached = createSupabaseStore();
  } else {
    if (process.env.NODE_ENV === "production" && process.env.DRIP_STORE !== "local") {
      console.warn("[db] Supabase env missing — using LOCAL JSON store (.data/). Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for real persistence.");
    }
    const { createLocalStore } = await import("./local");
    cached = createLocalStore();
  }
  return cached;
}
