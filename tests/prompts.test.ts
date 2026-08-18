import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "@/lib/copy/banned";
import { CardSchema, PROSE_CARD_TYPES, VISUAL_CARD_TYPES, WRITER_CARD_TYPES } from "@/lib/schemas/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import { DISPLAY_FONTS, BODY_FONTS, MONO_FONTS } from "@/lib/schemas/theme";
import * as detour from "@/lib/prompts/detour";
import * as dial from "@/lib/prompts/dial";
import * as evaluate from "@/lib/prompts/evaluate";
import * as plan from "@/lib/prompts/plan";
import * as shared from "@/lib/prompts/shared";
import * as storyline from "@/lib/prompts/storyline";
import * as triage from "@/lib/prompts/triage";
import * as wrap from "@/lib/prompts/wrap";
import * as write from "@/lib/prompts/write";
import { CORPUS, PERSONA, detourCtx, evaluateInput, planInput, storylineInput, triageInput, wrapCtx, writeCtx } from "./llm.fixtures.test";

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
  evaluate: evaluate.buildEvaluatePrompt(evaluateInput()),
  storyline: storyline.buildStorylinePrompt(storylineInput()),
  wrap: wrap.buildWrapPrompt(wrapCtx()),
});

describe("prompt files", () => {
  it("export unique PROMPT_VERSIONs", () => {
    const versions = [
      plan.PROMPT_VERSION, write.PROMPT_VERSION, triage.PROMPT_VERSION, detour.PROMPT_VERSION,
      dial.PROMPT_VERSION, evaluate.PROMPT_VERSION, storyline.PROMPT_VERSION, wrap.PROMPT_VERSION,
    ];
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

    const up = write.buildWritePrompt(writeCtx({ learnerState: { ...state, level: 4 } }));
    expect(up.user).toContain("difficulty 4");
    expect(up.user).toMatch(/curveball/);
    const down = write.buildWritePrompt(writeCtx({ learnerState: { ...state, globalLevel: 2, level: 1, directives: { ...state.directives, pace: "compress" } } }));
    expect(down.user).toContain("difficulty 1");
    expect(down.user).toContain("compress");

    const cp = write.buildWritePrompt(writeCtx({ extraDirectives: ["end of node → checkpoint"] }));
    expect(cp.user).toMatch(/LAST card a "checkpoint"/);

    for (const [mode, needle] of [["teaser", "reading your stuff"], ["resurface", "FRESH bets"], ["adjacent", "one layer deeper"], ["recap", 'EXACTLY 1 "recap"'], ["scaffold", "EXACTLY 1 card"]] as const) {
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

  // ── the reader's #3 and #4: "70% of the cards are the same" / "don't skip basics" ──

  it("writer system prompt names the paragraph-deck failure mode and routes every point to a shape", () => {
    const s = write.buildWritePrompt(writeCtx()).system;
    expect(s).toMatch(/PARAGRAPH DECK/);
    expect(s).toMatch(/SHOW, DON'T TELL/);
    // every concrete-thing → type route the reader asked for
    for (const needle of [`a number, a ratio, a duration, a count, a price → "stat"`, `→ "diagram"`, `→ "sequence"`, `→ "code"`, `→ "slider"`, `→ "reveal"`, `→ "open"`]) {
      expect(s, needle).toContain(needle);
    }
    // worked examples move this model more than rules: weak card + the rewrite + why
    expect((s.match(/^weak: /gm) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((s.match(/^strong: /gm) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((s.match(/^why: /gm) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s).toContain('"type":"stat"');
    expect(s).toContain('"type":"diagram"');
    expect(s).toContain('"type":"reveal"');
    // concept is demoted from default to last resort, and never lands naked
    expect(s).toMatch(/LAST RESORT/);
    expect(s).toMatch(/it MUST carry a "visual"/);
    // no two prose cards in a row
    expect(s).toMatch(/never write two prose cards in a row/i);
    for (const t of PROSE_CARD_TYPES) expect(s).toContain(`"${t}"`);
  });

  it("every worked example in the prompts is a card that would actually validate", () => {
    // an example that fails the validator teaches the model the wrong shape — worse than no example.
    const s = write.buildWritePrompt(writeCtx()).system;
    const snippets = [...s.matchAll(/^(?:strong|example): (\{.*\})$/gm)].map((m) => m[1]);
    expect(snippets.length).toBeGreaterThanOrEqual(5);
    for (const raw of snippets) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const card = { id: crypto.randomUUID(), topicNodeId: "n1", detourId: null, ...parsed };
      const r = CardSchema.safeParse(card);
      expect(r.success, `${raw.slice(0, 80)} → ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
    // the weak examples are the anti-pattern: headline + paragraph, every one of them
    const weak = [...s.matchAll(/^weak: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]) as { type: string });
    expect(weak.length).toBeGreaterThanOrEqual(3);
    for (const w of weak) expect(w.type).toBe("concept");
  });

  it("writer system prompt refuses to skip basics or assume knowledge", () => {
    const s = write.buildWritePrompt(writeCtx()).system;
    expect(s).toMatch(/don't skip the basics/i);
    for (const phrase of ["as you know", "obviously", "simply", "of course"]) expect(s, phrase).toContain(`"${phrase}"`);
    expect(s).toContain('"terms"');
    expect(s).toMatch(/PREFER terms/);
    expect(s).toMatch(/≤ 6 words/);
    expect(s).toMatch(/FEWER WORDS PER CARD/);
    expect(s).toMatch(/one real example, one real number, one real name/);
  });

  it("stat + open are taught as first-class writer types with examples", () => {
    const s = write.buildWritePrompt(writeCtx()).system;
    expect(s).toContain("### stat");
    expect(s).toContain("### open");
    expect(s).toMatch(/any time the point of a card is a quantity, it is a stat card/i);
    expect(s).toMatch(/roughly one per topic/);
    expect(s).toMatch(/for the grader only and NEVER on screen/); // the open card's rubric
    expect(s).toContain('{"type":"stat","eyebrow":"the math nobody does"');
    expect(s).toContain('{"type":"open","eyebrow":"say it back"');
  });

  it("write prompt's batch shape demands a visual card, caps prose, and places the open beat", () => {
    const p = write.buildWritePrompt(writeCtx({ batchSize: 4 }));
    expect(p.user).toMatch(/batch shape/);
    expect(p.user).toMatch(/LEAD with the most concrete thing/);
    expect(p.user).toMatch(/your first card is NOT a "concept"/);
    for (const t of VISUAL_CARD_TYPES) expect(p.user, t).toContain(t);
    expect(p.user).toMatch(/at most ONE "concept" card here/);
    expect(p.user).toMatch(/never two prose cards/i);
    expect(p.user).toMatch(/include ONE "open" card/);
    expect(p.user).toMatch(/"terms"/);
    // once an open card has just gone by, stop asking for another one
    const after = write.buildWritePrompt(writeCtx({ recentTypes: ["stat", "open", "diagram"] }));
    expect(after.user).not.toMatch(/include ONE "open" card/);
    expect(after.user).toMatch(/already went by recently/);
  });

  it("write prompt carries recentTypes and the storyline so the feed stops repeating and stays on-story", () => {
    const cold = write.buildWritePrompt(writeCtx());
    expect(cold.user).toMatch(/card shapes just used: none yet/);
    expect(cold.user).toMatch(/through-line: not set yet/);

    const hot = write.buildWritePrompt(writeCtx({
      recentTypes: ["concept", "hook", "concept", "recap"],
      storyline: { spine: "a cache is a bet on repetition", covered: ["what a cache is"], next: "the stampede", updatedAtIdx: "a0" },
    }));
    expect(hot.user).toContain("concept → hook → concept → recap");
    expect(hot.user).toMatch(/the last card was a "recap"/);
    expect(hot.user).toMatch(/the last two were prose cards/);
    expect(hot.user).toContain("a cache is a bet on repetition");
    expect(hot.user).toContain("what a cache is");
    expect(hot.user).toContain("heading toward: the stampede");
    // the shapes it hasn't reached for get named
    expect(hot.user).toMatch(/is missing from that list/);
  });

  it("plan prompt refuses two prose cards on the fast path and offers real shapes for firstCards", () => {
    const s = plan.PLAN_SYSTEM;
    expect(s).toMatch(/at most ONE of them may be a "concept"/);
    expect(s).toMatch(/two concept cards in a row is the paragraph deck/);
    expect(s).toContain("### stat");
    expect(s).toContain("### diagram");
    expect(s).toContain("### reveal");
    expect(s).toMatch(/SHOW, DON'T TELL/);
  });

  it("evaluate prompt replies to what they wrote and rejects grader-speak at the schema", () => {
    const p = evaluate.buildEvaluatePrompt(evaluateInput());
    expect(p.system).toMatch(/this is NOT grading/i);
    expect(p.system).toMatch(/start from what THEY wrote/);
    expect(p.system).toContain("got_it");
    expect(p.system).toContain("close");
    expect(p.system).toContain("not_yet");
    expect(p.user).toContain("WHAT THEY ACTUALLY WROTE");
    expect(p.user).toContain("because every request becomes a miss");
    expect(p.user).toContain("<<<ANSWER");

    const S = evaluate.OpenEvaluationSchema;
    const good = { verdict: "close", feedback: "you've got the 'all at once' part, which is the hard half. the piece missing: the db was only sized for misses.", missed: ["sizing"] };
    expect(S.safeParse(good).success).toBe(true);
    for (const bad of ["correct! nice one.", "that's incorrect.", "wrong answer — try again.", "good job, you got it.", "you're correct about the misses."]) {
      expect(S.safeParse({ ...good, feedback: bad }).success, bad).toBe(false);
    }
    expect(S.safeParse({ verdict: "close", feedback: "x".repeat(321) }).success).toBe(false);
    expect(S.parse({ verdict: "got_it", feedback: "yep — that's it." }).missed).toEqual([]);

    const blank = evaluate.buildEvaluatePrompt(evaluateInput({ answer: "   " }));
    expect(blank.user).toContain("(they left it blank)");
  });

  it("fallbackEvaluation gives them the answer instead of a grade when the model is unreachable", () => {
    const f = evaluate.fallbackEvaluation("nothing is in memory, so every ask goes to the database at once.");
    expect(evaluate.OpenEvaluationSchema.safeParse(f).success).toBe(true);
    expect(f.feedback).toContain("every ask goes to the database at once.");
    expect(f.missed).toEqual([]);
    const long = evaluate.fallbackEvaluation("x".repeat(600));
    expect(long.feedback.length).toBeLessThanOrEqual(320);
    expect(evaluate.OpenEvaluationSchema.safeParse(long).success).toBe(true);
  });

  it("storyline prompt asks for a spine, landed beats and where it's heading — not a topic list", () => {
    const p = storyline.buildStorylinePrompt(storylineInput());
    expect(p.system).toMatch(/THROUGH-LINE/);
    expect(p.system).toMatch(/the argument, not the subject/);
    expect(p.system).toMatch(/never invent a beat that no card taught/);
    expect(p.user).toContain("→ caching: the core idea"); // the cursor marks where the feed is
    expect(p.user).toContain("  where caching breaks");
    expect(p.user).toContain("a miss costs a whole db read");
    expect(p.user).toContain("10x fewer db reads");
    expect(storyline.StorylineOutSchema.safeParse({ spine: "s", covered: ["a"], next: "n" }).success).toBe(true);
    expect("updatedAtIdx" in storyline.StorylineOutSchema.shape).toBe(false);
  });

  it("wrap prompt writes an ending in beats, not a recap of recaps", () => {
    const p = wrap.buildWrapPrompt(wrapCtx());
    expect(p.system).toContain("### wrap");
    expect(p.system).toMatch(/each beat is a CLAIM, not a topic name/);
    expect(p.system).toMatch(/never a percentage of anything finished/);
    expect(p.system).toContain("openThread");
    expect(p.user).toContain("a cache is a bet that you'll ask for the same thing twice");
    expect(p.user).toContain("your site is one restart from a stampede");
    expect(p.user).toContain('"topicNodeId": "system"');
    const noStory = wrap.buildWrapPrompt(wrapCtx({ storyline: null }));
    expect(noStory.user).toMatch(/no through-line recorded/);
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

  it("difficultyFor hands the writer `level` — the dial and what they earned, already folded together", () => {
    const s = defaultLearnerState();
    expect(shared.difficultyFor(s)).toBe(3);
    expect(shared.difficultyFor({ ...s, globalLevel: 5, level: 5 })).toBe(5);
    expect(shared.difficultyFor({ ...s, globalLevel: 1, level: 1 })).toBe(1);
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
