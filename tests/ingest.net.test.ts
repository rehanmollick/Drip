import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { HttpError } from "@/lib/api/envelope";
import {
  isPrivateIp,
  parseIpv6,
  pinnedFetch,
  readCapped,
  resolvePublicAddresses,
  UnsafeAddressError,
  type ResolvedAddress,
} from "@/lib/ingest/http";
import { fetchHtml, ingestUrl, isHtmlContent, looksBinary } from "@/lib/ingest/url";
import { getRepoFile, ingestRepo } from "@/lib/ingest/repo";
import { ingestYoutube, makeYoutubeFetch, mapYoutubeError, type YoutubeProbe } from "@/lib/ingest/youtube";
import { YoutubeTranscriptDisabledError } from "youtube-transcript";

/**
 * Network-level ingest tests: a throwaway local http server stands in for the
 * public web, and fetchHtml gets a resolver that pins "example.test" to it.
 * The resolver IS the SSRF guard, so injecting one is the only way to point the
 * pinned fetch at 127.0.0.1 — the real guard is tested separately below.
 */

// ── local server ─────────────────────────────────────────────────────────────

const PAGE = `<!doctype html><html><head><title>pinned page</title></head><body><article><h1>Pinned</h1>${Array.from(
  { length: 12 },
  (_, i) => `<p>Paragraph ${i}: the connection went to the address we vetted, with the original host header and nothing else, which is the whole point.</p>`,
).join("")}</article></body></html>`;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n%\xe4\xfc\xf6\xdf\n", "latin1"), Buffer.alloc(3000, 0x41)]);
let server: http.Server;
let port = 0;
let lastHost = "";
const hangingSockets: http.ServerResponse[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHost = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", "http://x");
    switch (url.pathname) {
      case "/page":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(PAGE);
      case "/gzip": {
        const gz = zlib.gzipSync(PAGE);
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": gz.length });
        return res.end(gz);
      }
      case "/redirect":
        res.writeHead(302, { location: "/page" });
        return res.end();
      case "/redirect-private":
        res.writeHead(302, { location: `http://private.test:${port}/page` });
        return res.end();
      case "/loop":
        res.writeHead(301, { location: "/loop" });
        return res.end();
      case "/pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end(PDF);
      case "/pdf-as-html":
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(PDF);
      case "/png":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
      case "/plain":
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("plain words here. ".repeat(40));
      case "/latin1":
        res.writeHead(200, { "content-type": "text/plain; charset=iso-8859-1" });
        return res.end(Buffer.from("caf\xe9 au lait ".repeat(30), "latin1"));
      case "/big":
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("x".repeat(100_000));
      case "/hang":
        hangingSockets.push(res);
        return; // never answers
      case "/slow-body": {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("start ");
        hangingSockets.push(res);
        return; // headers arrive, body never finishes
      }
      case "/500":
        res.writeHead(500);
        return res.end("nope");
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const r of hangingSockets) r.destroy();
  await new Promise<void>((r) => server.close(() => r()));
});

const LOCAL: ResolvedAddress[] = [{ address: "127.0.0.1", family: 4 }];
const resolveLocal = async (host: string) => {
  if (host === "private.test") throw new UnsafeAddressError(host);
  return LOCAL;
};
const local = (path: string) => `http://example.test:${port}${path}`;
const err = async (p: Promise<unknown>): Promise<HttpError> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error("expected HttpError");
};

// ── address classification ───────────────────────────────────────────────────

