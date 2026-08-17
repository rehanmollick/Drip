import { AskBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { ask, getSessionOr404 } from "@/lib/generation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/ask — triage → inline answer | detour splice. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, AskBody);
  await getSessionOr404(id);
  return ok(await ask(id, body.question, body.currentCardId));
});
