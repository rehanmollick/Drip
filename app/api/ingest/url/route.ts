import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestUrlBody } from "@/lib/api/contract";
import { ingestUrl } from "@/lib/ingest/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform function timeout: above the route's own budget (10s fetch + jsdom/readability on ≤3MB) so its enveloped errors win over a bare 504. */
export const maxDuration = 30;

/** POST /api/ingest/url — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestUrlBody);
  const data = await ingestUrl(url);
  return ok(data);
});
