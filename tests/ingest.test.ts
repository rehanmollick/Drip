import { describe, expect, it } from "vitest";
import { extractReadable, isSafeUrl } from "@/lib/ingest/url";
import { buildRepoText, keepPath, parseRepoUrl, summarizeTree, type TreeEntry } from "@/lib/ingest/repo";
import { extractVideoId, formatTimestamp, formatTranscript, mapYoutubeError, normalizeSegments } from "@/lib/ingest/youtube";
import { capText, normalizeText } from "@/lib/ingest/text";
import { HttpError } from "@/lib/api/envelope";
import { YoutubeTranscriptDisabledError, YoutubeTranscriptTooManyRequestError, YoutubeTranscriptVideoUnavailableError } from "youtube-transcript";
import { IngestData } from "@/lib/api/contract";

// ── url ──────────────────────────────────────────────────────────────────────

const para = (i: number) =>
  `<p>Paragraph ${i}: the event loop picks the next macrotask only after the microtask queue is drained, which is why a chain of resolved promises can starve a setTimeout callback that was scheduled earlier.</p>`;

const ARTICLE_HTML = `<!doctype html><html><head>
<title>Event loop starvation — plainly</title>
<meta property="og:site_name" content="plainly.dev">
<meta name="description" content="why promises can starve timers">
<script>window.__x = 1;</script>
<style>.nav{display:none}</style>
</head><body>
<nav><a href="/">home</a><a href="/about">about</a></nav>
<article>
<h1>Event loop starvation</h1>
<p class="byline">by ada</p>
${Array.from({ length: 8 }, (_, i) => para(i + 1)).join("\n")}
<ul><li>microtasks first</li><li>then one macrotask</li></ul>
<pre><code>queueMicrotask(() => {})</code></pre>
</article>
<footer>© plainly</footer>
<script>console.log("tracking")</script>
</body></html>`;

describe("ingest/url extractReadable", () => {
  it("pulls article text with paragraph breaks and meta from inline html", () => {
    const { text, meta } = extractReadable(ARTICLE_HTML, "https://plainly.dev/event-loop");
    expect(text).toContain("Paragraph 1: the event loop");
    expect(text).toContain("Paragraph 8");
    expect(text).not.toContain("window.__x");
    expect(text).not.toContain("tracking");
    expect(text).not.toContain(".nav{display:none}");
    // paragraph breaks preserved, no triple newlines
    expect(text.split("\n\n").length).toBeGreaterThan(4);
    expect(text).not.toMatch(/\n{3,}/);
    expect(meta.url).toBe("https://plainly.dev/event-loop");
    expect(meta.title).toMatch(/Event loop starvation/);
    expect(meta.siteName).toBe("plainly.dev");
    expect(meta.length).toBe(text.length);
    expect(() => IngestData.parse({ text, sourceKind: "url", meta: { ...meta } })).not.toThrow();
  });

  it("falls back to body text when readability finds too little", () => {
    const body = Array.from({ length: 6 }, (_, i) => `<div>chunk ${i} of loose text that is not wrapped in an article but is still worth reading because it is long enough to matter here.</div>`).join("");
    const html = `<html><head><title>loose</title></head><body>${body}</body></html>`;
    const { text, meta } = extractReadable(html, "https://example.com/loose");
    expect(text).toContain("chunk 0 of loose text");
    expect(text).toContain("chunk 5");
    expect(meta.title).toBe("loose");
  });

  it("throws 422 unreadable on empty pages", () => {
    try {
      extractReadable("<html><body><script>1</script></body></html>", "https://example.com/empty");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(422);
      expect((e as HttpError).code).toBe("unreadable");
    }
  });
});

describe("ingest/url ssrf guard", () => {
  it.each([
    "https://example.com/post",
    "http://news.ycombinator.com/item?id=1",
    "https://8.8.8.8/x",
    "https://sub.domain.co.uk/path?q=1",
  ])("allows %s", (u) => expect(isSafeUrl(u)).toBe(true));

  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://printer.local/",
    "http://svc.internal/",
    "http://user:pass@example.com/",
    "not a url",
  ])("blocks %s", (u) => expect(isSafeUrl(u)).toBe(false));
});

// ── youtube ──────────────────────────────────────────────────────────────────

describe("ingest/youtube extractVideoId", () => {
  const ID = "dQw4w9WgXcQ";
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=42s&list=PL123`, ID],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/embed/${ID}?autoplay=1`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`youtube.com/watch?v=${ID}`, ID],
    [ID, ID],
  ])("%s → %s", (input, expected) => expect(extractVideoId(input)).toBe(expected));

  it.each([
    "https://vimeo.com/12345",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/channel/UCabc",
    "nonsense",
  ])("rejects %s", (input) => expect(extractVideoId(input)).toBeNull());
});

