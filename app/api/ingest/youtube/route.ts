import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestYoutubeBody } from "@/lib/api/contract";
import { ingestYoutube } from "@/lib/ingest/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Platform function timeout: above the route's own budget (≤25s budget across the library's 2-3 calls) so its enveloped errors win over a bare 504. */
export const maxDuration = 30;

/** POST /api/ingest/youtube — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestYoutubeBody);
  const data = await ingestYoutube(url);
  return ok(data);
});
