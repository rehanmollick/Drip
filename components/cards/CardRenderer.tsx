"use client";
import { Component, type ReactNode } from "react";
import type {
  BinaryCard, CheckpointCard, ClarifyCard, CodeCard, ConceptCard, CrossroadsCard, DetourMarkerCard, DiagramCard,
  FallbackCard, HookCard, NoticeCard, OpenCard, PredictCard, RecapCard, RevealCard, SequenceCard, SliderCard,
  StatCard, WrapCard,
} from "@/lib/schemas/cards";
import type { CardViewProps } from "./types";
import { HookView } from "./HookCard";
import { ConceptView } from "./ConceptCard";
import { CodeView } from "./CodeCard";
import { DiagramView } from "./DiagramCard";
import { BinaryView } from "./BinaryCard";
import { PredictView, PredictRevealView } from "./PredictCard";
import { SequenceView } from "./SequenceCard";
import { SliderView } from "./SliderCard";
import { RevealView } from "./RevealCard";
import { CheckpointView } from "./CheckpointCard";
import { DetourMarkerView } from "./DetourMarkerCard";
import { RecapView } from "./RecapCard";
import { FallbackView } from "./FallbackCard";
import { NoticeView } from "./NoticeCard";
import { ClarifyView } from "./ClarifyCard";
import { StatView } from "./StatCard";
import { OpenView } from "./OpenCard";
import { CrossroadsView } from "./CrossroadsCard";
import { WrapView } from "./WrapCard";

export { PredictRevealView };
export type { CardViewProps, InteractResult, Slide } from "./types";

/**
 * CardView — the ONE switch from validated card JSON to a view. Unknown or
 * malformed cards render the fallback view; a view that throws is caught by an
 * error boundary and ALSO renders the fallback. The feed can never crash on
 * content.
 */
export function CardView(props: CardViewProps) {
  return (
    <CardErrorBoundary fallback={<FallbackView {...(props as CardViewProps<FallbackCard>)} />} resetKey={props.card?.id}>
      <CardSwitch {...props} />
    </CardErrorBoundary>
  );
}

function CardSwitch(props: CardViewProps) {
  const card = props.card;
  switch (card?.type) {
    case "hook": return <HookView {...(props as CardViewProps<HookCard>)} />;
    case "concept": return <ConceptView {...(props as CardViewProps<ConceptCard>)} />;
    case "code": return <CodeView {...(props as CardViewProps<CodeCard>)} />;
    case "diagram": return <DiagramView {...(props as CardViewProps<DiagramCard>)} />;
    case "binary": return <BinaryView {...(props as CardViewProps<BinaryCard>)} />;
    case "predict": return <PredictView {...(props as CardViewProps<PredictCard>)} />;
    case "sequence": return <SequenceView {...(props as CardViewProps<SequenceCard>)} />;
    case "slider": return <SliderView {...(props as CardViewProps<SliderCard>)} />;
    case "reveal": return <RevealView {...(props as CardViewProps<RevealCard>)} />;
    case "checkpoint": return <CheckpointView {...(props as CardViewProps<CheckpointCard>)} />;
    case "detour_marker": return <DetourMarkerView {...(props as CardViewProps<DetourMarkerCard>)} />;
    case "recap": return <RecapView {...(props as CardViewProps<RecapCard>)} />;
    case "notice": return <NoticeView {...(props as CardViewProps<NoticeCard>)} />;
    case "clarify": return <ClarifyView {...(props as CardViewProps<ClarifyCard>)} />;
    case "stat": return <StatView {...(props as CardViewProps<StatCard>)} />;
    case "open": return <OpenView {...(props as CardViewProps<OpenCard>)} />;
    case "crossroads": return <CrossroadsView {...(props as CardViewProps<CrossroadsCard>)} />;
    case "wrap": return <WrapView {...(props as CardViewProps<WrapCard>)} />;
    case "fallback":
    default:
      return <FallbackView {...(props as CardViewProps<FallbackCard>)} />;
  }
}

class CardErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetKey?: string }, { failed: boolean; key?: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    // a different card under the same boundary → try rendering again
    if (props.resetKey !== state.key) return { failed: false, key: props.resetKey };
    return null;
  }
  componentDidCatch(err: unknown) {
    if (typeof console !== "undefined") console.error("[drip] card render failed → fallback", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