describe("ingest/youtube transcript formatting", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(0)).toBe("[00:00]");
    expect(formatTimestamp(65)).toBe("[01:05]");
    expect(formatTimestamp(754.9)).toBe("[12:34]");
    expect(formatTimestamp(3661)).toBe("[1:01:01]");
  });

  it("normalizes ms offsets (srv3 path) to seconds and decodes entities", () => {
    const segs = normalizeSegments([
      { text: "hello &amp;#39;world&amp;#39;", offset: 0, duration: 2000 },
      { text: "  second   cue ", offset: 2500, duration: 1800 },
    ]);
    expect(segs[0]).toEqual({ text: "hello 'world'", startSec: 0, durationSec: 2 });
    expect(segs[1].startSec).toBe(2.5);
    expect(segs[1].text).toBe("second cue");
  });

  it("keeps second offsets (classic xml path) as seconds", () => {
    const segs = normalizeSegments([
      { text: "a", offset: 0, duration: 3.2 },
      { text: "b", offset: 3.2, duration: 2.1 },
    ]);
    expect(segs[1].startSec).toBeCloseTo(3.2);
  });

  it("groups segments into ~60s / ~600 char paragraphs prefixed with [mm:ss]", () => {
    // 40 cues, 5s apart, each ~30 chars → time-based split every 60s (12 cues) → 4 paragraphs
    const segs = Array.from({ length: 40 }, (_, i) => ({
      text: `cue number ${String(i).padStart(2, "0")} says something`,
      startSec: i * 5,
      durationSec: 4,
    }));
    const { text, durationSec, paragraphs } = formatTranscript(segs);
    const blocks = text.split("\n\n");
    expect(paragraphs).toBe(4);
    expect(blocks).toHaveLength(4);
    expect(blocks[0].startsWith("[00:00] cue number 00")).toBe(true);
    expect(blocks[1].startsWith("[01:00] cue number 12")).toBe(true);
    expect(blocks[3].startsWith("[03:00] cue number 36")).toBe(true);
    expect(durationSec).toBe(39 * 5 + 4);
  });

  it("splits by chars when cues are dense", () => {
    const segs = Array.from({ length: 30 }, (_, i) => ({ text: "x".repeat(100), startSec: i, durationSec: 1 }));
    const { paragraphs } = formatTranscript(segs);
    // 600 chars / ~101 per cue → 5 cues per paragraph → 6 paragraphs
    expect(paragraphs).toBe(6);
  });

  it("maps library errors to the sheet-facing HttpErrors", () => {
    expect(mapYoutubeError(new YoutubeTranscriptDisabledError("x"), "x")).toMatchObject({ status: 422, code: "no_captions" });
    expect(mapYoutubeError(new YoutubeTranscriptVideoUnavailableError("x"), "x")).toMatchObject({ status: 404 });
    expect(mapYoutubeError(new YoutubeTranscriptTooManyRequestError(), "x")).toMatchObject({ status: 429 });
    expect(mapYoutubeError(new Error("boom"), "x")).toMatchObject({ status: 502 });
  });
});

// ── repo ─────────────────────────────────────────────────────────────────────

describe("ingest/repo parseRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", { owner: "vercel", repo: "next.js", ref: null }],
    ["https://www.github.com/vercel/next.js/", { owner: "vercel", repo: "next.js", ref: null }],
    ["https://github.com/vercel/next.js.git", { owner: "vercel", repo: "next.js", ref: null }],
    ["https://github.com/vercel/next.js/tree/canary", { owner: "vercel", repo: "next.js", ref: "canary" }],
    ["https://github.com/vercel/next.js/tree/canary/packages/next", { owner: "vercel", repo: "next.js", ref: "canary" }],
    ["https://github.com/o/r/blob/main/README.md", { owner: "o", repo: "r", ref: "main" }],
    ["https://github.com/o/r/tree/feat%2Fthing", { owner: "o", repo: "r", ref: "feat/thing" }],
  ])("%s", (input, expected) => expect(parseRepoUrl(input)).toEqual(expected));

  it.each(["https://gitlab.com/o/r", "https://github.com/onlyowner", "nope", "https://github.com/o/r%20x"])(
    "rejects %s",
    (input) => {
      expect(() => parseRepoUrl(input)).toThrow(HttpError);
    },
  );
});

const FIXTURE_TREE: TreeEntry[] = [
  { path: "README.md", type: "blob", size: 1200 },
  { path: "package.json", type: "blob", size: 800 },
  { path: "pnpm-lock.yaml", type: "blob", size: 90000 },
  { path: "tsconfig.json", type: "blob", size: 300 },
  { path: "next.config.ts", type: "blob", size: 200 },
  { path: "Dockerfile", type: "blob", size: 400 },
  { path: "src", type: "tree" },
  { path: "src/index.ts", type: "blob", size: 500 },
  { path: "src/app/page.tsx", type: "blob", size: 900 },
  { path: "src/app/logo.png", type: "blob", size: 5000 },
  { path: "src/lib/util.min.js", type: "blob", size: 5000 },
  { path: "src/lib/util.js.map", type: "blob", size: 5000 },
  { path: "node_modules/react/index.js", type: "blob", size: 100 },
  { path: "dist/bundle.js", type: "blob", size: 100 },
  { path: ".git/HEAD", type: "blob", size: 10 },
  { path: "docs/README.md", type: "blob", size: 100 },
  { path: "public/fonts/inter.woff2", type: "blob", size: 100 },
  { path: "packages/api/package.json", type: "blob", size: 100 },
];

