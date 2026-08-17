import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestRepoBody } from "@/lib/api/contract";
import { ingestRepo } from "@/lib/ingest/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ingest/repo — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestRepoBody);
  const data = await ingestRepo(url);
  return ok(data);
});
