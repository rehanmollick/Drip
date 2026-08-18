import { describe, expect, it } from "vitest";
import { findBannedWord } from "@/lib/copy/banned";
import { PLAN_SYSTEM, buildPlanPrompt, spineFromPlan } from "@/lib/prompts/plan";
import { OutlineNodeSchema, PlanOutputSchema, type PlanOutput } from "@/lib/schemas/plan";
import { StorylineSchema } from "@/lib/schemas/session";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { planInput } from "./llm.fixtures.test";

/** The blocks this file owns: everything between the spine rules and the clarifier rules. */
function planningSection(): string {
  const from = PLAN_SYSTEM.indexOf("the spine — decide this FIRST");
  const to = PLAN_SYSTEM.indexOf("clarifiers (ONLY when");
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return PLAN_SYSTEM.slice(from, to);
}

const HOOK_ID = "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a01";

function plan(over: Partial<PlanOutput> = {}): PlanOutput {
  return PlanOutputSchema.parse({
    title: "a cache is a bet on repetition",
    theme: SAMPLE_THEME_TERMINAL_NOIR,
    persona: {
      name: "ops",
      traits: ["on-call for a decade", "allergic to hand-waving", "dry as a log line"],
      tics: ["says 'here's the footgun'", "ends hard truths with 'anyway.'"],
      humor: "deadpan",
      neverDoes: "never says 'simply'",
    },
    outline: [
      { id: "n1", title: "the empty cache", estCards: 5, dependsOn: [], brief: "a restart takes the site down. assumes nothing — gloss ttl.", corpusHint: "## Stampedes" },
      { id: "n2", title: "the fix nobody ships", estCards: 4, dependsOn: ["n1"], brief: "coalescing: one miss goes to the db." },
    ],
    clarifiers: [],
    firstCards: [
      {
        id: HOOK_ID, type: "hook", topicNodeId: "n1", detourId: null,
        headline: "one process is holding your whole site up.",
        sub: "and it never touches your database.",
      },
      {
        id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a02", type: "stat", topicNodeId: "n1", detourId: null,
        value: "10x", label: "fewer db reads", context: "90% to 99% hit rate isn't 9% better.",
      },
      {
        id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a03", type: "concept", topicNodeId: "n1", detourId: null,
        headline: "a cache is a bet", body: "most requests ask for the same thing twice.",
      },
    ],
    ...over,
  });
}