describe("ingest/repo summarizeTree", () => {
  it("filters junk, sorts shallow-first, finds readme + key files", () => {
    const s = summarizeTree(FIXTURE_TREE);
    expect(s.files).not.toContain("pnpm-lock.yaml");
    expect(s.files).not.toContain("node_modules/react/index.js");
    expect(s.files).not.toContain("dist/bundle.js");
    expect(s.files).not.toContain(".git/HEAD");
    expect(s.files).not.toContain("src/app/logo.png");
    expect(s.files).not.toContain("src/lib/util.min.js");
    expect(s.files).not.toContain("src/lib/util.js.map");
    expect(s.files).not.toContain("public/fonts/inter.woff2");
    expect(s.files).not.toContain("src"); // dirs are not files
    expect(s.files).toContain("src/app/page.tsx");
    expect(s.files[0]).toBe("Dockerfile"); // depth 1, alphabetical
    expect(s.fileCount).toBe(s.files.length);
    expect(s.totalCount).toBe(17);
    expect(s.readmePath).toBe("README.md");
    expect(s.keyFiles[0]).toBe("package.json");
    expect(s.keyFiles).toEqual(expect.arrayContaining(["tsconfig.json", "next.config.ts", "Dockerfile", "packages/api/package.json"]));
    expect(s.keyFiles.indexOf("package.json")).toBeLessThan(s.keyFiles.indexOf("packages/api/package.json"));
    expect(s.truncated).toBe(false);
  });

  it("caps the visible tree at 400 paths and flags truncation", () => {
    const big: TreeEntry[] = Array.from({ length: 1000 }, (_, i) => ({ path: `src/f${i}.ts`, type: "blob" }));
    const s = summarizeTree(big);
    expect(s.files).toHaveLength(400);
    expect(s.fileCount).toBe(1000);
    expect(s.truncated).toBe(true);
  });

  it("keepPath handles edge cases", () => {
    expect(keepPath("Makefile")).toBe(true);
    expect(keepPath("a/b/c.ts")).toBe(true);
    expect(keepPath("a/vendor/x.go")).toBe(false);
    expect(keepPath("Cargo.lock")).toBe(false);
    expect(keepPath("assets/hero.JPG")).toBe(false);
  });
});

describe("ingest/repo buildRepoText", () => {
  it("assembles the planner text with caps", () => {
    const tree = summarizeTree(FIXTURE_TREE);
    const text = buildRepoText({
      owner: "acme",
      repo: "widgets",
      ref: "main",
      description: "widgets as a service",
      language: "TypeScript",
      tree,
      readme: "# widgets\n\n\n\nmakes widgets.\r\n",
      keyFiles: [
        { path: "package.json", content: '{"name":"widgets"}' },
        { path: "Dockerfile", content: "FROM node:20\n" + "RUN echo hi\n".repeat(2000) },
      ],
    });
    expect(text.startsWith("REPO acme/widgets (main)")).toBe(true);
    expect(text).toContain("DESCRIPTION: widgets as a service");
    expect(text).toContain(`FILE TREE (${tree.fileCount} files):`);
    expect(text).toContain("  src/app/page.tsx");
    expect(text).toContain("README:\n# widgets\n\nmakes widgets.");
    expect(text).toContain('--- package.json ---\n{"name":"widgets"}');
    expect(text).toContain("--- Dockerfile ---");
    expect(text).toContain("[… truncated]"); // Dockerfile capped at 6k
    expect(text.length).toBeLessThanOrEqual(60_000);
    expect(() => IngestData.parse({ text, sourceKind: "repo", meta: { tree: tree.files } })).not.toThrow();
  });

  it("stays under the 60k total even with many big files", () => {
    const tree = summarizeTree(FIXTURE_TREE);
    const keyFiles = Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.json`, content: "x".repeat(6_000) }));
    const text = buildRepoText({ owner: "a", repo: "b", ref: "main", tree, readme: "y".repeat(20_000), keyFiles });
    expect(text.length).toBeLessThanOrEqual(60_000);
    expect(text).toContain("--- f0.json ---");
  });
});

// ── text helpers ─────────────────────────────────────────────────────────────

describe("ingest/text", () => {
  it("normalizeText collapses runs but keeps paragraph breaks", () => {
    expect(normalizeText("a  b\t c\r\n\r\n\r\n\r\nd   e\n")).toBe("a b c\n\nd e");
  });
  it("capText marks truncation", () => {
    const out = capText("x".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("[… truncated]")).toBe(true);
    expect(capText("short", 50)).toBe("short");
  });
});
