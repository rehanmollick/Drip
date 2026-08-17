/**
 * Optional, very quiet Web Audio ticks (spec §5). iOS Safari has no
 * navigator.vibrate, so tactility = visual spring + (opt-in) tiny sounds.
 * The AudioContext is created lazily on the first tick after a user gesture;
 * everything is a no-op when disabled or when AudioContext is missing.
 */

type Ctx = AudioContext;

const GAIN = 0.04;

class Ticks {
  private enabled = false;
  private ctx: Ctx | null = null;

  /** Turn ticks on/off (settings.soundOn). Off by default. */
  enable(on: boolean) {
    this.enabled = on;
    if (!on && this.ctx && this.ctx.state === "running") void this.ctx.suspend().catch(() => {});
    if (on && this.ctx && this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  isEnabled() {
    return this.enabled;
  }

  /** Call from any user gesture to warm the context up (optional). */
  prime() {
    if (this.enabled) this.context();
  }

  private context(): Ctx | null {
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private tone(freqFrom: number, freqTo: number, dur: number, type: OscillatorType, gain = GAIN) {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqFrom, t0);
      if (freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc.onended = () => { osc.disconnect(); g.disconnect(); };
    } catch {
      /* audio is decoration; never let it throw into UI */
    }
  }

  /** Correct-answer tick: a short bright blip. */
  correct() {
    this.tone(880, 1320, 0.09, "sine");
  }

  /** Reveal whoosh: a soft rising sweep. */
  reveal() {
    this.tone(220, 660, 0.18, "triangle", GAIN * 0.8);
  }

  /** Generic tap tick (very quiet, used sparingly). */
  tap() {
    this.tone(600, 600, 0.03, "sine", GAIN * 0.5);
  }
}

export const ticks = new Ticks();
