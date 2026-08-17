import { GenerateBody } from "@/lib/api/contract";
import { handle, ok } from "@/lib/api/envelope";
import { generateNext, getSessionOr404 } from "@/lib/generation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/generate — next batch (idempotent per frontier). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  // body is informational; tolerate empty/invalid bodies
  await req.json().then((b) => GenerateBody.parse(b)).catch(() => ({}));
  await getSessionOr404(id);
  const data = await generateNext(id);
  return ok(data);
});
