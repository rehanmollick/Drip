import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findBannedInValue } from "@/lib/copy/banned";
import { describeViolations, enforceVariety, isVisualType, proseHeavyRatio } from "@/lib/generation/variety";
import type { CardSummary, LlmMeta, WriteContext } from "@/lib/llm-types";
import { CardSchema, VISUAL_CARD_TYPES, WRITER_CARD_TYPES, type Card } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import type { OutlineNode, Persona } from "@/lib/schemas/plan";
import type { Storyline } from "@/lib/schemas/session";
import type { VisualSpec } from "@/lib/schemas/visual";

/**
 * Three real batches — one technical, one humanities, one science — printed in
 * full so a person can READ them. Opt-in, never in CI.
 *
 *   DRIP_LIVE_WRITE=1 pnpm exec vitest run tests/write.live.test.ts
 *
 * Every other test in this repo reads lib/llm-mock.ts, whose cards always carry
 * a visual, never repeat a shape and never write a bad sentence. That makes any
 * claim about the WRITING unfalsifiable. This file puts the actual prose on the
 * terminal and lets a human be the judge of it.
 *
 * The three subjects deliberately share no vocabulary. The writer prompt's gold
 * examples are all caching (lib/prompts/shared.ts), so each transcript also
 * counts how much of that vocabulary turned up in a batch about Austen or about
 * lake ice — counted and printed, never asserted: leakage is a judgement call,
 * and this file only asserts what a machine can settle.
 *
 * Asserted: every card validates, no copy past its cap, no school vocabulary,
 * at least one card per batch that carries its idea as a shape rather than a
 * paragraph. Whether it is any GOOD is what the transcript is for.
 */
const LIVE = process.env.DRIP_LIVE_WRITE === "1";

/** .env.local, loaded here (vitest doesn't) and only when the gate is open. Mirrors tests/plan.live.test.ts. */
function loadEnvLocal(): void {
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}

// ── the three subjects ────────────────────────────────────────────────────────

const GIT_SOURCE = `# git, from the bottom up

Everything git stores is one of four objects, and every object is named by a hash of its own contents (a short type header, then the bytes). Change a byte, get a different name. The name IS the checksum.

## blobs and trees

A blob is a file's contents. Not its name, not its path, not its permissions — just the bytes. Two files with identical contents anywhere in the repository, on any branch, in any year, are one blob stored once.

Names live in trees. A tree is a short list of rows: mode, type, hash, name. "100644 blob a3c2f1b… README.md". A tree row can point at another tree, which is how directories nest.

## commits

A commit object is smaller than people expect. It is a text object holding one tree (the whole snapshot of the project at that moment), zero or more parents, an author, a committer, and the message. That is the entire thing. "git cat-file -p HEAD" prints it in about a dozen lines.

Because a commit's hash covers its tree and its parents, and those hashes cover everything beneath them, a commit's name is a checksum of all the history behind it. You cannot quietly edit an old commit: everything downstream changes name.

## refs

A branch is not a container of commits. It is a file under .git/refs/heads holding one 40-character hash. "git commit" writes a new commit object and rewrites that one line. That is why branching is instant, and why deleting a branch deletes nothing but a pointer.

Rebase does not move commits either. It writes new ones, with new hashes, and moves the ref; the originals sit in the object store until garbage collection walks it and finds nothing pointing at them.`;

const AUSTEN_SOURCE = `# free indirect style

There are three ordinary ways to get a character's thought onto a page. Direct: "I am ruined!" she thought. Indirect: she thought that she was ruined. And then the third, which has no quotation marks and no "she thought" anywhere in it: She was ruined. Ruined! and after everything she had done for them.

That third one is free indirect style. Charles Bally named it "style indirect libre" in 1912, long after novelists had been quietly using it. The grammar stays in the narrator's third person and past tense. The DICTION defects to the character.

## how you hear it

The tells are small and almost all of them are word choice. Judgement words only the character would reach for ("wretched", "odious", "such an overthrow"). Exclamations and questions sitting inside otherwise flat narration. Deixis held in the character's present: "tomorrow" means her tomorrow, not the narrator's.

Austen, in Emma, after the ball: "The hair was curled, and the maid sent away, and Emma sat down to think and be miserable. — It was a wretched business, indeed!" Nobody is speaking out loud. That last sentence is Emma's, in the narrator's mouth.

## what it buys

Sympathy and judgement in the same sentence. The reader sits inside the character's estimate of herself and simultaneously sees around it, because the narrator has lent her the sentence without endorsing a word of it. That double vision is the engine of nineteenth-century irony — Austen, Eliot, Flaubert — and it is why a novel can be merciless about someone it also loves.

Flaubert pushed it furthest. In Madame Bovary whole paragraphs of romantic cliché are Emma Bovary's own reading habits, set down without a frame around them, so the prose itself performs the delusion it is describing.`;

