import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import { HttpError } from "@/lib/api/envelope";
import type { IngestData } from "@/lib/api/contract";
import { capText, normalizeText } from "./text";

/**
 * YouTube ingestion (spec §6.1 path 5): caption pull only, no audio
 * transcription ever. Segments become timestamped paragraphs so the writer can
 * say "around the 12-minute mark".
 */

export const YT_PARAGRAPH_SECONDS = 60;
export const YT_PARAGRAPH_CHARS = 600;
export const YT_MAX_TEXT_CHARS = 200_000;
export const YT_MAX_META_SEGMENTS = 1_500;

export type TranscriptSegment = { text: string; offset: number; duration: number; lang?: string };
/** Normalized: seconds, not ms. */
export type Segment = { text: string; startSec: number; durationSec: number };

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Pull the 11-char video id out of any common youtube url shape (or a bare id). Null if none. */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") {
    id = parts[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "embed", "live", "v", "e"].includes(parts[0] ?? "")) id = parts[1] ?? null;
    else if (u.searchParams.get("v")) id = u.searchParams.get("v");
  } else {
    return null;
  }
  if (!id) return null;
  id = id.slice(0, 11);
  return ID_RE.test(id) ? id : null;
}

/** [mm:ss] or [h:mm:ss]. */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `[${h}:${mm}:${ss}]` : `[${mm}:${ss}]`;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n: string) => ENTITY[n] ?? "")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * youtube-transcript 1.3.x returns ms from the srv3 path and seconds from the
 * classic-xml fallback. Caption cues basically never last < 100ms, so if the
 * median duration is < 100 we're looking at seconds.
 */
export function normalizeSegments(raw: TranscriptSegment[]): Segment[] {
  const cleaned = raw
    .map((r) => ({ ...r, text: decodeEntities(decodeEntities(r.text)).replace(/\s+/g, " ").trim() }))
    .filter((r) => r.text.length > 0 && Number.isFinite(r.offset));
  if (cleaned.length === 0) return [];
  const durations = cleaned.map((r) => (Number.isFinite(r.duration) ? r.duration : 0)).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  const divisor = median < 100 ? 1 : 1000;
  return cleaned.map((r) => ({
    text: r.text,
    startSec: r.offset / divisor,
    durationSec: (Number.isFinite(r.duration) ? r.duration : 0) / divisor,
  }));
}

/** Pure: segments → "[mm:ss] paragraph…" blocks, split every ~60s or ~600 chars. */
export function formatTranscript(
  segments: Segment[],
  opts: { paragraphSeconds?: number; paragraphChars?: number } = {},
): { text: string; durationSec: number; paragraphs: number } {
  const maxSec = opts.paragraphSeconds ?? YT_PARAGRAPH_SECONDS;
  const maxChars = opts.paragraphChars ?? YT_PARAGRAPH_CHARS;
  const blocks: string[] = [];
  let buf: string[] = [];
  let bufStart = 0;
  let bufChars = 0;
  const flush = () => {
    if (buf.length === 0) return;
    blocks.push(`${formatTimestamp(bufStart)} ${buf.join(" ")}`);
    buf = [];
    bufChars = 0;
  };
  for (const seg of segments) {
    if (buf.length && (seg.startSec - bufStart >= maxSec || bufChars + seg.text.length + 1 > maxChars)) flush();
    if (buf.length === 0) bufStart = seg.startSec;
    buf.push(seg.text);
    bufChars += seg.text.length + 1;
  }
  flush();
  const last = segments[segments.length - 1];
  const durationSec = last ? Math.round(last.startSec + (last.durationSec || 0)) : 0;
  return { text: normalizeText(blocks.join("\n\n")), durationSec, paragraphs: blocks.length };
}

/** POST /api/ingest/youtube — url → timestamped caption transcript. */
export async function ingestYoutube(input: string): Promise<IngestData> {
  const videoId = extractVideoId(input);
  if (!videoId) throw new HttpError(400, "bad_youtube_url", "that doesn't look like a youtube link");
  let raw: TranscriptSegment[];
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (e) {
    throw mapYoutubeError(e, videoId);
  }
  const segments = normalizeSegments(raw);
  if (segments.length === 0) throw new HttpError(422, "no_captions", "this video has no captions; paste a transcript instead.");
  const { text, durationSec, paragraphs } = formatTranscript(segments);
  const lang = raw.find((r) => r.lang)?.lang ?? null;
  return {
    text: capText(text, YT_MAX_TEXT_CHARS),
    sourceKind: "youtube",
    title: `youtube ${videoId}`,
    meta: {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      segmentCount: segments.length,
      segments: segments.slice(0, YT_MAX_META_SEGMENTS).map((s) => ({ t: Math.round(s.startSec * 10) / 10, text: s.text })),
      durationSec,
      paragraphs,
      lang,
    },
  };
}

export function mapYoutubeError(e: unknown, videoId: string): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof YoutubeTranscriptDisabledError || e instanceof YoutubeTranscriptNotAvailableError || e instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new HttpError(422, "no_captions", "this video has no captions; paste a transcript instead.");
  }
  if (e instanceof YoutubeTranscriptVideoUnavailableError) {
    return new HttpError(404, "video_unavailable", "that video isn't available");
  }
  if (e instanceof YoutubeTranscriptTooManyRequestError) {
    return new HttpError(429, "youtube_rate_limited", "youtube is rate-limiting us right now; try again in a bit");
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/disabled|no transcripts|not available/i.test(msg)) {
    return new HttpError(422, "no_captions", "this video has no captions; paste a transcript instead.");
  }
  return new HttpError(502, "youtube_error", "couldn't pull captions for that video", { videoId, cause: msg });
}
