import type { SourceKind } from "@/lib/schemas/session";

/**
 * New-session input routing (spec §6.1). Pure; unit-tested in tests/feed.input.test.ts.
 *
 *   lone YouTube URL       → POST /api/ingest/youtube
 *   lone github repo URL   → POST /api/ingest/repo
 *   any other lone URL     → POST /api/ingest/url
 *   else                   → text, sourceKind = sentence | transcript | paste
 */
export type InputRoute =
  | { kind: "youtube"; url: string }
  | { kind: "repo"; url: string }
  | { kind: "url"; url: string }
  | { kind: "text"; sourceKind: Extract<SourceKind, "sentence" | "paste" | "transcript"> };

export function ingestPath(kind: "youtube" | "repo" | "url"): string {
  return `/api/ingest/${kind}`;
}

const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i;

/** The whole input is one URL (optionally without scheme). Returns a normalized https URL or null. */
export function loneUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  if (!URL_RE.test(t)) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.length > 1;
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.has("v");
      return /^\/(shorts|live|embed)\/[^/]+/.test(u.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export function isRepoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, "") !== "github.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    // /owner/repo or /owner/repo/tree/branch/... — but not /owner alone or org pages
    return !["orgs", "settings", "marketplace", "topics", "sponsors"].includes(parts[0]);
  } catch {
    return false;
  }
}

/** Timestamps like `00:12`, `[00:01:23]`, `12:34 -->` on several lines → transcript. */
export function looksLikeTranscript(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 4) return false;
  const stamp = /(^|\s|\[|\()(\d{1,2}:)?\d{1,2}:\d{2}(\.\d{1,3})?(\]|\)|\s|$|-->)/;
  let hits = 0;
  for (const l of lines) if (stamp.test(l)) hits++;
  return hits >= 3 && hits / lines.length >= 0.15;
}

export function routeInput(raw: string, opts: { attachedFile?: boolean } = {}): InputRoute {
  const url = loneUrl(raw);
  if (url) {
    if (isYoutubeUrl(url)) return { kind: "youtube", url };
    if (isRepoUrl(url)) return { kind: "repo", url };
    return { kind: "url", url };
  }
  const text = raw.trim();
  if (!opts.attachedFile && text.length < 200 && !/\n/.test(text)) return { kind: "text", sourceKind: "sentence" };
  if (opts.attachedFile || looksLikeTranscript(text)) return { kind: "text", sourceKind: "transcript" };
  return { kind: "text", sourceKind: "paste" };
}
