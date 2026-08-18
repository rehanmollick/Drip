import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findBannedInValue, findBannedWord } from "@/lib/copy/banned";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import { DEV_CARDS, SAMPLE_CARDS_V2 } from "@/lib/feed/dev";
import { WORST_CARDS } from "@/lib/feed/worst";
import { CARD_TYPES } from "@/lib/schemas/cards";

const ROOT = process.cwd();
const DIRS = ["components/cards", "components/ui", "components/feed", "components/home", "components/diagrams"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Every string literal / template chunk / JSX text in a source file. Comments are stripped first. */
function stringLiterals(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  // JSX text nodes: >text<
  const jsx = />([^<>{}]+)</g;
  while ((m = jsx.exec(noComments))) out.push(m[1]);
  return out;
}

describe("banned words (Prime Directive rule 1)", () => {
  it("findBannedWord matches word-boundary, case-insensitive, plurals", () => {
    expect(findBannedWord("take this quiz")).toBe("quiz");
    expect(findBannedWord("Two Tests")).toBe("test");
    expect(findBannedWord("contest winner")).toBeNull();
    expect(findBannedWord("the latest thing")).toBeNull();
    expect(findBannedWord("modules")).toBe("module");
    expect(findBannedWord("hot take: real or nah?")).toBeNull();
  });

  it("no sample card contains a banned word", () => {
    for (const c of SAMPLE_CARDS) {
      const hit = findBannedInValue(c);
      expect(hit, `${c.type} ${c.id}: ${JSON.stringify(hit)}`).toBeNull();
    }
  });

  it("no v2 fixture — showcase deck or schema-max ruler — contains a banned word", () => {
    for (const c of [...SAMPLE_CARDS_V2, ...WORST_CARDS]) {
      const hit = findBannedInValue(c);
      expect(hit, `${c.type} ${c.id}: ${JSON.stringify(hit)}`).toBeNull();
    }
  });

  it("the showcase deck covers every card type, so the screenshot pass sees all of them", () => {
    const types = new Set(DEV_CARDS.map((c) => c.type));
    for (const t of CARD_TYPES) {
      if (t === "notice" || t === "fallback" || t === "clarify" || t === "detour_marker") continue; // system cards, covered separately
      expect(types.has(t), `${t} missing from the showcase deck`).toBe(true);
    }
    // and the system ones are in there too
    for (const t of ["notice", "fallback", "clarify", "detour_marker"] as const) expect(types.has(t), t).toBe(true);
  });

  it("no card fixture shows a bare progress counter (\"3/47\")", () => {
    const counter = /\b\d+\s*\/\s*\d+\b/;
    const scan = (v: unknown, path: string): string[] => {
      if (typeof v === "string") return counter.test(v) ? [`${path}: ${v}`] : [];
      if (Array.isArray(v)) return v.flatMap((x, i) => scan(x, `${path}[${i}]`));
      if (v && typeof v === "object") {
        return Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== "code" && k !== "expression" && k !== "id")
          .flatMap(([k, x]) => scan(x, `${path}.${k}`));
      }
      return [];
    };
    const offenders = [...DEV_CARDS, ...WORST_CARDS].flatMap((c) => scan(c, `${c.type} ${c.id}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no UI component string literal contains a banned word", () => {
    const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const s of stringLiterals(src)) {
        // identifiers/imports/props are fine; we only care about human-facing copy, but scanning
        // every literal is the safe superset. Allow-list technical tokens that contain banned stems.
        if (/^[@./\w-]+$/.test(s) && !/\s/.test(s) && !findBannedWord(s.replace(/[-_./@]/g, " "))) continue;
        const w = findBannedWord(s);
        if (w) offenders.push(`${f.replace(ROOT + "/", "")}: "${s.slice(0, 60)}" → ${w}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
