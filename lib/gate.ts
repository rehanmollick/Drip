/**
 * Personal-deployment door lock. DRIP has no accounts by design (spec §14) — this is not auth,
 * it's one shared passphrase in front of a personal deployment so a leaked URL can't spend the
 * owner's LLM budget or read their feeds.
 *
 * Off unless DRIP_PASSPHRASE is set, so local dev and Playwright are untouched.
 * The cookie holds an HMAC of the passphrase, never the passphrase itself; it is compared in
 * constant time. Edge-runtime safe (WebCrypto only — middleware cannot use node:crypto).
 */
export const GATE_COOKIE = "drip_gate";
export const GATE_PATH = "/unlock";
/** A year: this is a home-screen app; being asked again every week would be its own kind of broken. */
export const GATE_MAX_AGE = 60 * 60 * 24 * 365;

const enc = new TextEncoder();

export function gateEnabled(secret: string | undefined = process.env.DRIP_PASSPHRASE): secret is string {
  return typeof secret === "string" && secret.length > 0;
}

/** Cookie value for a passphrase: a hex HMAC, so the cookie can't be turned back into the phrase. */
export async function gateToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("drip-gate-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Timing-safe compare of two same-length hex strings (length differences leak nothing useful here). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isUnlocked(cookieValue: string | undefined, secret: string): Promise<boolean> {
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await gateToken(secret));
}
