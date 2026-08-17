import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { HttpError } from "@/lib/api/envelope";
import type { IngestData } from "@/lib/api/contract";
import { capText, normalizeText } from "./text";

/**
 * URL ingestion — server-side fetch + readability strip (spec §6.1 path 3).
 * Split into fetchHtml (network) and extractReadable (pure) so extraction is
 * testable with inline HTML fixtures.
 */

export const URL_FETCH_TIMEOUT_MS = 10_000;
export const URL_MAX_BYTES = 3 * 1024 * 1024;
export const URL_MAX_TEXT_CHARS = 200_000;
const MIN_READABLE_CHARS = 200;
const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; drip/0.1; +https://drip.app) AppleWebKit/537.36 Safari/537.36";

// ── SSRF guard ───────────────────────────────────────────────────────────────

const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "[::1]", "::1", "[::]", "::"]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;          // loopback, private, "this" network
  if (a === 169 && b === 254) return true;                    // link-local / cloud metadata
  if (a === 192 && b === 168) return true;                    // private
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 100 && b >= 64 && b <= 127) return true;          // carrier-grade NAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local, ULA
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (dotted) return isPrivateIpv4(dotted[1]);
  const hexed = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // URL parser normalizes ::ffff:127.0.0.1 → ::ffff:7f00:1
  if (hexed) {
    const hi = parseInt(hexed[1], 16);
    const lo = parseInt(hexed[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

/** Returns true when the URL may be fetched from the server (http(s), public host). */
export function isSafeUrl(input: string): boolean {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
  return true;
}

export function assertSafeUrl(input: string): URL {
  if (!isSafeUrl(input)) throw new HttpError(400, "bad_url", "that link can't be fetched — use a public http(s) url");
  return new URL(input);
}

// ── fetch ────────────────────────────────────────────────────────────────────

export type FetchedPage = { html: string; finalUrl: string; contentType: string };

/** Fetch a page with a hard timeout, manual (guarded) redirects, and a byte cap. */
export async function fetchHtml(input: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? URL_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? URL_MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url = assertSafeUrl(input);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.8",
          },
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new HttpError(504, "fetch_timeout", "that page took too long to load");
        throw new HttpError(502, "fetch_failed", "couldn't reach that page", String(e));
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === MAX_REDIRECTS) throw new HttpError(502, "fetch_failed", "too many redirects");
        url = assertSafeUrl(new URL(loc, url).toString());
        continue;
      }
      if (!res.ok) throw new HttpError(502, "fetch_failed", `that page answered ${res.status}`);
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (/^(image|video|audio|font)\//.test(contentType) || contentType.includes("application/octet-stream")) {
        throw new HttpError(422, "unreadable", "that link isn't a readable page");
      }
      const html = await readCapped(res, maxBytes);
      return { html, finalUrl: url.toString(), contentType };
    }
    throw new HttpError(502, "fetch_failed", "too many redirects");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, buf.byteLength - off);
    buf.set(c.subarray(0, n), off);
    off += n;
    if (off >= buf.byteLength) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ── extract ──────────────────────────────────────────────────────────────────

export type ReadableMeta = {
  url: string;
  title: string | null;
  siteName: string | null;
  byline: string | null;
  excerpt: string | null;
  length: number;
};

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "CANVAS", "HEAD"]);
const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "PRE", "BLOCKQUOTE",
  "TABLE", "TR", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "HR", "DETAILS", "SUMMARY",
]);

/** Walk a DOM subtree into plain text, inserting paragraph breaks at block boundaries. */
function domToText(node: Node): string {
  if (node.nodeType === 3) return (node.nodeValue ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return "";
  const el = node as Element;
  const tag = el.tagName?.toUpperCase?.() ?? "";
  if (SKIP_TAGS.has(tag)) return "";
  if (tag === "BR") return "\n";
  let out = "";
  for (const child of Array.from(node.childNodes)) out += domToText(child);
  if (tag === "LI") return `\n• ${out.trim()}\n`;
  if (tag === "PRE") return `\n${el.textContent ?? ""}\n`;
  if (BLOCK_TAGS.has(tag)) return `\n${out}\n`;
  return out;
}

/** Pure: HTML string → readable text + meta. Throws HttpError(422) when nothing readable is found. */
export function extractReadable(html: string, url: string): { text: string; meta: ReadableMeta } {
  const dom = new JSDOM(html, { url, pretendToBeVisual: false });
  const doc = dom.window.document;
  let text = "";
  let meta: ReadableMeta = { url, title: doc.title?.trim() || null, siteName: null, byline: null, excerpt: null, length: 0 };
  try {
    const clone = doc.cloneNode(true) as Document;
    const article = new Readability<Node>(clone, { serializer: (n) => n }).parse();
    if (article) {
      const content = article.content;
      text = normalizeText(content ? domToText(content) : article.textContent ?? "");
      meta = {
        url,
        title: article.title?.trim() || meta.title,
        siteName: article.siteName?.trim() || null,
        byline: article.byline?.trim() || null,
        excerpt: article.excerpt?.trim() || null,
        length: text.length,
      };
    }
  } catch {
    // fall through to body text
  }
  if (text.length < MIN_READABLE_CHARS) {
    const body = doc.body ? normalizeText(domToText(doc.body)) : "";
    if (body.length > text.length) {
      text = body;
      meta = { ...meta, length: text.length };
    }
  }
  if (!meta.siteName) {
    const og = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    if (og) meta.siteName = og.trim();
  }
  if (!meta.excerpt) {
    const desc = doc.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute("content");
    if (desc) meta.excerpt = desc.trim();
  }
  dom.window.close();
  if (text.length < MIN_READABLE_CHARS) {
    throw new HttpError(422, "unreadable", "couldn't pull readable text from that page");
  }
  text = capText(text, URL_MAX_TEXT_CHARS);
  meta.length = text.length;
  return { text, meta };
}

/** Plain-text responses (text/plain, markdown) skip readability entirely. */
function extractPlain(raw: string, url: string, title: string | null): { text: string; meta: ReadableMeta } {
  const text = capText(normalizeText(raw), URL_MAX_TEXT_CHARS);
  if (text.length < MIN_READABLE_CHARS) throw new HttpError(422, "unreadable", "couldn't pull readable text from that page");
  return { text, meta: { url, title, siteName: null, byline: null, excerpt: null, length: text.length } };
}

/** POST /api/ingest/url — fetch + strip a public web page into IngestData. */
export async function ingestUrl(input: string): Promise<IngestData> {
  const page = await fetchHtml(input);
  const isPlain = page.contentType.startsWith("text/plain") || page.contentType.startsWith("text/markdown");
  const { text, meta } = isPlain
    ? extractPlain(page.html, page.finalUrl, new URL(page.finalUrl).pathname.split("/").filter(Boolean).pop() ?? null)
    : extractReadable(page.html, page.finalUrl);
  return {
    text,
    sourceKind: "url",
    meta: { ...meta },
    title: meta.title ?? undefined,
  };
}
