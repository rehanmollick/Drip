import { after } from "next/server";
import { RemixSessionBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { getSessionOr404, providedSettings, remixSession, startPlanning } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/remix — new session, same source, new settings. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const raw = (await req.clone().json().catch(() => null)) as { settings?: unknown } | null;
  const body = await parseBody(req, RemixSessionBody);
  await getSessionOr404(id);
  const session = await remixSession(id, providedSettings(body.settings, raw?.settings));
  after(() => startPlanning(session.id));
  return ok({ session: toPublic(session, 0) }, {}, { status: 201 });
});
