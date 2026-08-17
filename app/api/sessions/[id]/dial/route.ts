import { DialBody } from "@/lib/api/contract";
import { handle, ok, parseBody } from "@/lib/api/envelope";
import { dial, getSessionOr404 } from "@/lib/generation/engine";
import { toPublic } from "@/lib/generation/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/dial — 🧒 simpler / 🎓 deeper. Drops the unviewed runway; the next generate regenerates it. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, DialBody);
  await getSessionOr404(id);
  const { session, toast, removedAfter } = await dial(id, body.direction, body.currentCardId);
  return ok({ session: toPublic(session), toast, removedAfter });
});