const LAKE_SOURCE = `# why a lake freezes from the top

Almost everything gets denser as it cools, right down to the point where it solidifies. Water does not. Fresh water reaches maximum density at about 4°C — 3.98, if you want it exact — and then gets LIGHTER again on the way down to 0. Ice is lighter still: roughly 9% less dense than the water it came from, which is why it floats with about a tenth of itself standing above the surface.

## the cage

In liquid water the hydrogen bonds between molecules form and break constantly, so molecules keep sliding into whatever gaps are going. When water freezes, every molecule locks into four bonds at fixed angles and the result is an open hexagonal cage with empty space at the middle of it. Freezing does not pack water tighter. It builds a scaffold, and the scaffold has holes in it.

## autumn

A lake in autumn loses heat from the surface. The chilled surface water is denser than what sits under it, so it sinks, and warmer water comes up to be chilled in its turn. The whole column keeps overturning like that — the autumn turnover — until the lake is at 4°C from top to bed.

Now keep cooling the surface. Below 4°C that surface water is lighter than the water underneath, so it stops sinking. It sits there, loses heat quickly because nothing is replacing it, and freezes. The ice caps the lake and insulates everything under it.

That is why there are fish alive under there in February. The water below the ice sits near 4°C all winter. If ice sank instead, lakes would freeze from the bed upward every winter and the deep ones would never fully thaw.`;

const SETTINGS: WriteContext["settings"] = { chillMode: false, depthPreset: "standard", soundOn: false };

function batchCtx(o: {
  sessionId: string;
  persona: Persona;
  theme: WriteContext["theme"];
  node: OutlineNode;
  corpusSlice: string;
  storyline: Storyline;
  recent: CardSummary[];
  usedMetaphors: string[];
}): WriteContext {
  return {
    ...o,
    mode: "normal",
    sourceKind: "paste",
    settings: SETTINGS,
    learnerState: defaultLearnerState(),
    // the engine always hands the writer the shapes already on screen; without them the
    // variety directives never fire and what we'd be reading isn't what a reader gets
    recentTypes: o.recent.map((r) => r.type),
    allowedTypes: WRITER_CARD_TYPES,
    batchSize: 4,
    detourId: null,
    extraDirectives: [],
  };
}

type Subject = {
  family: "technical" | "humanities" | "science";
  /** what a reader is about to read, for the transcript header. */
  what: string;
  ctx: WriteContext;
};

