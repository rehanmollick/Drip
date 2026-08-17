import { ListCardsQuery } from "@/lib/api/contract";
import { handle, ok } from "@/lib/api/envelope";
import { getSessionOr404, listCardsPage } from "@/lib/generation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/sessions/:id/cards?after=idx&limit=12 — replay + runway fetch. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const q = ListCardsQuery.parse({ after: url.searchParams.get("after") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });
  await getSessionOr404(id);
  const { cards, hasMore } = await listCardsPage(id, q.after ?? null, q.limit);
  return ok({ cards, hasMore });
});
