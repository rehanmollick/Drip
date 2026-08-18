import { describe, expect, it } from "vitest";
import { GATE_COOKIE, gateEnabled, gateToken, isUnlocked, safeEqual } from "@/lib/gate";
import { middleware } from "@/middleware";
import type { NextRequest } from "next/server";

function req(pathname: string, cookie?: string): NextRequest {
  const url = new URL(`https://drip.test${pathname}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    cookies: { get: (n: string) => (n === GATE_COOKIE && cookie ? { value: cookie } : undefined) },
  } as unknown as NextRequest;
}

describe("passphrase gate", () => {
  it("is off unless DRIP_PASSPHRASE is set (local dev and e2e are untouched)", async () => {
    expect(gateEnabled(undefined)).toBe(false);
    expect(gateEnabled("")).toBe(false);
    expect(gateEnabled("hunter2")).toBe(true);
    delete process.env.DRIP_PASSPHRASE;
    const res = await middleware(req("/s/abc"));
    expect(res.status).toBe(200); // NextResponse.next()
  });

  it("never puts the passphrase in the cookie and compares in constant time", async () => {
    const token = await gateToken("open sesame");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain("open");
    expect(await gateToken("open sesame")).toBe(token); // stable
    expect(await gateToken("open sesamf")).not.toBe(token);
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, "0".repeat(64))).toBe(false);
    expect(safeEqual(token, "abc")).toBe(false);
  });

  it("unlocks only with the matching cookie", async () => {
    const good = await gateToken("s3cret");
    expect(await isUnlocked(good, "s3cret")).toBe(true);
    expect(await isUnlocked(good, "other")).toBe(false);
    expect(await isUnlocked(undefined, "s3cret")).toBe(false);
    expect(await isUnlocked("", "s3cret")).toBe(false);
  });

  it("locked: pages redirect to /unlock (keeping where you were headed), api gets an enveloped 401", async () => {
    process.env.DRIP_PASSPHRASE = "s3cret";
    try {
      const page = await middleware(req("/s/abc123"));
      expect(page.status).toBe(307);
      const loc = new URL(page.headers.get("location")!);
      expect(loc.pathname).toBe("/unlock");
      expect(loc.searchParams.get("next")).toBe("/s/abc123");

      const api = await middleware(req("/api/sessions"));
      expect(api.status).toBe(401);
      const body = await api.json();
      expect(body).toMatchObject({ data: null, error: { code: "locked" }, meta: {} });
      expect(JSON.stringify(body)).not.toContain("s3cret");

      const unlocked = await middleware(req("/api/sessions", await gateToken("s3cret")));
      expect(unlocked.status).toBe(200);
    } finally {
      delete process.env.DRIP_PASSPHRASE;
    }
  });
});
