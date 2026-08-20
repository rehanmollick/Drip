import { describe, expect, it, vi } from "vitest";

// next/font only exists inside the Next compiler; the cover helpers under test never touch fonts
vi.mock("next/font/google", () => {
  const face = () => ({ variable: "--font-mocked", className: "" });
  const names = [
    "Space_Grotesk", "Bricolage_Grotesque", "Syne", "Unbounded", "Fraunces", "Playfair_Display",
    "Instrument_Serif", "Zilla_Slab", "DM_Sans", "Manrope", "Nunito", "IBM_Plex_Sans",
    "Source_Serif_4", "JetBrains_Mono", "IBM_Plex_Mono", "Fira_Code",
  ];
  return Object.fromEntries(names.map((n) => [n, face]));
});

import type { SessionPublic } from "@/lib/api/contract";
import {
  agoLine, coverLegible, coverState, depthFraction, isWrapped, sortShelf, unviewedRunway,
} from "@/components/home/SessionTile";
import { unfurlLine, urlDomain } from "@/components/home/NewSessionSheet";
import { daySeed, SUGGESTION_SETS, suggestionsAt } from "@/components/home/suggestions";
import { findBannedWord } from "@/lib/copy/banned";

/** minimal SessionPublic for the pure cover helpers — only the fields they read */
function s(over: Partial<SessionPublic> = {}): SessionPublic {
  return {
    status: "active",
    position: 0,
    cardCount: 0,
    lastOpenedAt: new Date().toISOString(),
    progress: { nodeIdx: 0, cardsInNode: 0, totalGenerated: 0, exhausted: false, extensions: 0, lastIdx: null, epoch: 0, pendingReplan: false, awaitingChoice: false, deeperCards: 0 },
    frontier: null,
    ...over,
  } as SessionPublic;
}

describe("cover state line (one line, feed-native, never a count)", () => {
  it("planning → brewing", () => {
    expect(coverState(s({ status: "planning" }))).toBe("still brewing…");
  });
  it("error → needs a retry", () => {
    expect(coverState(s({ status: "error" }))).toBe("needs a retry");
  });
  it("wrap gate or archived → wrapped", () => {
    expect(coverState(s({ frontier: { gate: "wrap" } as SessionPublic["frontier"] }))).toMatch(/^wrapped/);
    expect(coverState(s({ status: "archived" }))).toMatch(/^wrapped/);
  });
  it("awaiting a crossroads choice → parked at a fork", () => {
    const parked = s({ cardCount: 10, position: 9 });
    parked.progress.awaitingChoice = true;
    expect(coverState(parked)).toBe("parked at a fork");
  });
  it("unviewed runway → fresh cards waiting; caught up → picks up where you left off", () => {
    expect(coverState(s({ cardCount: 12, position: 4 }))).toBe("fresh cards waiting");
    expect(coverState(s({ cardCount: 12, position: 11 }))).toBe("picks up where you left off");
  });
  it("never puts a number or a banned word on the shelf", () => {
    const all = [
      s({ status: "planning" }), s({ status: "error" }), s({ status: "archived" }),
      s({ cardCount: 12, position: 4 }), s({ cardCount: 12, position: 11 }),
    ];
    for (const sess of all) {
      const line = coverState(sess);
      expect(line).toBe(line.toLowerCase());
      expect(line).not.toMatch(/\d/);
      expect(findBannedWord(line)).toBeNull();
    }
  });
});

describe("runway + depth rail math", () => {
  it("counts cards below the last viewed one", () => {
    expect(unviewedRunway(s({ cardCount: 10, position: 3 }))).toBe(6);
    expect(unviewedRunway(s({ cardCount: 10, position: 9 }))).toBe(0);
    expect(unviewedRunway(s({ cardCount: 0, position: 0 }))).toBe(0);
  });
  it("depth fraction clamps to [0,1] and handles tiny decks", () => {
    expect(depthFraction(s({ cardCount: 0, position: 0 }))).toBe(0);
    expect(depthFraction(s({ cardCount: 1, position: 0 }))).toBe(0);
    expect(depthFraction(s({ cardCount: 11, position: 5 }))).toBe(0.5);
    expect(depthFraction(s({ cardCount: 5, position: 99 }))).toBe(1);
  });
});

