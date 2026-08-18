import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findBannedWord } from "@/lib/copy/banned";

/**
 * ONE real planning call against the live model — opt-in, never in CI.
 *
 *   DRIP_LIVE_PLAN=1 pnpm exec vitest run tests/plan.live.test.ts
 *
 * Everything else about planning is covered by tests/plan.prompt.test.ts (the
 * prompt) and tests/corpus.slice.test.ts (the grounding). This one answers the
 * question no unit test can: does a real plan come back as a STORY — surprise
 * first, prerequisites next to what needs them, 4–6 cards a node, a spine you
 * could say out loud — instead of a table of contents.
 */
const LIVE = process.env.DRIP_LIVE_PLAN === "1";

/** .env.local, loaded here (vitest doesn't) and only when the gate is open. */
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

const SOURCE = `# Sourdough, honestly

A sourdough starter is a jar of flour and water that has been colonised by wild yeast and lactic acid bacteria. You do not add either of them. They are already on the flour, on your hands, in the air of your kitchen. You just give them a place to live and a feeding schedule.

## What the bugs are doing

The yeast eats sugars released by enzymes in the flour and gives off carbon dioxide, which is what lifts the loaf. The bacteria eat some of the same sugars and give off lactic and acetic acid, which is what makes it taste sour and what keeps mould out. The two populations are not enemies. The acid the bacteria produce makes the jar too hostile for most other microbes, and the yeast is one of the few that tolerates it. That partnership is why a starter can sit on a counter for decades without spoiling, as long as it is fed.

## Feeding, and why people get it wrong

Feeding is refreshing: you throw most of the starter away and top up what is left with fresh flour and water. Beginners hate the discard step and skip it. Then the jar fills with acid and alcohol faster than the yeast can work, the population crashes, and the starter goes grey and smells like nail polish remover. The discard is not waste, it is population control.

Temperature does most of the work people credit to skill. At 21C a starter takes about 8 hours to peak. At 27C it takes half that. A recipe that says "feed twice a day" is a recipe written for one kitchen.

## The float test lies

Everyone teaches the float test: drop a spoon of starter in water and if it floats, it is ready. A stiff starter that is nowhere near peak will float on trapped air, and a very wet one that is perfectly ripe will sink. What actually matters is rise time: the starter should roughly double and then just begin to dome and pull away from the sides of the jar. Watch the jar, not the water.

## Why the first loaf is bad

The first loaf almost always disappoints, and it is not usually the starter. It is that a young starter is bacteria-heavy and yeast-light, so it is sour and weak. It takes two or three weeks of steady feeding at a steady temperature for the yeast population to catch up. Nothing about your technique changes in that time. The jar does.

## Retarding

Cold slows the yeast much more than it slows the bacteria. That is the whole trick behind putting shaped dough in the fridge overnight: the loaf keeps developing flavour from the acid while barely rising, so you get a sour, open crumb instead of a fast, bland, over-proofed one.`;

describe.skipIf(!LIVE)("live plan (one real call)", () => {
  it("comes back as a story: surprise first, 4–6 cards a node, a spine you can say out loud", { timeout: 180_000 }, async () => {
    loadEnvLocal();
    process.env.DRIP_STORE = "local";
    process.env.DRIP_DATA_DIR = process.env.DRIP_DATA_DIR ?? ".data/plan-live";
    delete process.env.LLM_MODE;
    expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY missing").toBeTruthy();

    const { llm } = await import("@/lib/llm");
    const { spineFromPlan } = await import("@/lib/prompts/plan");
    const res = await llm.plan({
      sessionId: "11111111-2222-4333-8444-555555555555",
      sourceKind: "paste",
      sourceText: SOURCE,
      sourceMeta: {},
      settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    });
    if (!res.ok) throw new Error(`plan failed: ${res.code} ${res.error}`);
    const plan = res.value;
    console.log(JSON.stringify({ ...plan, spine: spineFromPlan(plan) }, null, 2));

    // shape
    expect(plan.outline.length).toBeGreaterThanOrEqual(5);
    expect(plan.outline.length).toBeLessThanOrEqual(8);
    for (const n of plan.outline) {
      expect(n.estCards, `${n.id} estCards`).toBeGreaterThanOrEqual(4);
      expect(n.estCards, `${n.id} estCards`).toBeLessThanOrEqual(6);
      expect(n.brief, `${n.id} brief`).toBeTruthy();
      expect(n.brief!.length, `${n.id} brief was clamped mid-word`).toBeLessThan(240);
      // KNOWN GAP: node titles now render (timeline + crossroads) but lib/llm.ts's
      // PLAN_ON_SCREEN is ["title","clarifiers","firstCards"], so the outline is never
      // banned-word checked or scrubbed. A source that names something "the float test"
      // walks straight onto the screen. The prompt asks the planner to angle around it;
      // the real fix is adding "outline" to PLAN_ON_SCREEN (lib/llm.ts, not this package).
      expect(findBannedWord(n.title), `${n.id} title`).toBeNull();
      expect(n.title).toBe(n.title.toLowerCase());
    }

    // dependencies sit next to what needs them, never five nodes back
    const at = new Map(plan.outline.map((n, i) => [n.id, i]));
    for (const n of plan.outline) {
      for (const dep of n.dependsOn) {
        const d = at.get(dep);
        if (d === undefined) continue;
        expect(d, `${n.id} depends on ${dep} which comes later`).toBeLessThan(at.get(n.id)!);
      }
    }

    // no front-loaded groundwork node
    expect(plan.outline[0].title).not.toMatch(/^(the )?(basics|background|intro|introduction|overview|history|key terms|terminology|fundamentals)\b/);

    // the openers are not a title screen plus two paragraphs
    expect(plan.firstCards[0].type).toBe("hook");
    const rest = plan.firstCards.slice(1).map((c) => c.type);
    expect(rest.filter((t) => t === "concept").length).toBeLessThanOrEqual(1);

    // the spine survives the round trip
    const spine = spineFromPlan(plan);
    expect(spine.length).toBeGreaterThan(20);
    expect(spine.length).toBeLessThanOrEqual(280);
    expect(findBannedWord(spine)).toBeNull();
  });
});
