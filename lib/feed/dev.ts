import { generateNKeysBetween } from "fractional-indexing";
import type { SessionPublic } from "@/lib/api/contract";
import { SAMPLE_CARDS } from "@/lib/sample/cards";
import { defaultLearnerState } from "@/lib/schemas/learner";
import type { CardRow } from "@/lib/schemas/session";
import type { Theme } from "@/lib/schemas/theme";

/** Static fixtures for /dev/cards (no network): SAMPLE_CARDS as rows + a fake active session. */
export const DEV_SESSION_ID = "00000000-0000-4000-8000-00000000dead";

export function sampleRows(sessionId = DEV_SESSION_ID): CardRow[] {
  const keys = generateNKeysBetween(null, null, SAMPLE_CARDS.length);
  const now = "2026-01-01T00:00:00.000Z";
  return SAMPLE_CARDS.map((card, i) => ({
    id: card.id,
    sessionId,
    idx: keys[i],
    type: card.type,
    payload: card,
    detourId: card.detourId,
    batchId: null,
    viewedAt: null,
    interaction: null,
    createdAt: now,
  }));
}

export function devSession(theme: Theme, title = "how a cache keeps a site alive"): SessionPublic {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: DEV_SESSION_ID,
    title,
    sourceKind: "sentence",
    sourceMeta: {},
    theme,
    persona: null,
    outline: [{ id: "n1", title: "caching", estCards: 8, dependsOn: [] }],
    settings: { chillMode: false, depthPreset: "standard", soundOn: false },
    learnerState: defaultLearnerState(),
    progress: { nodeIdx: 0, cardsInNode: 0, totalGenerated: SAMPLE_CARDS.length, exhausted: false, extensions: 0, lastIdx: null, epoch: 0, pendingReplan: false },
    clarifierAnswers: {},
    status: "active",
    error: null,
    position: 0,
    createdAt: now,
    lastOpenedAt: now,
    sourceChars: 0,
    cardCount: SAMPLE_CARDS.length,
  };
}
