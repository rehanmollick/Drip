import { after } from "next/server";
import { InteractBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { interact, replan } from "@/lib/generation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/cards/:id/interact — record view/choice/dwell, reduce learner state, maybe insert a recap. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, InteractBody);
  const { card, learnerState, inserted, replanReady } = await interact(id, body);
  if (replanReady) after(() => replan(card.sessionId));
  return ok({ card, learnerState, inserted });
});
