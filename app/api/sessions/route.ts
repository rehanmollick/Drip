import { after } from "next/server";
import { CreateSessionBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { createSession, startPlanning } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions — home list, most recently opened first. */
export const GET = handle(async () => {
  const store = await getStore();
  const sessions = await store.listSessions();
  return ok({ sessions: sessions.map((s) => toPublic(s)) });
});

/** POST /api/sessions — create; planning continues after the response. */
export const POST = handle(async (req) => {
  const body = await parseBody(req, CreateSessionBody);
  const session = await createSession(body);
  after(() => startPlanning(session.id));
  return ok({ session: toPublic(session, 0) }, {}, { status: 201 });
});