describe("ingest/http address guard", () => {
  it("expands ipv6 forms", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("[::ffff:127.0.0.1]")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6("64:ff9b::7f00:1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x7f00, 1]);
    expect(parseIpv6("fe80::1%en0")?.[0]).toBe(0xfe80);
    expect(parseIpv6("1.2.3.4")).toBeNull();
    expect(parseIpv6("1:2:3")).toBeNull();
  });

  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.100.100.200", "192.0.0.1", "198.19.0.1", "224.0.0.1", "255.255.255.255", "0.1.2.3", "::1", "::", "[::ffff:10.0.0.1]", "64:ff9b::a00:1", "2002:c0a8:101::", "fe80::1", "fd12::1", "ff02::1", "2001:db8::1", "100::1"])(
    "%s is private",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111", "64:ff9b::808:808", "2002:808:808::", "not-an-ip", "example.com"])(
    "%s is not private",
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  );

  it("resolvePublicAddresses rejects when ANY resolved address is private (nip.io style)", async () => {
    await expect(resolvePublicAddresses("127.0.0.1.nip.io", async () => [{ address: "127.0.0.1", family: 4 }])).rejects.toBeInstanceOf(UnsafeAddressError);
    await expect(resolvePublicAddresses("mixed.test", async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }])).rejects.toBeInstanceOf(UnsafeAddressError);
    await expect(resolvePublicAddresses("v6.test", async () => [{ address: "::ffff:169.254.169.254", family: 6 }])).rejects.toBeInstanceOf(UnsafeAddressError);
    await expect(resolvePublicAddresses("empty.test", async () => [])).rejects.toBeInstanceOf(UnsafeAddressError);
    await expect(resolvePublicAddresses("[::1]", async () => [])).rejects.toBeInstanceOf(UnsafeAddressError);
    await expect(resolvePublicAddresses("[64:ff9b::7f00:1]", async () => [])).rejects.toBeInstanceOf(UnsafeAddressError);
  });

  it("resolvePublicAddresses passes public names and literals through with the concrete addresses", async () => {
    await expect(resolvePublicAddresses("example.com", async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }])).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    await expect(resolvePublicAddresses("8.8.8.8", async () => { throw new Error("must not look up literals"); })).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
    const dnsFail = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    await expect(resolvePublicAddresses("nope.invalid", async () => { throw dnsFail; })).rejects.toBe(dnsFail);
  });
});

// ── pinned fetch ─────────────────────────────────────────────────────────────

