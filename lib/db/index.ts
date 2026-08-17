import type { Store } from "./store";

/**
 * Store selection: Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 * (or DRIP_STORE=supabase), otherwise the local JSON store (dev/tests only).
 * `DRIP_STORE=supabase|local` forces a store; any other value is ignored (with a warning).
 */
let cached: Store | null = null;
let warnedUnknown = false;

export function storeKind(): "supabase" | "local" {
  const forced = process.env.DRIP_STORE;
  if (forced === "supabase" || forced === "local") return forced;
  if (forced && !warnedUnknown) {
    warnedUnknown = true;
    console.warn(`[db] DRIP_STORE="${forced}" is not a store — expected "supabase" or "local"; picking by env presence.`);
  }
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local";
}

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (storeKind() === "supabase") {
    const { createSupabaseStore } = await import("./supabase");
    cached = createSupabaseStore();
  } else {
    if (process.env.NODE_ENV === "production") {
      // Loud on purpose: the JSON file store is process-local and .data/ is read-only or ephemeral on most hosts,
      // so every write route would 500 (or vanish on the next cold start) while reads keep "working" from memory.
      const why = process.env.DRIP_STORE === "local"
        ? "DRIP_STORE=local is set"
        : "Supabase env missing (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)";
      console.warn(
        `[db] production is using the LOCAL JSON store (${why}) at ${process.env.DRIP_DATA_DIR ?? ".data"}. ` +
          "It is dev/tests only: not shared across instances, lost on redeploy, and it fails on a read-only filesystem. " +
          "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for real persistence.",
      );
    }
    const { createLocalStore } = await import("./local");
    cached = createLocalStore();
  }
  return cached;
}
