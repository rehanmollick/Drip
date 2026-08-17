"use client";
import { memo, useEffect, useRef, type ReactNode } from "react";
import type { Slide } from "@/components/cards/types";
import { CardView, PredictRevealView } from "@/components/cards/CardRenderer";
import type { InteractResult } from "@/components/cards/types";
import type { FallbackCard } from "@/lib/schemas/cards";
import type { Interaction } from "@/lib/schemas/session";
import { SafeCard } from "./CardErrorBoundary";

const FALLBACK: FallbackCard = {
  id: "00000000-0000-4000-8000-0000000000fb",
  type: "fallback",
  topicNodeId: "system",
  detourId: null,
  reason: "card view threw",
  retryable: false,
};

export type SlideHandlers = {
  onInteract?: (r: InteractResult) => void;
  onDial?: (dir: "simpler" | "deeper") => void;
  onAskAbout?: () => void;
  onRetry?: () => void;
  onAction?: () => void;
};

/**
 * One viewport-height snap unit. Registers itself with the feed's
 * IntersectionObserver; content is windowed by the parent (`mounted`) so a
 * 300-card session keeps a light DOM. `entered` is sticky (set once) so the
 * card view's stagger never replays.
 */
export const FeedSlide = memo(function FeedSlide({
  slide,
  observe,
  mounted,
  entered,
  active,
  interaction,
  streak,
  handlers,
  overlay,
}: {
  slide: Slide;
  observe: (el: HTMLElement | null, key: string) => void;
  mounted: boolean;
  entered: boolean;
  active: boolean;
  interaction?: Interaction | null;
  streak?: number;
  handlers?: SlideHandlers;
  overlay?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    observe(el, slide.key);
    return () => observe(null, slide.key);
  }, [observe, slide.key]);

  const detour = slide.kind !== "pseudo" && slide.card.detourId !== null && slide.card.type !== "detour_marker";

  return (
    <section
      ref={ref}
      className="card"
      data-slide-key={slide.key}
      data-slide-kind={slide.kind}
      data-card-type={slide.card.type}
      style={detour ? { boxShadow: "inset 3px 0 0 0 var(--accent)" } : undefined}
    >
      {mounted && (
        <div className="relative z-[1] flex h-full w-full flex-col" style={{ paddingTop: "max(env(safe-area-inset-top), 16px)", paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 72px)" }}>
          <SafeCard resetKey={slide.key} fallbackView={<CardView card={FALLBACK} entered active={active} />}>
            {slide.kind === "predict_reveal" ? (
              <PredictRevealView card={slide.card} interaction={interaction ?? null} entered={entered} />
            ) : (
              <CardView
                card={slide.card}
                entered={entered}
                active={active}
                interaction={interaction ?? null}
                onInteract={handlers?.onInteract}
                onDial={handlers?.onDial}
                onAskAbout={handlers?.onAskAbout}
                onRetry={handlers?.onRetry}
                onAction={handlers?.onAction}
                streak={streak}
              />
            )}
          </SafeCard>
        </div>
      )}
      {overlay}
    </section>
  );
});
