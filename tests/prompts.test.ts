import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "@/lib/copy/banned";
import { WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import { DISPLAY_FONTS, BODY_FONTS, MONO_FONTS } from "@/lib/schemas/theme";
import * as detour from "@/lib/prompts/detour";
import * as dial from "@/lib/prompts/dial";
import * as plan from "@/lib/prompts/plan";
import * as shared from "@/lib/prompts/shared";
import * as triage from "@/lib/prompts/triage";
import * as write from "@/lib/prompts/write";
import { CORPUS, PERSONA, detourCtx, planInput, triageInput, writeCtx } from "./llm.fixtures.test";

const bigCorpus = () => {
  const parts: string[] = [];
  for (let i = 0; i < 400; i++) {
    parts.push(`## Section ${i}: Heading About Thing ${i}\n` + "lorem ipsum dolor sit amet, the cache is a bet on repetition. ".repeat(12));
  }
  return parts.join("\n\n"); // ~300k chars
};

const prompts = () => ({
  plan: plan.buildPlanPrompt(planInput()),
  write: write.buildWritePrompt(writeCtx()),
  triage: triage.buildTriagePrompt(triageInput()),
  detour: detour.buildDetourPrompt(detourCtx()),
  dial: dial.buildDialPrompt({ persona: PERSONA, direction: "simpler" }),
});

describe("prompt files", () => {
  it("export unique PROMPT_VERSIONs", () => {
    const versions = [plan.PROMPT_VERSION, write.PROMPT_VERSION, triage.PROMPT_VERSION, detour.PROMPT_VERSION, dial.PROMPT_VERSION];
    for (const v of versions) expect(v).toMatch(/^[a-z]+\.v\d+$/);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("every system prompt carries the banned words list and the JSON-only instruction", () => {
    for (const [name, p] of Object.entries(prompts())) {
      for (const w of BANNED_WORDS) expect(p.system, `${name} missing ${w}`).toContain(w);
      expect(p.system, name).toContain("ONLY a JSON object");
      expect(p.system, name).toContain("no code fences");
      expect(p.system.length, name).toBeGreaterThan(200);
      expect(p.user.length, name).toBeGreaterThan(10);
    }
  });

  it("writer/planner system prompts hard-forbid the big five", () => {
    for (const p of [prompts().plan, prompts().write, prompts().detour]) {
      expect(p.system).toMatch(/fabricat/i);
      expect(p.system).toContain("the source doesn't cover this");
      expect(p.system).toContain("off-source");
      expect(p.system).toMatch(/never repeat a metaphor/i);
      expect(p.system).toMatch(/character cap/i);
      expect(p.system).toMatch(/HTML/);
      expect(p.system).toContain("3/47");
      expect(p.system).toMatch(/"correct", "incorrect"/);
    }
  });

  it("system prompts are byte-stable across calls (cacheable) and free of timestamps", () => {
    const a = write.buildWritePrompt(writeCtx()).system;
    const b = write.buildWritePrompt(writeCtx({ recent: [{ type: "hook", gist: "x" }], batchSize: 2, mode: "recap" })).system;
    expect(a).toBe(b);
    expect(plan.buildPlanPrompt(planInput()).system).toBe(plan.buildPlanPrompt(planInput({ sourceText: "other" })).system);
    expect(detour.buildDetourPrompt(detourCtx()).system).toBe(a); // detour shares the writer system prompt
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("plan prompt embeds the font lists, theme rules, and clichés ban", () => {
    const s = plan.PLAN_SYSTEM;
    for (const f of [...DISPLAY_FONTS, ...BODY_FONTS, ...MONO_FONTS]) expect(s).toContain(f);
    expect(s).toMatch(/exactly ONE accent/);
    expect(s).toMatch(/cream-and-terracotta/);
    expect(s).toMatch(/acid green/);
    expect(s).toContain("signatureKind");
    expect(s).toContain("hex-addresses");
    expect(s).toMatch(/EXACTLY 3 cards/);
    expect(s).toContain('"hook"');
    expect(s).toContain("skim");
  });

  it("plan prompt bounds a huge corpus and samples headings from the rest", () => {
    const p = plan.buildPlanPrompt(planInput({ sourceText: bigCorpus() }));
    expect(p.user.length).toBeLessThan(plan.PLAN_CORPUS_CHARS + 8_000);
    expect(p.user).toContain("more characters omitted");
    expect(p.user).toContain("headings sampled");
    expect(p.user).toContain("Section 399");
  });

  it("plan prompt carries clarifier answers + previous plan on re-plan", () => {
    const first = plan.buildPlanPrompt(planInput());
    expect(first.user).toContain("clarifier answers: none yet");
    const prev = { title: "t", theme: { name: "terminal noir" }, outline: [{ id: "n1", title: "one", estCards: 3 }] };
    const re = plan.buildPlanPrompt(planInput({ clarifierAnswers: { audience: "me, curious" }, previousPlan: prev as never }));
    expect(re.user).toContain("audience: me, curious");
    expect(re.user).toContain("previous plan");
    expect(re.user).toContain("terminal noir");
  });

  it("write prompt: mode instructions, difficulty directive, checkpoint, chill mode", () => {
    const state = defaultLearnerState();
    const normal = write.buildWritePrompt(writeCtx({ batchSize: 4 }));
    expect(normal.user).toContain("write EXACTLY 4 cards");
    expect(normal.user).toContain("at least ONE interactive");
    expect(normal.user).toContain("difficulty 3");
    expect(normal.user).toContain('"detourId": null');
    expect(normal.user).toContain("metaphors already used");

    const chill = write.buildWritePrompt(writeCtx({ allowedTypes: WRITER_CARD_TYPES.filter((t) => !["binary", "predict", "sequence", "slider"].includes(t)), settings: { chillMode: true, depthPreset: "standard", soundOn: false } }));
    expect(chill.user).toContain("chill mode: no bets");
    expect(chill.system).not.toContain("### binary");
    expect(chill.system).toContain("### reveal");

    const up = write.buildWritePrompt(writeCtx({ learnerState: { ...state, directives: { ...state.directives, difficultyDelta: 1 } } }));
    expect(up.user).toContain("difficulty 4");
    expect(up.user).toMatch(/curveball/);
    const down = write.buildWritePrompt(writeCtx({ learnerState: { ...state, globalLevel: 2, directives: { ...state.directives, difficultyDelta: -1, pace: "compress" } } }));
    expect(down.user).toContain("difficulty 1");
    expect(down.user).toContain("compress");

    const cp = write.buildWritePrompt(writeCtx({ extraDirectives: ["end of node → checkpoint"] }));
    expect(cp.user).toMatch(/LAST card a "checkpoint"/);

    for (const [mode, needle] of [["teaser", "reading your stuff"], ["resurface", "FRESH bets"], ["adjacent", "one layer deeper"], ["recap", 'EXACTLY 1 "recap"'], ["scaffold", 'EXACTLY 1 "concept"']] as const) {
      const p = write.buildWritePrompt(writeCtx({ mode, missedConcepts: ["TTL"] }));
      expect(p.user, mode).toContain(needle);
    }
    const teaser = write.buildWritePrompt(writeCtx({ mode: "teaser", corpusSlice: bigCorpus() }));
    expect(teaser.user.length).toBeLessThan(write.TEASER_CORPUS_CHARS + 6_000);
    const big = write.buildWritePrompt(writeCtx({ corpusSlice: bigCorpus() }));
    expect(big.user.length).toBeLessThan(write.WRITE_CORPUS_CHARS + 8_000);
  });

  it("detour prompt: count, question, focus, ids, first-card rule", () => {
    const p = detour.buildDetourPrompt(detourCtx({ cardCount: 5 }));
    expect(p.user).toContain("EXACTLY 5 cards");
    expect(p.user).toContain("why does a restart cause a stampede?");
    expect(p.user).toContain('"detourId": "d-1"');
    expect(p.user).toContain('"topicNodeId": "n1"');
    expect(p.user).toMatch(/FIRST card answers the question directly/);
  });

  it("triage prompt: inline vs detour rules + persona + schema", () => {
    const p = triage.buildTriagePrompt(triageInput());
    expect(p.system).toContain('"kind":"inline"');
    expect(p.system).toContain('"kind":"detour"');
    expect(p.system).toContain("cardCount");
    expect(p.system).toContain(PERSONA.tics[0]);
    expect(p.user).toContain("what is a TTL?");
    expect(triage.buildTriagePrompt(triageInput({ corpusSlice: bigCorpus() })).user.length).toBeLessThan(triage.TRIAGE_CORPUS_CHARS + 6_000);
  });

  it("dial prompt: direction + toast schema", () => {
    const p = dial.buildDialPrompt({ persona: PERSONA, direction: "deeper" });
    expect(p.user).toContain("direction: deeper");
    expect(p.system).toContain('"toast"');
    expect(dial.CANNED_TOASTS.simpler).toBe("say less. rewinding the jargon.");
  });
});

describe("shared helpers", () => {
  it("cardSchemaBlock generates schemas from zod (in sync with the validator)", () => {
    const block = shared.cardSchemaBlock(WRITER_CARD_TYPES);
    for (const t of WRITER_CARD_TYPES) expect(block).toContain(`### ${t}`);
    expect(block).toContain('"maxLength":320'); // concept body cap
    expect(block).toContain('"format":"uuid"');
    expect(block).not.toContain("$schema");
    expect(block).not.toContain("highlighted"); // never AI-filled
    expect(block).toContain("prefixItems"); // binary options tuple
    expect(block).toContain("additionalProperties"); // diagram tapNotes record
  });

  it("sliceCorpus is identity under the cap and bounded above it", () => {
    expect(shared.sliceCorpus(CORPUS, 24_000)).toBe(CORPUS);
    const s = shared.sliceCorpus(bigCorpus(), 5_000);
    expect(s.length).toBeLessThan(5_000 + 4_000);
    expect(s).toContain("more characters omitted");
    expect(shared.sampleHeadings("# A\nplain sentence here.\n## B\nAnother Heading Line\n1. Numbered thing")).toEqual(["A", "B", "Another Heading Line", "1. Numbered thing"]);
  });

  it("difficultyFor clamps globalLevel + delta into 1..5", () => {
    const s = defaultLearnerState();
    expect(shared.difficultyFor(s)).toBe(3);
    expect(shared.difficultyFor({ ...s, globalLevel: 5, directives: { ...s.directives, difficultyDelta: 2 } })).toBe(5);
    expect(shared.difficultyFor({ ...s, globalLevel: 1, directives: { ...s.directives, difficultyDelta: -2 } })).toBe(1);
  });

  it("learnerSummary reports hit rate and directives", () => {
    const s = defaultLearnerState();
    const txt = shared.learnerSummary({ ...s, rolling: { last10Interactive: [true, true, false, true], dwellMs: [], avgDwellMs: 2400 }, directives: { ...s.directives, scaffoldNext: ["TTL"], reinforce: ["stampede"] } });
    expect(txt).toContain("3/4 landed (75%)");
    expect(txt).toContain("2.4s");
    expect(txt).toContain("TTL");
    expect(txt).toContain("stampede");
  });
});
