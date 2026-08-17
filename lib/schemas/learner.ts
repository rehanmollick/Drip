import { z } from "zod";

export const LEARNER_STATE_VERSION = 1;

export const DepthPreset = z.enum(["skim", "standard", "deep"]);
export type DepthPreset = z.infer<typeof DepthPreset>;

export const SessionSettingsSchema = z.object({
  chillMode: z.boolean().default(false),
  depthPreset: DepthPreset.default("standard"),
  soundOn: z.boolean().default(false),
});
export type SessionSettings = z.infer<typeof SessionSettingsSchema>;

export const LearnerStateSchema = z.object({
  version: z.number().int().default(LEARNER_STATE_VERSION),
  globalLevel: z.number().int().min(1).max(5).default(3),
  perNode: z.record(z.string(), z.object({
    level: z.number().int().min(1).max(5),
    attempts: z.number().int(),
    hits: z.number().int(),
    lastMissConcepts: z.array(z.string()),
    consecutiveMisses: z.number().int().default(0),
  })).default({}),
  rolling: z.object({
    last10Interactive: z.array(z.boolean()).default([]),   // most recent last; hits/attempts derived
    dwellMs: z.array(z.number()).default([]),               // last N non-interactive dwells
    avgDwellMs: z.number().default(0),
  }).default({ last10Interactive: [], dwellMs: [], avgDwellMs: 0 }),
  prefs: z.object({
    chillMode: z.boolean().default(false),
    depthPreset: DepthPreset.default("standard"),
    simplerTaps: z.number().int().default(0),
    deeperTaps: z.number().int().default(0),
  }).default({ chillMode: false, depthPreset: "standard", simplerTaps: 0, deeperTaps: 0 }),
  /** Directives derived from the state, recomputed on every write; passed verbatim to the writer. */
  directives: z.object({
    difficultyDelta: z.number().int().min(-2).max(2).default(0),
    pace: z.enum(["normal", "compress"]).default("normal"),
    scaffoldNext: z.array(z.string()).default([]),   // concepts needing a re-angle before the next interactive
    recapDue: z.string().nullable().default(null),   // nodeId/concept needing a recap card
    reinforce: z.array(z.string()).default([]),      // concepts asked about in detours
  }).default({ difficultyDelta: 0, pace: "normal", scaffoldNext: [], recapDue: null, reinforce: [] }),
});
export type LearnerState = z.infer<typeof LearnerStateSchema>;

export function defaultLearnerState(settings?: Partial<SessionSettings>): LearnerState {
  return LearnerStateSchema.parse({
    version: LEARNER_STATE_VERSION,
    prefs: { chillMode: settings?.chillMode ?? false, depthPreset: settings?.depthPreset ?? "standard" },
  });
}
