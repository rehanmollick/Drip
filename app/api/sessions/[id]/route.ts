import { after } from "next/server";
import { PatchSessionBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { answerClarifiers, countCards, deleteSession, getSessionOr404, patchSession, providedSettings, replan } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/sessions/:id — detail (runs the planning watchdog lazily). */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const session = await getSessionOr404(id);
  return ok({ session: toPublic(session, await countCards(id)) });
});

/** PATCH /api/sessions/:id — settings / position / title / archive / clarifier answers. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const raw = (await req.clone().json().catch(() => null)) as { settings?: unknown } | null;
  const body = await parseBody(req, PatchSessionBody);
  await getSessionOr404(id);
  let session = await patchSession(id, { ...body, settings: body.settings ? providedSettings(body.settings, raw?.settings) : undefined });
  if (body.clarifierAnswers && Object.keys(body.clarifierAnswers).length) {
    const res = await answerClarifiers(id, body.clarifierAnswers);
    session = res.session;
    if (res.ready) after(() => replan(id));
  }
  return ok({ session: toPublic(session, await countCards(id)) });
});

/** DELETE /api/sessions/:id */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await getSessionOr404(id);
  await deleteSession(id);
  return ok({ deleted: true as const });
});