describe("plan prompt: the outline is a story", () => {
  it("demands a story, not a list of topics", () => {
    const s = planningSection();
    expect(s).toMatch(/STORY, not a list/);
    expect(s).toMatch(/most surprising CONCRETE thing/);
    expect(s).toMatch(/every node earns the next one/);
    expect(s).toMatch(/end on the payoff/);
  });

  it("bans the front-loaded groundwork node", () => {
    const s = planningSection();
    expect(s).toMatch(/NEVER open with a groundwork node/);
    expect(s).toContain('"the basics"');
    expect(s).toMatch(/groundwork arrives at the moment it is needed/);
  });

  it("runs a prerequisites pass and makes the brief carry it", () => {
    const s = planningSection();
    expect(s).toMatch(/prerequisites pass/);
    expect(s).toMatch(/need to already have in their head/);
    expect(s).toMatch(/IMMEDIATELY BEFORE the node that needs it/);
    expect(s).toMatch(/glosses instead of assuming/);
    expect(s).toMatch(/dependsOn.+honest/s);
  });

  it("sizes nodes for the crossroads rhythm and says why", () => {
    const s = planningSection();
    expect(s).toMatch(/4–6 cards per node/);
    expect(s).toMatch(/keep going \/ go deeper \/ ask something \/ wrap up/);
    expect(s).toMatch(/stuck on this one thing forever/);
    expect(s).not.toMatch(/each node estCards 3–8/);
    // the sizing the prompt asks for has to be representable by the schema the orchestrator owns
    expect(OutlineNodeSchema.safeParse({ id: "n1", title: "t", estCards: 4, dependsOn: [] }).success).toBe(true);
    expect(OutlineNodeSchema.safeParse({ id: "n1", title: "t", estCards: 6, dependsOn: [] }).success).toBe(true);
  });

  it("tells the planner node titles are on screen, and must dodge school vocabulary the source uses", () => {
    const s = planningSection();
    expect(s).toMatch(/TITLE IS ON SCREEN/);
    expect(s).toMatch(/survive the banned-word rule even when the source's own name/);
  });

  it("gives the brief a shape that fits its cap", () => {
    const s = planningSection();
    expect(s).toMatch(/240 characters is about 35 words/);
    expect(s).toMatch(/FRAGMENTS, never prose/);
    expect(s).toMatch(/lands:.+assumes:.+concrete:/);
  });

  it("requires a spine, and ties it to the title and the opening hook", () => {
    const s = planningSection();
    expect(s).toMatch(/the spine — decide this FIRST/);
    expect(s).toMatch(/the argument, not the subject/);
    expect(s).toMatch(/≤ 280 chars/);
    expect(s).toContain('top-level "spine" string');
    expect(s).toMatch(/"title" \(≤ 60\) is the spine compressed to a claim/);
    expect(s).toMatch(/firstCards\[0\] \(the hook\) is the spine's sharpest/);
  });

  it("keeps the planner's own copy free of school vocabulary", () => {
    expect(findBannedWord(planningSection())).toBeNull();
  });

  it("stays byte-stable (prompt-cacheable) and orders the work in the user turn", () => {
    expect(buildPlanPrompt(planInput()).system).toBe(buildPlanPrompt(planInput({ sourceText: "other" })).system);
    const user = buildPlanPrompt(planInput()).user;
    expect(user).toMatch(/\(1\) the spine/);
    expect(user).toMatch(/\(2\) the outline as a story/);
    expect(user).toMatch(/prerequisites pass actually done/);
  });
});

describe("spineFromPlan", () => {
  it("reads a literal spine field when the schema grows one", () => {
    const p = { ...plan(), spine: "a cache is a bet on repetition, and every hard part is the bet going wrong." } as PlanOutput;
    expect(spineFromPlan(p)).toBe("a cache is a bet on repetition, and every hard part is the bet going wrong.");
  });

  it("falls back to the title plus the opening hook", () => {
    const s = spineFromPlan(plan());
    expect(s).toContain("a cache is a bet on repetition");
    expect(s).toContain("one process is holding your whole site up.");
    expect(s).toContain("and it never touches your database.");
  });

  it("always fits the storyline schema's cap, cut at a boundary not mid-word", () => {
    const long = plan({
      title: "x".repeat(60),
      firstCards: [
        { id: HOOK_ID, type: "hook", topicNodeId: "n1", detourId: null, headline: `${"alpha ".repeat(14)}omega`, sub: `${"beta ".repeat(20)}end` },
        ...plan().firstCards.slice(1),
      ] as PlanOutput["firstCards"],
    });
    const s = spineFromPlan(long);
    expect(s.length).toBeLessThanOrEqual(280);
    expect(s.endsWith(" ")).toBe(false);
    expect(s.split(" ").pop()).not.toBe("alph"); // no mid-word truncation
    expect(StorylineSchema.safeParse({ spine: s, covered: [], next: "", updatedAtIdx: null }).success).toBe(true);
  });

  it("survives a plan whose first card carries no sub, and never returns an empty spine", () => {
    const p = plan({
      firstCards: [
        { id: HOOK_ID, type: "hook", topicNodeId: "n1", detourId: null, headline: "the site fell over because a cache blinked" },
        ...plan().firstCards.slice(1),
      ] as PlanOutput["firstCards"],
    });
    expect(spineFromPlan(p)).toBe("a cache is a bet on repetition — the site fell over because a cache blinked");

    // no hook at all (the validator would have rejected it, but the helper still answers)
    const [, stat, concept] = plan().firstCards;
    const hookless = plan({ firstCards: [stat, concept, { ...concept, id: "3f2a1c9e-9b7d-4b1e-8f4a-1c2d3e4f5a04" }] as PlanOutput["firstCards"] });
    expect(spineFromPlan(hookless)).toBe("a cache is a bet on repetition");
  });
});