const SUBJECTS: Subject[] = [
  {
    family: "technical",
    what: "git's object model — a batch mid-session on what a commit actually is",
    ctx: batchCtx({
      sessionId: "9a1e7c40-3b21-4f8a-9d55-1c0a2b3c4d5e",
      persona: {
        name: "plumber",
        traits: ["reads git's plumbing for fun", "distrusts magic", "opens the box to explain it"],
        tics: ["says 'open it up and look'", "calls the friendly commands 'the front door'"],
        humor: "dry, fond of the machine",
        neverDoes: "never says 'just run this'",
        analogyWorld: "a warehouse where the shelf number is the item",
        sampleCard: {
          headline: "the whole commit is a dozen lines of text",
          body: "cat-file any commit and it prints in full: one tree hash, the parent it came from, who wrote it, when, and the message. no diff. no file list. the snapshot is the tree, the ancestry is that parent line, and everything else you think of as a commit is git reading those two hashes for you.",
        },
      },
      theme: {
        name: "workbench",
        mood: "bench light on bare metal, everything unscrewed and laid out in order",
        signature: "object hashes shown as seven-character stubs, mono, in the accent",
      },
      node: {
        id: "n2",
        title: "what a commit actually is",
        estCards: 4,
        dependsOn: ["n1"],
        brief: "a commit is a small text object: one tree, its parents, a message. because its hash covers all of that, and theirs cover everything beneath, you cannot edit history quietly.",
        corpusHint: "the ## commits section, and ## refs right after it",
      },
      corpusSlice: GIT_SOURCE,
      storyline: {
        spine: "git is a content-addressed object store with a friendly front door bolted on. name the four objects and every command stops being magic.",
        covered: ["everything git stores is one of four objects", "a blob is contents, never a name"],
        next: "what a commit object actually holds",
        updatedAtIdx: "a2",
      },
      recent: [
        { type: "hook", gist: "you have been using a content-addressed store all along" },
        { type: "diagram", gist: "blob → tree → commit, each naming the thing under it by hash" },
        { type: "binary", gist: "bet: renaming a file makes a new blob — it does not", metaphor: "a shelf number you cannot fake" },
      ],
      usedMetaphors: ["a shelf number you cannot fake"],
    }),
  },
  {
    family: "humanities",
    what: "free indirect style — the hard case: no numbers, no mechanism, nothing to draw",
    ctx: batchCtx({
      sessionId: "7c2b1d90-5e44-4a1b-8c3d-2f9e8d7c6b5a",
      persona: {
        name: "the seminar",
        traits: ["reads sentences out loud", "hunts the word that gives it away", "allergic to 'relatable'"],
        tics: ["says 'listen to who is talking'", "quotes first, explains after"],
        humor: "wry, a bit gossipy about novelists",
        neverDoes: "never calls a novel 'content'",
        analogyWorld: "half-heard talk on a bus",
        sampleCard: {
          headline: "nobody is speaking and two people own the sentence",
          body: "'it was a wretched business, indeed!' is in the narrator's past tense, third person, no quotation marks — and 'wretched business' is emma's phrase, not the narrator's. austen has lent her the sentence without agreeing to a word of it. that is the whole trick, and it never announces itself.",
        },
      },
      theme: {
        name: "foxed paper",
        mood: "library lamp on yellowed pages, pencil all over the margins",
        signature: "quoted lines set in the serif face, everything around them in the sans",
      },
      node: {
        id: "n2",
        title: "hearing the character inside the narrator",
        estCards: 4,
        dependsOn: ["n1"],
        brief: "the tells are lexical: judgement words only she would choose, exclamations inside flat narration, 'tomorrow' meaning her tomorrow. land them on the emma quotation.",
        corpusHint: "the ## how you hear it section and the Emma quotation in it",
      },
      corpusSlice: AUSTEN_SOURCE,
      storyline: {
        spine: "free indirect style is how a novel sits inside someone's head and sees around it in the same sentence — sympathy and judgement without the narrator stepping in.",
        covered: ["a thought reaches the page three ways", "the grammar stays with the narrator, the words defect"],
        next: "the tells you can actually hear in austen",
        updatedAtIdx: "a2",
      },
      recent: [
        { type: "hook", gist: "one sentence in emma has no speaker and two owners" },
        { type: "sequence", gist: "direct, indirect, free indirect — the three ways to carry a thought, in order" },
        { type: "concept", gist: "grammar stays third person, diction defects to the character", metaphor: "a borrowed coat" },
      ],
      usedMetaphors: ["a borrowed coat"],
    }),
  },
  {
    family: "science",
    what: "why lakes freeze from the top — a subject with numbers in it",
    ctx: batchCtx({
      sessionId: "4d3c2b1a-9f88-4e77-b6a5-0c1d2e3f4a5b",
      persona: {
        name: "field notes",
        traits: ["has drilled holes in winter lakes", "starts from what you can see", "distrusts tidy diagrams"],
        tics: ["says 'go stand on it'", "gives temperatures to one decimal"],
        humor: "quiet, a little awed",
        neverDoes: "never says 'it's simple'",
        analogyWorld: "a cold morning on a dock",
        sampleCard: {
          headline: "the lake turns itself over until it can't",
          body: "cold surface water is heavy, so it drops and warmer water comes up to be chilled in its turn. the whole lake keeps doing that, top to bed, until every drop of it is at 4°c. then the next bit of cooling makes the surface lighter instead of heavier, the sinking stops, and winter starts.",
        },
      },
      theme: {
        name: "ice-out",
        mood: "grey light on a frozen lake, breath visible, nothing hurried",
        signature: "a thin accent waterline under headlines, sitting at the level being described",
      },
      node: {
        id: "n2",
        title: "the four-degree trapdoor",
        estCards: 4,
        dependsOn: ["n1"],
        brief: "a cooling lake keeps overturning until the whole column is at 4°C; below that the surface goes lighter as it cools, mixing stops, and the ice caps it for the winter.",
        corpusHint: "the ## autumn section",
      },
      corpusSlice: LAKE_SOURCE,
      storyline: {
        spine: "one oddity — water is heaviest at 4°C, not at 0 — is the reason lakes freeze from the top and anything is alive under them in february.",
        covered: ["ice floats, and almost nothing else does that", "the open hexagonal cage is why"],
        next: "what the 4°C rule does to a whole lake in autumn",
        updatedAtIdx: "a2",
      },
      recent: [
        { type: "hook", gist: "ice is the only reason there is anything alive under a frozen lake" },
        { type: "stat", gist: "water is heaviest at 3.98°C, not at 0" },
        { type: "diagram", gist: "the open hexagonal cage that makes ice lighter than water", metaphor: "scaffolding with holes in it" },
      ],
      usedMetaphors: ["scaffolding with holes in it"],
    }),
  },
];

