import { describe, expect, it } from "vitest";
import { FrontierPublicSchema, GenerateData, SessionPublicSchema } from "@/lib/api/contract";
import { PersonaSchema } from "@/lib/schemas/plan";
import { SessionSchema } from "@/lib/schemas/session";
import { rowToSession } from "@/lib/db/supabase";
import { toPublic } from "@/lib/generation/public";

/**
 * The frontier and the two new persona fields are additive: every session written before they
 * existed is still sitting in the database, and must come back out without a word of complaint.
 */

/** A session row exactly as it was stored before any of this: no frontier, persona with 5 keys. */
const oldRow = {
  id: "9c1c7c1a-2f7f-4d5f-9d4a-9a5c1a2b3c4d",
  title: "how a cache keeps a site alive",
  source_kind: "sentence",
  source_meta: {},
  source_text: "how a cache keeps a site alive",
  theme: null,
  persona: {
    traits: ["blunt", "specific", "funny about outages"],
    tics: ["says 'here's the footgun'", "ends hard truths with 'anyway.'"],
    humor: "dry, never cute",
    neverDoes: "never says 'simply' about anything that paged someone",
    voiceSample: "the cache is where the problem becomes visible. anyway.",
  },
  outline: [{ id: "n1", title: "the stampede", estCards: 4, dependsOn: [] }],
  settings: { chillMode: false, depthPreset: "standard", soundOn: false },
  learner_state: {},
  progress: { nodeIdx: 1, cardsInNode: 2, totalGenerated: 6, lastIdx: "a3" },
  clarifier_answers: {},
  storyline: null,
  status: "active",
  error: null,
  position: 3,
  created_at: "2026-08-16T10:00:00+00:00",
  last_opened_at: "2026-08-16T11:00:00+00:00",
};

describe("old rows survive the frontier + persona additions", () => {
  it("a stored session with no frontier and a 5-key persona still parses, all the way to the wire", () => {
    const session = SessionSchema.parse(rowToSession(oldRow));
    expect(session.persona?.analogyWorld).toBeUndefined();
    expect(session.persona?.sampleCard).toBeUndefined();

    const publicShape = SessionPublicSchema.parse(toPublic(session, 6));
    expect(publicShape.frontier ?? null).toBeNull();
    expect("sourceText" in publicShape).toBe(false);
  });

  it("an explicit null frontier parses too — 'we didn't count it' is a legal answer", () => {
    const base = SessionPublicSchema.parse(toPublic(SessionSchema.parse(rowToSession(oldRow)), 6));
    expect(SessionPublicSchema.parse({ ...base, frontier: null }).frontier).toBeNull();
    expect(GenerateData.parse({ batch: { id: "b1", status: "done", frontierKey: "k" }, cards: [] }).frontier ?? null).toBeNull();
  });

  it("a persona that carries the new fields parses, and holds them to the card's own caps", () => {
    const persona = PersonaSchema.parse({
      ...oldRow.persona,
      analogyWorld: "a restaurant kitchen at 8pm",
      sampleCard: { headline: "the queue is the kitchen", body: "orders don't slow down because the kitchen is busy. they pile up." },
    });
    expect(persona.analogyWorld).toBe("a restaurant kitchen at 8pm");
    expect(persona.sampleCard?.headline).toBe("the queue is the kitchen");
    expect(PersonaSchema.safeParse({ ...persona, analogyWorld: "x".repeat(61) }).success).toBe(false);
    expect(PersonaSchema.safeParse({ ...persona, sampleCard: { headline: "h", body: "b".repeat(321) } }).success).toBe(false);
  });

  it("a fully counted frontier round-trips, and a bare one fills itself in", () => {
    const counted = FrontierPublicSchema.parse({
      written: { n1: 5, n2: 2 },
      beyond: 0,
      nodeIdx: 1,
      deeper: { n1: 3 },
      closed: ["n1"],
      gate: "crossroads",
      live: { nodeIdx: 1, startedAt: "2026-08-16T11:00:00.000Z" },
      epoch: 2,
      halted: false,
    });
    expect(counted.closed).toEqual(["n1"]);
    expect(counted.gate).toBe("crossroads");
    expect(counted.live?.nodeIdx).toBe(1);

    expect(FrontierPublicSchema.parse({})).toEqual({
      written: {}, beyond: 0, nodeIdx: 0, deeper: {}, closed: [], gate: null, live: null, epoch: 0, halted: false,
    });
    expect(FrontierPublicSchema.safeParse({ gate: "wrap" }).success).toBe(true);
    expect(FrontierPublicSchema.safeParse({ gate: "later" }).success).toBe(false);
  });
});
