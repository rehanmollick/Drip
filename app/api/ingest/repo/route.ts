import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestRepoBody } from "@/lib/api/contract";
import { ingestRepo } from "@/lib/ingest/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform function timeout: above the route's own budget (≤40s budget: meta + tree + parallel raw files) so its enveloped errors win over a bare 504. */
export const maxDuration = 45;

/** POST /api/ingest/repo — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestRepoBody);
  const data = await ingestRepo(url);
  return ok(data);
});