// ── printing the cards so a person can read them ─────────────────────────────

const WIDTH = 78;
const RULE = "─".repeat(WIDTH);
const HEAVY = "═".repeat(WIDTH);

/** Soft-wrap with a hanging indent, so long copy still reads like copy in a terminal. */
function wrap(text: string, indent = "     "): string[] {
  const out: string[] = [];
  const push = (l: string) => out.push((out.length ? `${indent}  ` : indent) + l);
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length + indent.length > WIDTH) {
      push(line);
      line = word;
    } else line = next;
  }
  if (line) push(line);
  return out;
}

const head = (t: string) => wrap(t, "   ▌ ");
const copy = (t: string) => wrap(t);
const note = (label: string, t: string) => wrap(`${label}: ${t}`);
const bar = (level: number) => "█".repeat(Math.round(Math.max(0, Math.min(100, level)) / 10)).padEnd(10, "·");

function visualLine(v: VisualSpec): string {
  switch (v.kind) {
    case "none": return "visual: none";
    case "icon": return `visual: icon ${v.icon}`;
    case "stat": return `visual: stat ${v.value} — ${v.label}`;
    case "ascii": return `visual: ascii ${v.lines.join(" / ")}`;
    case "spark": return `visual: spark [${v.values.join(", ")}]${v.label ? ` — ${v.label}` : ""}`;
  }
}

