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

const HOSTNAME_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;
/** Scheme-less `host/path` inputs count as URLs only for these hosts (and their subdomains). */
export const KNOWN_URL_HOSTS = ["youtube.com", "youtu.be", "github.com"] as const;

function hostMatchesKnown(host: string): boolean {
  const h = host.toLowerCase();
  return KNOWN_URL_HOSTS.some((k) => h === k || h.endsWith(`.${k}`));
}

/**
 * The whole input is one URL. Counts as a URL when it (a) has an http(s) scheme, (b) starts with
 * `www.`, or (c) is a bare `host/path` whose host is a known domain (youtube / github). Anything
 * else with a dot — `next.js`, `torch.nn`, `os.path` — is a sentence, not a link.
 * Returns a normalized https URL or null.
 */
export function loneUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      return HOSTNAME_RE.test(u.hostname) || u.hostname === "localhost" ? t : null;
    } catch {
      return null;
    }
  }
  const m = /^([a-z0-9.-]+)(:\d+)?(\/[^\s]*)?$/i.exec(t);
  if (!m) return null;
  const host = m[1];
  if (!HOSTNAME_RE.test(host)) return null;
  const startsWww = /^www\./i.test(host);
  const knownWithPath = hostMatchesKnown(host) && !!m[3];
  if (!startsWww && !knownWithPath) return null;
  return `https://${t}`;
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

/** Session titles are capped at 60 chars (contract); trim at a word boundary, never mid-word, never a 400. */
export const TITLE_MAX = 60;
export function clampTitle(title: string | undefined | null, max = TITLE_MAX): string | undefined {
  if (!title) return undefined;
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  const head = (at >= Math.floor(max / 2) ? cut.slice(0, at) : cut).replace(/[\s\-–—:;,.·|]+$/g, "");
  return head || cut;
}

/** Text inputs are capped at 400k chars (contract). */
export const INPUT_MAX = 400_000;
