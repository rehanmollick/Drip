import { after } from "next/server";
import { handle, ok } from "@/lib/api/envelope";
import { frontierOf, generateNext, getSessionOr404, retrySession, startPlanning } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/retry — planning error → plan again; trailing fallback → drop it and regenerate. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  await getSessionOr404(id);
  const { session, action } = await retrySession(id);
  if (action === "replan") after(() => startPlanning(id));
  if (action === "regenerate") after(() => generateNext(id).catch(() => undefined));
  return ok({ session: toPublic(session, undefined, await frontierOf(id)) });
});
