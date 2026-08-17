import { after } from "next/server";
import { CreateSessionBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { createSession, listSessions, startPlanning } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions — home list, most recently opened first. */
export const GET = handle(async () => {
  const sessions = await listSessions();
  return ok({ sessions: sessions.map((s) => toPublic(s)) });
});

/** POST /api/sessions — create; planning continues after the response. */
export const POST = handle(async (req) => {
  const body = await parseBody(req, CreateSessionBody);
  const session = await createSession(body);
  after(() => startPlanning(session.id));
  return ok({ session: toPublic(session, 0) }, {}, { status: 201 });
});
