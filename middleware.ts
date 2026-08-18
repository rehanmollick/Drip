import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_PATH, gateEnabled, isUnlocked } from "@/lib/gate";

/**
 * Door lock for personal deployments (see lib/gate.ts). No-op unless DRIP_PASSPHRASE is set.
 * Everything except the unlock page, the icons and the manifest is gated — including /api,
 * which is what actually protects the spend.
 */
export async function middleware(req: NextRequest) {
  const secret = process.env.DRIP_PASSPHRASE;
  if (!gateEnabled(secret)) return NextResponse.next();
  if (await isUnlocked(req.cookies.get(GATE_COOKIE)?.value, secret)) return NextResponse.next();

  // API calls get a clean 401 in the app's own envelope rather than an HTML redirect.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { data: null, error: { code: "locked", message: "this drip is locked. open it in the browser and enter the passphrase." }, meta: {} },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = GATE_PATH;
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // the unlock page, PWA icons and the manifest stay open so the lock screen renders and the app installs
  matcher: ["/((?!unlock|api/unlock|icons/|manifest.webmanifest|offline.html|sw.js|_next/static|_next/image|favicon.ico).*)"],
};
