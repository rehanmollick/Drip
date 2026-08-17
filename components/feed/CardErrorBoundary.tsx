"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The feed cannot crash on content. Any card view that throws is swapped for
 * the fallback (a themed `fallback` card view); if THAT throws too, an outer
 * boundary renders a plain themed line. Two nested boundaries because a
 * boundary cannot catch an error thrown by its own fallback UI.
 */
type Props = { children: ReactNode; fallback: ReactNode; resetKey?: string };
type State = { failed: boolean; forKey?: string };

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A different card under the same boundary slot → give it a fresh chance.
    if (state.failed && state.forKey !== undefined && state.forKey !== props.resetKey) return { failed: false, forKey: props.resetKey };
    if (state.forKey !== props.resetKey) return { forKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") console.error("[feed] card view threw", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Last-resort fallback: no card view involved at all. */
export function PlainPothole() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <p className="font-display text-2xl text-ink text-balance">hit a pothole.</p>
      <p className="mt-2 font-body text-sm text-ink-2">keep scrolling — the next one&apos;s fine.</p>
    </div>
  );
}

/** Children → themed fallback card view → plain line. */
export function SafeCard({ children, fallbackView, resetKey }: { children: ReactNode; fallbackView: ReactNode; resetKey: string }) {
  return (
    <CardErrorBoundary fallback={<PlainPothole />} resetKey={resetKey}>
      <CardErrorBoundary fallback={fallbackView} resetKey={resetKey}>
        {children}
      </CardErrorBoundary>
    </CardErrorBoundary>
  );
}
