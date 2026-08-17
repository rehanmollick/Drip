import type { NoticeCard } from "@/lib/schemas/cards";
import type { Slide } from "@/components/cards/types";

/**
 * Client-side pseudo notices (spec §6.2 / §12). Themed cards, never spinners,
 * never error strings. Ids are fixed so the slides keep stable keys.
 */
export type PseudoKind = "planning" | "catching_up" | "offline" | "error";

const IDS: Record<PseudoKind, string> = {
  planning: "00000000-0000-4000-8000-000000000001",
  catching_up: "00000000-0000-4000-8000-000000000002",
  offline: "00000000-0000-4000-8000-000000000003",
  error: "00000000-0000-4000-8000-000000000004",
};

const COPY: Record<PseudoKind, { headline: string; body: string; eyebrow: string }> = {
  planning: { eyebrow: "one sec", headline: "reading your stuff…", body: "first cards drop in a moment. no second wait after this one." },
  catching_up: { eyebrow: "hold on", headline: "catching up…", body: "the next bit is on its way. keep your thumb warm." },
  offline: { eyebrow: "offline", headline: "back online soon.", body: "everything you've already seen still works. the rest lands when you're back." },
  error: { eyebrow: "hm", headline: "that one didn't stick.", body: "tap to try again." },
};

export function makeNotice(kind: PseudoKind): NoticeCard {
  const c = COPY[kind];
  return {
    id: IDS[kind],
    type: "notice",
    topicNodeId: "system",
    detourId: null,
    eyebrow: c.eyebrow,
    kind,
    headline: c.headline,
    body: c.body,
  };
}

export function pseudoSlide(kind: PseudoKind): Slide {
  return { kind: "pseudo", key: `pseudo:${kind}`, card: makeNotice(kind) };
}
