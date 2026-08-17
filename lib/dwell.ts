/**
 * DwellClock — how long a card was actually on screen (spec §8).
 *
 *   start(cardId) → ... → stop(): ms
 *
 * Integrity rules: pauses while the document is hidden (visibilitychange) or
 * on pagehide, resumes on visible/pageshow, and hard-caps any single dwell at
 * 60s. Without this, locking the phone mid-card records a 40-minute dwell and
 * the adaptation engine wrongly concludes catastrophic confusion.
 *
 * Pure-ish: `now` and the event targets are injectable so it unit-tests with
 * fake timers and no DOM.
 */
export const DWELL_CAP_MS = 60_000;

type Listenable = {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
};
type DocLike = Listenable & { visibilityState?: string };

export class DwellClock {
  private cardId: string | null = null;
  private acc = 0;
  private runningSince: number | null = null;
  private hidden = false;
  private readonly now: () => number;
  private detachFns: Array<() => void> = [];

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Currently timed card id (null when idle). */
  get current(): string | null {
    return this.cardId;
  }

  /** Listen for hide/show on the given document/window (defaults to the globals). Idempotent. */
  attach(doc: DocLike | null = typeof document === "undefined" ? null : document, win: Listenable | null = typeof window === "undefined" ? null : window): void {
    this.detach();
    if (doc) {
      const onVis = () => (doc.visibilityState === "hidden" ? this.pause() : this.resume());
      doc.addEventListener("visibilitychange", onVis);
      this.detachFns.push(() => doc.removeEventListener("visibilitychange", onVis));
      if (doc.visibilityState === "hidden") this.hidden = true;
    }
    if (win) {
      const onHide = () => this.pause();
      const onShow = () => this.resume();
      win.addEventListener("pagehide", onHide);
      win.addEventListener("pageshow", onShow);
      this.detachFns.push(() => win.removeEventListener("pagehide", onHide), () => win.removeEventListener("pageshow", onShow));
    }
  }

  detach(): void {
    for (const f of this.detachFns) f();
    this.detachFns = [];
  }

  /** Begin timing `cardId` (any running dwell is discarded — call stop() first to read it). */
  start(cardId: string): void {
    this.cardId = cardId;
    this.acc = 0;
    this.runningSince = this.hidden ? null : this.now();
  }

  /** Elapsed visible ms so far, capped. Does not stop the clock. */
  elapsed(): number {
    const live = this.runningSince === null ? 0 : this.now() - this.runningSince;
    return Math.min(DWELL_CAP_MS, Math.max(0, this.acc + live));
  }

  /** Stop and return the dwell (ms, capped at 60s). Returns 0 if nothing was started. */
  stop(): number {
    if (this.cardId === null) return 0;
    const ms = this.elapsed();
    this.cardId = null;
    this.acc = 0;
    this.runningSince = null;
    return ms;
  }

  /** Document hidden / page hidden: freeze the clock. */
  pause(): void {
    if (this.hidden) return;
    this.hidden = true;
    if (this.runningSince !== null) {
      this.acc += this.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  /** Back on screen: resume timing the current card. */
  resume(): void {
    if (!this.hidden) return;
    this.hidden = false;
    if (this.cardId !== null && this.runningSince === null) this.runningSince = this.now();
  }
}
