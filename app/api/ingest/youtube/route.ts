import { handle, ok, parseBody } from "@/lib/api/envelope";
import { IngestYoutubeBody } from "@/lib/api/contract";
import { ingestYoutube } from "@/lib/ingest/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ingest/youtube — { url } → IngestData */
export const POST = handle(async (req) => {
  const { url } = await parseBody(req, IngestYoutubeBody);
  const data = await ingestYoutube(url);
  return ok(data);
});
