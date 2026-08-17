import { describe, expect, it } from "vitest";
import { clampTitle, ingestPath, isRepoUrl, isYoutubeUrl, loneUrl, looksLikeTranscript, routeInput } from "@/lib/feed/input";

describe("loneUrl", () => {
  it("accepts a single URL with a scheme, rejects prose", () => {
    expect(loneUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(loneUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(loneUrl("check out https://example.com please")).toBeNull();
    expect(loneUrl("how does a cache work?")).toBeNull();
    expect(loneUrl("")).toBeNull();
  });

  it("scheme-less input is a URL only for www. or a known host with a path (D11)", () => {
    expect(loneUrl("www.example.com/path")).toBe("https://www.example.com/path");
    expect(loneUrl("www.example.com")).toBe("https://www.example.com");
    expect(loneUrl("github.com/vercel/next.js")).toBe("https://github.com/vercel/next.js");
    expect(loneUrl("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(loneUrl("m.youtube.com/watch?v=abc")).toBe("https://m.youtube.com/watch?v=abc");
    // dotted subjects are sentences, not links
    for (const t of ["next.js", "node.js", "d3.js", "torch.nn", "os.path", "numpy.linalg", "asyncio.gather", "example.com/path", "en.wikipedia.org/wiki/Cache", "github.com"]) {
      expect(loneUrl(t), t).toBeNull();
    }
  });
});

describe("youtube + repo detection", () => {
  it("recognizes youtube watch / youtu.be / shorts", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYoutubeUrl("https://youtube.com/shorts/abc123")).toBe(true);
    expect(isYoutubeUrl("https://m.youtube.com/watch?v=abc")).toBe(true);
    expect(isYoutubeUrl("https://www.youtube.com/")).toBe(false);
    expect(isYoutubeUrl("https://vimeo.com/123")).toBe(false);
  });
  it("recognizes github.com/owner/repo", () => {
    expect(isRepoUrl("https://github.com/vercel/next.js")).toBe(true);
    expect(isRepoUrl("https://github.com/vercel/next.js/tree/canary/packages")).toBe(true);
    expect(isRepoUrl("https://github.com/vercel")).toBe(false);
    expect(isRepoUrl("https://gitlab.com/a/b")).toBe(false);
  });
});

describe("routeInput", () => {
  it("routes lone URLs to the right ingest endpoint", () => {
    expect(routeInput("https://youtu.be/xyz")).toEqual({ kind: "youtube", url: "https://youtu.be/xyz" });
    expect(routeInput("github.com/owner/repo")).toEqual({ kind: "repo", url: "https://github.com/owner/repo" });
    expect(routeInput("https://en.wikipedia.org/wiki/Cache")).toEqual({ kind: "url", url: "https://en.wikipedia.org/wiki/Cache" });
    expect(ingestPath("youtube")).toBe("/api/ingest/youtube");
    expect(ingestPath("repo")).toBe("/api/ingest/repo");
    expect(ingestPath("url")).toBe("/api/ingest/url");
  });

  it("short single-line text is a sentence — including dotted subjects like next.js", () => {
    expect(routeInput("how do caches keep a site alive?")).toEqual({ kind: "text", sourceKind: "sentence" });
    expect(routeInput("next.js")).toEqual({ kind: "text", sourceKind: "sentence" });
    expect(routeInput("torch.nn")).toEqual({ kind: "text", sourceKind: "sentence" });
  });

  it("long or multi-line text is a paste", () => {
    expect(routeInput("x".repeat(250))).toEqual({ kind: "text", sourceKind: "paste" });
    expect(routeInput("line one\nline two")).toEqual({ kind: "text", sourceKind: "paste" });
  });

  it("timestamped text or an attached file is a transcript", () => {
    const t = ["00:00 welcome back", "00:12 today we talk caches", "00:40 a cache is a bet", "01:03 on repetition", "01:30 questions?"].join("\n");
    expect(looksLikeTranscript(t)).toBe(true);
    expect(routeInput(t)).toEqual({ kind: "text", sourceKind: "transcript" });
    expect(routeInput("plain notes\nmore notes\neven more", { attachedFile: true })).toEqual({ kind: "text", sourceKind: "transcript" });
    expect(looksLikeTranscript("no stamps here\njust prose\nthird line\nfourth")).toBe(false);
  });
});

describe("clampTitle", () => {
  it("keeps short titles, trims long ones at a word boundary under 60 chars", () => {
    expect(clampTitle("how a cache keeps a site alive")).toBe("how a cache keeps a site alive");
    const long = "How we built Pingora, the proxy that connects Cloudflare to the Internet";
    const c = clampTitle(long)!;
    expect(c.length).toBeLessThanOrEqual(60);
    expect(c).toBe("How we built Pingora, the proxy that connects Cloudflare to");
    expect(clampTitle("   ")).toBeUndefined();
    expect(clampTitle(undefined)).toBeUndefined();
    // no spaces at all → hard cut
    expect(clampTitle("x".repeat(80))!.length).toBe(60);
  });
});