describe("ingest/http pinnedFetch", () => {
  it("connects to the vetted address but keeps the original Host header", async () => {
    const res = await pinnedFetch(new URL(local("/page")), { addresses: LOCAL, headers: { "user-agent": "t" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("pinned page");
    expect(lastHost).toBe(`example.test:${port}`);
  });

  it("does not follow redirects (the caller re-vets every hop)", async () => {
    const res = await pinnedFetch(new URL(local("/redirect")), { addresses: LOCAL });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/page");
  });

  it("transparently decodes gzip bodies", async () => {
    const res = await pinnedFetch(new URL(local("/gzip")), { addresses: LOCAL });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await readCapped(res, 1 << 20)).toContain("Paragraph 11");
  });

  it("fails when no vetted address matches (never falls back to system DNS)", async () => {
    await expect(pinnedFetch(new URL(local("/page")), { addresses: [] })).rejects.toBeTruthy();
  });

  it("aborts on signal", async () => {
    const ctrl = new AbortController();
    const p = pinnedFetch(new URL(local("/hang")), { addresses: LOCAL, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 50);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ── fetchHtml / ingestUrl over the wire ──────────────────────────────────────

describe("ingest/url fetchHtml (local server)", () => {
  it("fetches a page through the pinned path and strips it", async () => {
    const page = await fetchHtml(local("/page"), { resolve: resolveLocal });
    expect(page.contentType).toContain("text/html");
    expect(page.finalUrl).toBe(local("/page"));
    const data = await ingestUrl(local("/page"), { resolve: resolveLocal });
    expect(data.sourceKind).toBe("url");
    expect(data.title).toBe("pinned page");
    expect(data.text).toContain("Paragraph 3");
    expect(data.text).not.toContain("<p>");
  });

  it("follows same-host redirects and reports the final url", async () => {
    const page = await fetchHtml(local("/redirect"), { resolve: resolveLocal });
    expect(page.finalUrl).toBe(local("/page"));
  });

  it("refuses a redirect to a host that resolves private, with the same error as an unreachable host (no dns oracle)", async () => {
    const e = await err(fetchHtml(local("/redirect-private"), { resolve: resolveLocal }));
    expect(e).toMatchObject({ status: 502, code: "fetch_failed", message: "couldn't reach that page" });
    expect(e.details).toBeUndefined();
  });

  it("refuses a first hop that resolves private (real guard, injected dns)", async () => {
    const e = await err(fetchHtml("http://127.0.0.1.nip.io/x", { resolve: (h) => resolvePublicAddresses(h, async () => [{ address: "127.0.0.1", family: 4 }]) }));
    expect(e).toMatchObject({ status: 502, code: "fetch_failed", message: "couldn't reach that page" });
  });

  it("gives up on redirect loops", async () => {
    const e = await err(fetchHtml(local("/loop"), { resolve: resolveLocal }));
    expect(e).toMatchObject({ status: 502, code: "fetch_failed" });
    expect(e.message).toMatch(/redirect/);
  });

  it.each(["/pdf", "/pdf-as-html", "/png"])("treats %s as a file, not a page (422)", async (p) => {
    const e = await err(fetchHtml(local(p), { resolve: resolveLocal }));
    expect(e).toMatchObject({ status: 422, code: "unreadable" });
    expect(e.message).toMatch(/file, not a page/);
  });

  it("reads text/plain through the plain path (no readability)", async () => {
    const data = await ingestUrl(local("/plain"), { resolve: resolveLocal });
    expect(data.text.startsWith("plain words here.")).toBe(true);
    expect(data.title).toBe("plain");
  });

  it("honours the charset from content-type", async () => {
    const page = await fetchHtml(local("/latin1"), { resolve: resolveLocal });
    expect(page.html).toContain("café au lait");
  });

  it("caps the body at maxBytes", async () => {
    const page = await fetchHtml(local("/big"), { resolve: resolveLocal, maxBytes: 5_000 });
    expect(page.html.length).toBe(5_000);
  });

  it("times out a server that never answers → 504 fetch_timeout", async () => {
    const e = await err(fetchHtml(local("/hang"), { resolve: resolveLocal, timeoutMs: 300 }));
    expect(e).toMatchObject({ status: 504, code: "fetch_timeout" });
  });

  it("times out a body that never finishes (timer lives past the headers)", async () => {
    const e = await err(fetchHtml(local("/slow-body"), { resolve: resolveLocal, timeoutMs: 300 }));
    expect(e).toMatchObject({ status: 504, code: "fetch_timeout" });
  });

  it("maps 5xx pages to fetch_failed with the status in the copy", async () => {
    const e = await err(fetchHtml(local("/500"), { resolve: resolveLocal }));
    expect(e).toMatchObject({ status: 502, code: "fetch_failed", message: "that page answered 500" });
  });

  it("rejects non-http schemes / blocked literals before touching the network", async () => {
    await expect(fetchHtml("file:///etc/passwd")).rejects.toMatchObject({ status: 400, code: "bad_url" });
    await expect(fetchHtml("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject({ status: 400, code: "bad_url" });
  });
});

describe("ingest/url sniffing helpers", () => {
  it("looksBinary catches magic numbers and control-heavy bytes", () => {
    expect(looksBinary(new Uint8Array(PDF))).toBe(true);
    expect(looksBinary(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("<html><body>hello there</body></html>"))).toBe(false);
    expect(looksBinary(new TextEncoder().encode("plain text with tabs\tand\nnewlines ".repeat(50)))).toBe(false);
    const noisy = new Uint8Array(4096);
    for (let i = 0; i < noisy.length; i++) noisy[i] = i % 7 === 0 ? 0 : 0x41;
    expect(looksBinary(noisy)).toBe(true);
  });

  it("isHtmlContent routes by content-type, sniffing when it's vague", () => {
    expect(isHtmlContent("text/html; charset=utf-8", "")).toBe(true);
    expect(isHtmlContent("application/xhtml+xml", "")).toBe(true);
    expect(isHtmlContent("text/plain", "<html><body>x</body></html>")).toBe(false);
    expect(isHtmlContent("text/markdown", "# hi")).toBe(false);
    expect(isHtmlContent("application/json", "{}")).toBe(false);
    expect(isHtmlContent("", "<!doctype html><html>")).toBe(true);
    expect(isHtmlContent("", "just words")).toBe(false);
    expect(isHtmlContent("application/xml", "<rss><channel><item>x</item></channel></rss>")).toBe(false);
    expect(isHtmlContent("application/xml", "<html><body><p>x</p></body></html>")).toBe(true);
  });
});

// ── repo (mocked github) ─────────────────────────────────────────────────────

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });

function stubGithub(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const res = await route(url, init);
    return res ?? new Response("not found", { status: 404 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DRIP_ALLOW_PRIVATE_REPOS;
});

const META = { default_branch: "main", description: "widgets", language: "TypeScript", full_name: "o/r", html_url: "https://github.com/o/r" };
const TREE = { sha: "abc", truncated: false, tree: [{ path: "README.md", type: "blob" }, { path: "package.json", type: "blob" }, { path: "src/index.ts", type: "blob" }] };

describe("ingest/repo over mocked github", () => {
  it("folds extra path segments into the ref when the branch name has a slash", async () => {
    const calls = stubGithub((url) => {
      if (url.endsWith("/repos/o/r")) return json(META);
      if (url.includes("/git/trees/feat?")) return json({ message: "Not Found" }, 404);
      if (url.includes("/git/trees/feat%2Fx?")) return json(TREE);
      if (url.includes("raw.githubusercontent.com/o/r/feat%2Fx/README.md")) return text("# r\n\nhello ".repeat(20));
      if (url.includes("raw.githubusercontent.com/o/r/feat%2Fx/package.json")) return text('{"name":"r"}');
      return undefined;
    });
    const data = await ingestRepo("https://github.com/o/r/tree/feat/x/src");
    expect(data.meta.ref).toBe("feat/x");
    expect(data.text.startsWith("REPO o/r (feat/x)")).toBe(true);
    expect(data.text).toContain('--- package.json ---\n{"name":"r"}');
    expect(calls.filter((c) => c.url.includes("/git/trees/")).map((c) => c.url)).toEqual([
      "https://api.github.com/repos/o/r/git/trees/feat?recursive=1",
      "https://api.github.com/repos/o/r/git/trees/feat%2Fx?recursive=1",
    ]);
  });

  it("still 404s cleanly when no candidate ref exists", async () => {
    stubGithub((url) => (url.endsWith("/repos/o/r") ? json(META) : url.includes("/git/trees/") ? json({}, 404) : undefined));
    await expect(ingestRepo("https://github.com/o/r/tree/nope/x")).rejects.toMatchObject({ status: 404, code: "repo_not_found" });
  });

  it("uses the default branch when the url has no ref", async () => {
    const calls = stubGithub((url) => {
      if (url.endsWith("/repos/o/r")) return json(META);
      if (url.includes("/git/trees/main?")) return json(TREE);
      return text("x".repeat(300));
    });
    const data = await ingestRepo("https://github.com/o/r");
    expect(data.meta.ref).toBe("main");
    expect(data.title).toBe("o/r");
    // raw fetches ask for a byte range so a huge file never streams whole
    const raw = calls.find((c) => c.url.includes("raw.githubusercontent.com"));
    expect((raw?.init?.headers as Record<string, string>).range).toMatch(/^bytes=0-\d+$/);
  });

  it("refuses private repos (GITHUB_TOKEN must not turn the endpoint into a private-repo proxy) with github's own 404", async () => {
    stubGithub((url) => (url.endsWith("/repos/o/secret") ? json({ ...META, private: true }) : json(TREE)));
    await expect(ingestRepo("https://github.com/o/secret")).rejects.toMatchObject({ status: 404, code: "repo_not_found", message: "couldn't find that repo on github" });
    process.env.DRIP_ALLOW_PRIVATE_REPOS = "1";
    stubGithub((url) => (url.endsWith("/repos/o/secret") ? json({ ...META, private: true }) : url.includes("/git/trees/") ? json(TREE) : text("x".repeat(300))));
    await expect(ingestRepo("https://github.com/o/secret")).resolves.toMatchObject({ sourceKind: "repo" });
  });

  it("caps raw file reads by bytes and marks truncation", async () => {
    stubGithub(() => text("y".repeat(200_000)));
    const body = await getRepoFile("o", "r", "main", "big.txt");
    expect(body.length).toBeLessThanOrEqual(20_000);
    expect(body.endsWith("[… truncated]")).toBe(true);
  });

  it("maps rate limits and forbids to sheet-facing errors", async () => {
    stubGithub(() => json({ message: "rate" }, 403, { "x-ratelimit-remaining": "0" }));
    await expect(ingestRepo("https://github.com/o/r")).rejects.toMatchObject({ status: 429, code: "github_rate_limited" });
    stubGithub(() => json({ message: "no" }, 401));
    await expect(ingestRepo("https://github.com/o/r")).rejects.toMatchObject({ status: 403, code: "github_forbidden" });
  });

  it("turns a network failure into github_unreachable without echoing internals in production", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.9:443"); });
    const prev = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const e = await err(ingestRepo("https://github.com/o/r"));
      expect(e).toMatchObject({ status: 502, code: "github_unreachable" });
      expect(e.details).toBeUndefined();
    } finally {
      vi.stubEnv("NODE_ENV", prev ?? "test");
    }
  });
});

// ── youtube (mocked network) ─────────────────────────────────────────────────

const ID = "dQw4w9WgXcQ";
const XML = `<transcript><text start="0" dur="2.5">hello there</text><text start="2.5" dur="3">general kenobi</text></transcript>`;

describe("ingest/youtube over mocked network", () => {
  it("wraps every library call in a deadline-aware signal", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const probe: YoutubeProbe = { playability: null };
    const f = makeYoutubeFetch(probe, { fetchImpl: async (_i, init) => { seen.push(init?.signal); return new Response("{}", { status: 200 }); } });
    await f("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", { method: "POST" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("maps a timeout to 504 youtube_timeout", async () => {
    const probe: YoutubeProbe = { playability: null };
    // already-expired deadline → the 1ms floor fires before /hang can ever answer, with no wall-clock race
    const f = makeYoutubeFetch(probe, { deadline: Date.now() - 1_000, fetchImpl: (i, init) => fetch(i, init) });
    const e = await f(local("/hang"), {}).then(() => null, (x: unknown) => x);
    expect(mapYoutubeError(e, ID)).toMatchObject({ status: 504, code: "youtube_timeout" });
  });

  it("reports a video youtube says doesn't exist as unavailable, not 'no captions'", async () => {
    const data = await ingestYoutube(`https://www.youtube.com/watch?v=${ID}`, {
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("youtubei/v1/player")) return json({ playabilityStatus: { status: "ERROR", reason: "Video unavailable" } });
        if (url.includes("/watch?v=")) return new Response(`<html>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"ERROR"}};</html>`, { status: 200 });
        return new Response("", { status: 404 });
      },
    }).then(() => null, (e: unknown) => e);
    expect(data).toMatchObject({ status: 404, code: "video_unavailable" });
  });

  it("keeps 'no captions' for a real video that simply has none", async () => {
    const e = await ingestYoutube(ID, {
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("youtubei/v1/player")) return json({ playabilityStatus: { status: "OK" } });
        if (url.includes("/watch?v=")) return new Response(`<html>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"captions":{}};</html>`, { status: 200 });
        return new Response("", { status: 404 });
      },
    }).then(() => null, (x: unknown) => x);
    expect(e).toMatchObject({ status: 422, code: "no_captions" });
    // and the probe-less mapper still behaves for the plain library error
    expect(mapYoutubeError(new YoutubeTranscriptDisabledError(ID), ID, { playability: "LOGIN_REQUIRED" })).toMatchObject({ status: 404 });
    expect(mapYoutubeError(new YoutubeTranscriptDisabledError(ID), ID, { playability: "OK" })).toMatchObject({ status: 422 });
  });

  it("happy path: InnerTube captions → timestamped transcript", async () => {
    const data = await ingestYoutube(`https://youtu.be/${ID}`, {
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("youtubei/v1/player")) {
          return json({ playabilityStatus: { status: "OK" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=x", languageCode: "en" }] } } });
        }
        if (url.includes("/api/timedtext")) return new Response(XML, { status: 200 });
        return new Response("", { status: 404 });
      },
    });
    expect(data.sourceKind).toBe("youtube");
    expect(data.text).toBe("[00:00] hello there general kenobi");
    expect(data.meta).toMatchObject({ videoId: ID, segmentCount: 2, durationSec: 6, lang: "en" });
  });
});
