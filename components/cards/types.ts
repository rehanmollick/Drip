import type { Card, PredictCard } from "@/lib/schemas/cards";
import type { Interaction } from "@/lib/schemas/session";

/**
 * Props contract between the feed (components/feed) and card views
 * (components/cards). The feed owns scroll/visibility/persistence; card views
 * own presentation + local interaction state and report results upward.
 */
export type InteractResult = {
  choice?: number | string | string[];
  correct?: boolean;
  value?: number;          // slider
};

export type CardViewProps<T extends Card = Card> = {
  card: T;
  /** Card crossed 60% visibility at least once → play the entry stagger ONCE (never replays on scroll-back). */
  entered: boolean;
  /** Currently the snapped card. */
  active: boolean;
  /** Previously recorded interaction (replay state; interactive cards render as already-answered). */
  interaction?: Interaction | null;
  onInteract?: (r: InteractResult) => void;
  /** 🧒 simpler / 🎓 deeper ghosts (concept + diagram cards). */
  onDial?: (dir: "simpler" | "deeper") => void;
  /** Long-press → "ask about this". */
  onAskAbout?: () => void;
  /** fallback card retry affordance. */
  onRetry?: () => void;
  /** notice(kind=error/planning) retry, or "adjacent waters" accept. */
  onAction?: () => void;
  /** streak shown on checkpoint cards. */
  streak?: number;
};

/**
 * A slide is one viewport-height unit. Most cards are one slide; `predict`
 * expands into two (question, then reveal on the NEXT slide).
 */
export type Slide =
  | { kind: "card"; key: string; card: Card; rowId: string; idx: string }
  | { kind: "predict_reveal"; key: string; card: PredictCard; rowId: string; idx: string }
  | { kind: "pseudo"; key: string; card: Card };   // client-only: catching_up / offline / planning notices
