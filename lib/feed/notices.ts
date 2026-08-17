import type { NoticeCard } from "@/lib/schemas/cards";
import type { Slide } from "@/components/cards/types";

/**
 * Client-side pseudo notices (spec §6.2 / §12). Themed cards, never spinners,
 * never error strings. Ids are fixed so the slides keep stable keys.
 */
export type PseudoKind = "planning" | "replanning" | "catching_up" | "offline" | "error";

const IDS: Record<PseudoKind, string> = {
  planning: "00000000-0000-4000-8000-000000000001",
  replanning: "00000000-0000-4000-8000-000000000005",
  catching_up: "00000000-0000-4000-8000-000000000002",
  offline: "00000000-0000-4000-8000-000000000003",
  error: "00000000-0000-4000-8000-000000000004",
};

const COPY: Record<PseudoKind, { headline: string; body: string; eyebrow: string }> = {
  planning: { eyebrow: "one sec", headline: "reading your stuff…", body: "first cards drop in a moment. no second wait after this one." },
  replanning: { eyebrow: "got it", headline: "shaping your feed…", body: "bending the rest of this around your answer. one beat." },
  catching_up: { eyebrow: "hold on", headline: "catching up…", body: "the next bit is on its way. keep your thumb warm." },
  offline: { eyebrow: "offline", headline: "back online soon.", body: "the rest lands the moment you’re back." },
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
    kind: kind === "replanning" ? "planning" : kind,
    headline: c.headline,
    body: c.body,
  };
}

export function pseudoSlide(kind: PseudoKind): Slide {
  return { kind: "pseudo", key: `pseudo:${kind}`, card: makeNotice(kind) };
}
