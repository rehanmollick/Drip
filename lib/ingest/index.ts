/**
 * Ingestion entry points (spec §6.1 paths 3–5). Each returns IngestData
 * ({ text, sourceKind, meta, title? }) ready to be posted to POST /api/sessions
 * as { input: text, sourceKind, sourceMeta: meta, title }.
 */
export { ingestUrl, fetchHtml, extractReadable, isSafeUrl, assertSafeUrl } from "./url";
export { ingestRepo, getRepoFile, parseRepoUrl, summarizeTree, buildRepoText, keepPath } from "./repo";
export { ingestYoutube, extractVideoId, formatTranscript, normalizeSegments, formatTimestamp } from "./youtube";
export { normalizeText, capText } from "./text";