describe("shelf sort: resume intent", () => {
  it("mid-thread most recent first, wrapped last regardless of recency", () => {
    const a = s({ id: "a", lastOpenedAt: "2026-08-10T00:00:00Z" } as Partial<SessionPublic>);
    const b = s({ id: "b", lastOpenedAt: "2026-08-15T00:00:00Z" } as Partial<SessionPublic>);
    const w = s({ id: "w", status: "archived", lastOpenedAt: "2026-08-18T00:00:00Z" } as Partial<SessionPublic>);
    const order = sortShelf([a, w, b]).map((x) => x.id);
    expect(order).toEqual(["b", "a", "w"]);
  });
  it("does not mutate the input", () => {
    const list = [s({ id: "a" } as Partial<SessionPublic>), s({ id: "b", status: "archived" } as Partial<SessionPublic>)];
    const copy = [...list];
    sortShelf(list);
    expect(list).toEqual(copy);
  });
  it("isWrapped reads the wrap gate or the archive it causes", () => {
    expect(isWrapped(s())).toBe(false);
    expect(isWrapped(s({ status: "archived" }))).toBe(true);
    expect(isWrapped(s({ frontier: { gate: "wrap" } as SessionPublic["frontier"] }))).toBe(true);
  });
});

describe("recency line", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  const at = (iso: string) => agoLine(iso, now);
  it("reads like a person says it", () => {
    expect(at("2026-08-19T11:59:40Z")).toBe("just now");
    expect(at("2026-08-19T11:15:00Z")).toBe("45m ago");
    expect(at("2026-08-19T07:00:00Z")).toBe("5h ago");
    expect(at("2026-08-18T09:00:00Z")).toBe("yesterday");
    expect(at("2026-08-17T09:00:00Z")).toBe("2 days ago");
    expect(at("2026-08-11T09:00:00Z")).toBe("last week");
    expect(at("2026-08-01T09:00:00Z")).toBe("2 weeks ago");
    expect(at("2026-07-10T09:00:00Z")).toBe("last month");
    expect(at("2026-03-10T09:00:00Z")).toBe("5 months ago");
  });
  it("never crashes on garbage timestamps", () => {
    expect(agoLine("not a date", now)).toBe("just now");
  });
});

describe("shelf legibility guarantee", () => {
  it("accepts real theme pairs and rejects a broken one", () => {
    expect(coverLegible("#e6edf3", "#07090b")).toBe(true);   // terminal noir
    expect(coverLegible("#22261f", "#f4efe3")).toBe(true);   // field notes
    expect(coverLegible("#777777", "#6f6f6f")).toBe(false);  // ink ≈ bg → fall back to shell surface
  });
});

describe("url unfurl", () => {
  it("names the domain without the www", () => {
    expect(urlDomain("https://www.nytimes.com/2026/a-story")).toBe("nytimes.com");
    expect(urlDomain("not a url")).toBeNull();
  });
  it("promises the right ingest per link kind", () => {
    expect(unfurlLine("https://www.youtube.com/watch?v=abc123")).toMatch(/captions/);
    expect(unfurlLine("https://github.com/owner/repo")).toMatch(/repo/);
    expect(unfurlLine("https://en.wikipedia.org/wiki/Tide")).toMatch(/page/);
  });
});

describe("suggested starts", () => {
  it("every set teaches the three shapes: a question, a link, an explain-like ask", () => {
    for (const set of SUGGESTION_SETS) {
      expect(set).toHaveLength(3);
      expect(set[0].fill).toMatch(/\?$/);
      expect(set[1].fill).toMatch(/^https:\/\//);
      expect(set[2].fill).toMatch(/^explain /);
      for (const c of set) {
        expect(findBannedWord(c.label)).toBeNull();
        expect(findBannedWord(c.fill)).toBeNull();
      }
    }
  });
  it("rotation never leaves the range, even for negative counters", () => {
    expect(suggestionsAt(0)).toBe(SUGGESTION_SETS[0]);
    expect(suggestionsAt(SUGGESTION_SETS.length)).toBe(SUGGESTION_SETS[0]);
    expect(suggestionsAt(-1)).toBe(SUGGESTION_SETS[SUGGESTION_SETS.length - 1]);
    expect(suggestionsAt(daySeed())).toBeDefined();
  });
});
