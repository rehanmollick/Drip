import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestUrlBody } from "@/lib/api/contract";
import { ingestUrl } from "@/lib/ingest/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ingest/url — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestUrlBody);
  const data = await ingestUrl(url);
  return ok(data);
});
