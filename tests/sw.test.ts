import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import manifest from "@/app/manifest";
import { findBannedWord } from "@/lib/copy/banned";

const ROOT = join(__dirname, "..");
const SW_SRC = readFileSync(join(ROOT, "public/sw.js"), "utf8");

/** Evaluate sw.js in a sandbox with a stub `self`; returns the sandbox so we can poke top-level functions. */
function loadSw() {
  const listeners: Record<string, unknown[]> = {};
  const self = {
    addEventListener: (type: string, fn: unknown) => ((listeners[type] ??= []).push(fn)),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    location: { origin: "https://drip.test" },
  };
  const sandbox: Record<string, unknown> = { self, caches: {}, fetch: () => Promise.reject(new Error("no network")), URL, Request: class {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(SW_SRC, { filename: "sw.js" }).runInContext(sandbox);
  return { sandbox, listeners };
}

describe("public/sw.js", () => {
  it("compiles as plain JS and declares the versioned cache + offline page", () => {
    expect(() => new vm.Script(SW_SRC, { filename: "sw.js" })).not.toThrow();
    expect(SW_SRC).toContain('const CACHE = "drip-shell-v1"');
    expect(SW_SRC).toContain('"/offline.html"');
    expect(SW_SRC).toContain('"/manifest.webmanifest"');
    expect(SW_SRC).toContain("SKIP_WAITING");
    expect(SW_SRC).not.toMatch(/importScripts|https?:\/\//); // no external requests
  });

  it("registers install / activate / fetch / message listeners", () => {
    const { listeners } = loadSw();
    expect(Object.keys(listeners).sort()).toEqual(["activate", "fetch", "install", "message"]);
  });

  it("classifies requests: navigate → shell, static → cache-first, session reads → network-first, rest → network", () => {
    const { sandbox } = loadSw();
    const classify = sandbox.classify as (url: URL, mode: string) => string;
    const u = (p: string) => new URL(p, "https://drip.test");
    expect(classify(u("/s/abc"), "navigate")).toBe("navigate");
    expect(classify(u("/_next/static/chunks/main.js"), "no-cors")).toBe("static");
    expect(classify(u("/_next/static/media/font.woff2"), "cors")).toBe("static");
    expect(classify(u("/icons/icon-192.png"), "no-cors")).toBe("static");
    expect(classify(u("/api/sessions"), "cors")).toBe("session");
    expect(classify(u("/api/sessions/123e4567"), "cors")).toBe("session");
    expect(classify(u("/api/sessions/123e4567/cards?after=a0&limit=12"), "cors")).toBe("session");
    expect(classify(u("/api/sessions/123e4567/generate"), "cors")).toBe("network");
    expect(classify(u("/api/ingest/url"), "cors")).toBe("network");
    expect(classify(u("/api/cards/1/interact"), "cors")).toBe("network");
    expect(classify(u("/sw.js"), "same-origin")).toBe("network");
  });
});

describe("app/manifest.ts", () => {
  it("describes a standalone portrait pwa with 192/512/maskable icons", () => {
    const m = manifest();
    expect(m.name).toBe("drip");
    expect(m.short_name).toBe("drip");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
    expect(m.background_color).toBe("#0b0b0f");
    expect(m.theme_color).toBe("#0b0b0f");
    expect(m.description).toBe("paste anything. scroll it in.");
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const s of [m.name ?? "", m.description ?? ""]) expect(findBannedWord(s)).toBeNull();
  });
});

describe("public/icons + offline.html", () => {
  const png = (name: string) => readFileSync(join(ROOT, "public/icons", name));
  const dims = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
  ])("%s is a %ipx PNG", (name, size) => {
    const buf = png(name);
    expect(buf.subarray(0, 8).equals(SIG)).toBe(true);
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(dims(buf)).toEqual({ w: size, h: size });
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString("ascii")).toBe("IEND");
  });

  it("offline page is self-contained and on-brand", () => {
    const html = readFileSync(join(ROOT, "public/offline.html"), "utf8");
    expect(html).toContain("back online soon");
    expect(html).toContain("#0b0b0f");
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/);
    expect(html).not.toMatch(/spinner|loading\.\.\./i);
    const visible = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    expect(findBannedWord(visible)).toBeNull();
  });
});
