import { describe, expect, it } from "vitest";
import { ingestPath, isRepoUrl, isYoutubeUrl, loneUrl, looksLikeTranscript, routeInput } from "@/lib/feed/input";

describe("loneUrl", () => {
  it("accepts a single URL with or without scheme, rejects prose", () => {
    expect(loneUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(loneUrl("  example.com/path ")).toBe("https://example.com/path");
    expect(loneUrl("check out https://example.com please")).toBeNull();
    expect(loneUrl("how does a cache work?")).toBeNull();
    expect(loneUrl("")).toBeNull();
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

  it("short single-line text is a sentence", () => {
    expect(routeInput("how do caches keep a site alive?")).toEqual({ kind: "text", sourceKind: "sentence" });
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
