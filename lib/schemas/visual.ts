import { z } from "zod";

/**
 * VisualSpec — the ONLY visual treatments the AI may request on hook/concept/
 * checkpoint cards. No image URLs, no generated images, no markup. The renderer
 * (components/cards/Visual.tsx) knows how to draw exactly these.
 */
export const ICON_NAMES = [
  "bolt", "shield", "cpu", "database", "cloud", "lock", "key", "wave", "leaf",
  "flask", "dna", "brain", "globe", "rocket", "clock", "chart", "code", "branch",
  "server", "network", "fire", "drop", "sun", "moon", "star", "heart", "eye",
  "book", "pen", "mic", "map", "compass", "anchor", "gear", "puzzle", "layers",
  "box", "link", "tag", "flag", "target", "trophy", "warning", "question",
  "check", "x", "arrow", "loop", "scale", "coin", "atom", "wrench", "bug",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const VisualSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("icon"), icon: z.enum(ICON_NAMES) }),
  z.object({
    kind: z.literal("stat"),
    value: z.string().max(12),           // "80%", "3ms", "1.2M"
    label: z.string().max(40),
  }),
  z.object({
    kind: z.literal("ascii"),
    lines: z.array(z.string().max(32)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("spark"),
    values: z.array(z.number()).min(3).max(24),
    label: z.string().max(40).optional(),
  }),
]);
export type VisualSpec = z.infer<typeof VisualSpec>;