/** One card as it would sit on one 393×852 screen, near enough to read and judge. */
function screen(card: Card, n: number): string[] {
  const tags = [card.eyebrow ? `eyebrow "${card.eyebrow}"` : null, card.anchor ? `anchor ${card.anchor}` : null].filter(Boolean).join(", ");
  const out = [RULE, `${String(n).padStart(2)}  ${card.type.toUpperCase()}${tags ? `   (${tags})` : ""}`, ""];

  switch (card.type) {
    case "hook":
      out.push(...head(card.headline));
      if (card.sub) out.push(...copy(card.sub));
      break;
    case "concept":
      out.push(...head(card.headline), ...copy(card.body));
      break;
    case "code":
      if (card.title) out.push(...head(card.title));
      out.push(`     [${card.lang}]`);
      card.code.split("\n").forEach((l, i) => out.push(`     ${String(i + 1).padStart(2)} │ ${l}`));
      if (card.annotations.length) out.push("");
      for (const a of card.annotations) out.push(...copy(`↳ line ${a.line}: ${a.note}`));
      break;
    case "diagram":
      out.push(...head(`${card.title}   (${card.variant})`));
      for (const node of card.nodes) out.push(`     ${node.emphasis ? "◆" : "◇"} ${node.id}: ${node.label}${node.sub ? ` — ${node.sub}` : ""}`);
      for (const e of card.edges) out.push(`     ${e.from} → ${e.to}${e.label ? `   "${e.label}"` : ""}`);
      for (const [id, n2] of Object.entries(card.tapNotes ?? {})) out.push(...copy(`tap ${id}: ${n2}`));
      break;
    case "binary":
      out.push(...head(card.prompt));
      card.options.forEach((o, i) => out.push(`     ${i === card.correctIndex ? "✓" : "·"} ${o}`));
      out.push("", ...note("reveal", card.revealCopy), `     difficulty ${card.difficulty}`);
      break;
    case "predict":
      out.push(...head(card.prompt));
      card.options.forEach((o, i) => out.push(`     ${i === card.correctIndex ? "✓" : "·"} ${o}`));
      out.push("", ...note("next slide", card.revealHeadline), ...copy(card.revealBody), `     difficulty ${card.difficulty}`);
      break;
    case "sequence":
      out.push(...head(card.prompt));
      card.items.forEach((item, i) => out.push(`     ${i + 1}. ${item.label}`));
      out.push("     (the client shuffles these; the order above is the answer)", "", ...note("reveal", card.revealCopy), `     difficulty ${card.difficulty}`);
      break;
    case "slider":
      out.push(...head(card.prompt));
      out.push(`     ${card.label}: ${card.min} → ${card.max} step ${card.step}, starts at ${card.defaultValue}${card.unit ? ` ${card.unit}` : ""}`);
      out.push(`     ${card.expression}  ⇒  ${card.outputLabel}${card.outputUnit ? ` (${card.outputUnit})` : ""} as ${card.outputFormat}`);
      if (card.insight) out.push(...copy(card.insight));
      break;
    case "reveal":
      out.push(...head(card.setup), "     — tap —", ...copy(card.payoff));
      break;
    case "checkpoint":
      out.push(...head(card.headline));
      if (card.sub) out.push(...copy(card.sub));
      if (card.stat) out.push(`     ${card.stat.value} — ${card.stat.label}`);
      break;
    case "recap":
      out.push(...head(card.headline));
      for (const b of card.beats) out.push(...copy(`· ${b}`));
      if (card.metaphor) out.push(`     metaphor: ${card.metaphor}`);
      break;
    case "stat":
      out.push(...head(`${card.value}${card.unit ? ` ${card.unit}` : ""}`));
      out.push(`     ${card.label}`, ...copy(card.context));
      if (card.compare) out.push(`     next to: ${card.compare.value} — ${card.compare.label}`);
      break;
    case "open":
      out.push(...head(card.prompt));
      if (card.placeholder) out.push(`     [${card.placeholder}]`);
      out.push("", ...note("model answer", card.modelAnswer), ...note("rubric (never on screen)", card.rubric), `     difficulty ${card.difficulty}`);
      break;
    case "scrub":
      out.push(...head(card.title), `     meter: ${card.meterLabel}`);
      for (const f of card.frames) {
        out.push(`     ${bar(f.level)} ${f.label}`);
        out.push(...wrap(f.caption, "       "));
      }
      if (card.insight) out.push(...copy(card.insight));
      break;
    case "spot":
      out.push(...head(card.prompt));
      for (const p of card.pieces) {
        out.push(`     ${p.hit ? "✗" : "·"} ${p.text}`);
        if (p.note) out.push(...wrap(p.note, "       "));
      }
      out.push("", ...note("reveal", card.revealCopy), `     difficulty ${card.difficulty}${card.mono ? " · mono" : ""}`);
      break;
    default:
      // the writer shouldn't produce these; if one turns up, seeing it raw is the point
      out.push(...JSON.stringify(card, null, 2).split("\n").map((l) => `     ${l}`));
  }

  if ("terms" in card && card.terms?.length) {
    out.push("");
    for (const t of card.terms) out.push(...copy(`◦ ${t.term} — ${t.gloss}`));
  }
  if ("visual" in card && card.visual) out.push(`     ${visualLine(card.visual)}`);
  return out;
}

/**
 * How much of the prompt's caching vocabulary came along for the ride. Printed only:
 * a lake batch that says "database" is a smell, not a failure, and only a person
 * reading the transcript can tell which one it is.
 */
