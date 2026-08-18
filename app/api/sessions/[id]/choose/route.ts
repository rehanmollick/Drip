import { ChooseBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { chooseAtCrossroads, frontierOf, getSessionOr404 } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/sessions/:id/choose — the reader picked a direction at a crossroads.
 * keep going / one more layer / ask something / wrap it up. Generation is paused
 * until this lands, and a double tap is a no-op.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, ChooseBody);
  await getSessionOr404(id);
  const { session, cards } = await chooseAtCrossroads(id, body.cardId, body.choice);
  return ok({ session: toPublic(session, undefined, await frontierOf(id)), cards });
});
