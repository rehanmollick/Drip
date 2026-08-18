import { NextResponse } from "next/server";
import { GATE_COOKIE, GATE_MAX_AGE, gateEnabled, gateToken, safeEqual } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { passphrase } → sets the gate cookie when it matches. Deliberately not enveloped-generic: it predates the app. */
export async function POST(req: Request) {
  const secret = process.env.DRIP_PASSPHRASE;
  if (!gateEnabled(secret)) return NextResponse.json({ ok: true });
  let passphrase = "";
  try {
    passphrase = String(((await req.json()) as { passphrase?: unknown }).passphrase ?? "");
  } catch {
    passphrase = "";
  }
  const [given, want] = await Promise.all([gateToken(passphrase), gateToken(secret)]);
  if (!safeEqual(given, want)) {
    // a beat of delay so the lock isn't a fast oracle to hammer
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, want, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GATE_MAX_AGE,
  });
  return res;
}