const GOLD_VOCAB = ["cache", "caching", "cached", "caches", "cache-aside", "database", "redis", "ttl", "latency", "hit rate", "stampede", "thundering herd", "invalidation", "key-value"];

function goldVocab(cards: Card[]): string[] {
  const text = JSON.stringify(cards);
  const out: string[] = [];
  for (const word of GOLD_VOCAB) {
    const hits = text.match(new RegExp(`\\b${word}\\b`, "gi"))?.length ?? 0;
    if (hits) out.push(`${word}×${hits}`);
  }
  return out;
}

function transcript(s: Subject, cards: Card[], meta: LlmMeta): string {
  const types = cards.map((c) => c.type);
  const v = enforceVariety(s.ctx.recentTypes ?? [], cards);
  const leak = goldVocab(cards);
  const lines = [
    "",
    HEAVY,
    `${s.family.toUpperCase()} — ${s.what}`,
    `node "${s.ctx.node?.title ?? ""}" · persona "${s.ctx.persona.name ?? "—"}" · theme "${s.ctx.theme.name}"`,
    `${meta.model} · ${meta.promptVersion} · asked for ${s.ctx.batchSize}`,
    HEAVY,
  ];
  cards.forEach((c, i) => lines.push(...screen(c, i + 1)));
  lines.push(
    RULE,
    `shapes:   ${types.join(" → ")}`,
    `mix:      ${types.filter(isVisualType).length}/${cards.length} carry a shape · ${Math.round(proseHeavyRatio(cards) * 100)}% headline-plus-paragraph · variety ${describeViolations(v.violations)}${v.dropped.length ? ` (the governor would drop ${v.dropped.length})` : ""}`,
    `call:     ${meta.attempts} attempt(s) · ${(meta.latencyMs / 1000).toFixed(1)}s · ${meta.inTokens} in / ${meta.outTokens} out`,
    `caching vocabulary from the prompt's gold examples: ${leak.length ? leak.join(", ") : "none"}`,
    HEAVY,
    "",
  );
  return lines.join("\n");
}

// ── the run ──────────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)("live write — three real batches (set DRIP_LIVE_WRITE=1 to spend the calls; skipped otherwise)", () => {
  beforeAll(() => {
    loadEnvLocal();
    process.env.DRIP_STORE = "local";
    process.env.DRIP_DATA_DIR = process.env.DRIP_DATA_DIR ?? ".data/write-live";
    delete process.env.LLM_MODE;
    expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY missing").toBeTruthy();
  });

  for (const subject of SUBJECTS) {
    it(`${subject.family}: ${subject.what}`, { timeout: 120_000 }, async () => {
      const { llm } = await import("@/lib/llm");
      const res = await llm.writeBatch(subject.ctx);
      if (!res.ok) throw new Error(`write failed: ${res.code} ${res.error}`);
      const cards = res.value;
      console.log(transcript(subject, cards, res.meta));

      expect(cards.length, "the writer returned an empty batch").toBeGreaterThan(0);

      cards.forEach((card, i) => {
        const at = `card ${i + 1} (${card.type})`;
        const parsed = CardSchema.safeParse(card);
        const issues = parsed.success ? [] : parsed.error.issues;
        // llm.ts already validated (and trims over-long copy back to a sentence), so this is the
        // guard that what we just PRINTED is exactly what the renderer would be handed.
        expect(issues.filter((x) => x.code === "too_big").map((x) => `${x.path.join(".")}: ${x.message}`), `${at} has copy past its cap`).toEqual([]);
        expect(parsed.success, `${at} does not validate: ${issues.map((x) => `${x.path.join(".") || "$"} ${x.message}`).join("; ")}`).toBe(true);
        expect(findBannedInValue(card), `${at} put school vocabulary on screen`).toBeNull();
      });

      const types = cards.map((c) => c.type);
      expect(
        types.some((t) => (VISUAL_CARD_TYPES as readonly string[]).includes(t)),
        `nothing in this batch carries its idea as a shape — it is a wall of prose: ${types.join(", ")}`,
      ).toBe(true);
    });
  }
});
