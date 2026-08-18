import { z } from "zod";

/**
 * v2: the state stopped being a pile of counters and started being a memory.
 *
 * `ability` is a running read of how they're actually doing; `level` is the one number the writer
 * is handed, and it only moves when ability has genuinely drifted (`levelSetAt` is how we stop it
 * yo-yoing card to card). That pair replaces `directives.difficultyDelta`, which added a second
 * number to the same job and let level and delta disagree.
 *
 * `ledger` is the new part: what they've MET, keyed by the `anchor` a card carried. Without it the
 * writer only ever knew the last six cards, so an idea nailed 30 slides ago got re-taught and an
 * idea missed 30 slides ago was never called back.
 *
 * Additive JSONB — old blobs parse straight through and pick up defaults, so there is no migration.
 */
export const LEARNER_STATE_VERSION = 2;

/** How many anchors we carry. Past this the oldest fall off: the writer can't read a wall either. */
export const LEDGER_CAP = 40;

export const DepthPreset = z.enum(["skim", "standard", "deep"]);
export type DepthPreset = z.infer<typeof DepthPreset>;

export const SessionSettingsSchema = z.object({
  chillMode: z.boolean().default(false),
  depthPreset: DepthPreset.default("standard"),
  soundOn: z.boolean().default(false),
});
export type SessionSettings = z.infer<typeof SessionSettingsSchema>;

/**
 * One idea, as the reader has met it. `anchor` is the slug the writer put on the cards; `label` is
 * the same idea in words, because that is what a prompt can actually use.
 */
export const LedgerEntry = z.object({
  anchor: z.string().max(40),
  label: z.string().max(48),
  taught: z.number().int().default(0),      // cards that explained it
  hits: z.number().int().default(0),
  misses: z.number().int().default(0),
  lastSeenAt: z.number().int().default(0),  // epoch ms of the most recent touch
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const LearnerStateSchema = z.object({
  version: z.number().int().default(LEARNER_STATE_VERSION),
  /** What the reader asked for with the dial. Their stated preference, not a measurement. */
  globalLevel: z.number().int().min(1).max(5).default(3),
  /** What their answers say, on the same 1..5 scale but continuous — it drifts, it doesn't step. */
  ability: z.number().min(1).max(5).default(3),
  /** Scored answers that have fed `ability`. Below a handful it's still mostly the starting guess. */
  abilityItems: z.number().int().min(0).default(0),
  /** The number the writer is handed. Moves only when ability has drifted far enough to mean it. */
  level: z.number().int().min(1).max(5).default(3),
  /** Epoch ms of the last `level` move — the thing that keeps it from yo-yoing. */
  levelSetAt: z.number().int().default(0),
  perNode: z.record(z.string(), z.object({
    attempts: z.number().int(),
    hits: z.number().int(),
    lastMissConcepts: z.array(z.string()),
    consecutiveMisses: z.number().int().default(0),
  })).default({}),
  /** Ideas they've met, newest last. Capped at LEDGER_CAP. */
  ledger: z.array(LedgerEntry).max(LEDGER_CAP).default([]),
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
    pace: z.enum(["normal", "compress"]).default("normal"),
    scaffoldNext: z.array(z.string()).default([]),   // concepts needing a re-angle before the next interactive
    recapDue: z.string().nullable().default(null),   // nodeId/concept needing a recap card
    reinforce: z.array(z.string()).default([]),      // concepts asked about in detours
    /** Anchors owed a callback — an idea they met and haven't been asked about since. Two, tops. */
    due: z.array(z.string().max(40)).max(2).default([]),
  }).default({ pace: "normal", scaffoldNext: [], recapDue: null, reinforce: [], due: [] }),
});
export type LearnerState = z.infer<typeof LearnerStateSchema>;

export function defaultLearnerState(settings?: Partial<SessionSettings>): LearnerState {
  return LearnerStateSchema.parse({
    version: LEARNER_STATE_VERSION,
    prefs: { chillMode: settings?.chillMode ?? false, depthPreset: settings?.depthPreset ?? "standard" },
  });
}
