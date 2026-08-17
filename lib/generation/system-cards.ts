import type { Card, DetourMarkerCard, FallbackCard, NoticeCard } from "@/lib/schemas/cards";
import { uuid } from "@/lib/id";

/**
 * Server-made cards that never come from the writer: notices, fallbacks,
 * detour markers. Copy obeys the Prime Directive (lowercase, feed-native, no
 * school vocabulary) and never leaks internal errors.
 */

export const SYSTEM_NODE = "system";

export function budgetNotice(): NoticeCard {
  return {
    id: uuid(),
    type: "notice",
    topicNodeId: SYSTEM_NODE,
    detourId: null,
    kind: "budget",
    headline: "we hit today's budget.",
    body: "resets at midnight. go touch grass, legend.",
  };
}

export function fallbackCard(reason: string, retryKey?: string): FallbackCard {
  return {
    id: uuid(),
    type: "fallback",
    topicNodeId: SYSTEM_NODE,
    detourId: null,
    reason: reason.slice(0, 200),
    retryable: true,
    retryKey,
  };
}

export function detourMarkers(detourId: string, topicNodeId: string, question: string): { open: DetourMarkerCard; close: DetourMarkerCard } {
  return {
    open: {
      id: uuid(),
      type: "detour_marker",
      topicNodeId,
      detourId,
      kind: "open",
      question: question.slice(0, 140),
      label: "detour: your question",
    },
    close: {
      id: uuid(),
      type: "detour_marker",
      topicNodeId,
      detourId,
      kind: "close",
      label: "back to the main thread",
    },
  };
}

export const isBudgetNotice = (c: Card): c is NoticeCard => c.type === "notice" && c.kind === "budget";
export const isFallback = (c: Card): c is FallbackCard => c.type === "fallback";
