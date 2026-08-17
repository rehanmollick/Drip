import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DWELL_CAP_MS, DwellClock } from "@/lib/dwell";

class FakeDoc extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  hide() { this.visibilityState = "hidden"; this.dispatchEvent(new Event("visibilitychange")); }
  show() { this.visibilityState = "visible"; this.dispatchEvent(new Event("visibilitychange")); }
}

describe("DwellClock", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("measures start → stop", () => {
    const c = new DwellClock();
    c.start("a");
    vi.advanceTimersByTime(2_500);
    expect(c.elapsed()).toBe(2_500);
    expect(c.stop()).toBe(2_500);
    expect(c.current).toBeNull();
    expect(c.stop()).toBe(0);
  });

  it("pauses while the document is hidden and resumes on visible", () => {
    const doc = new FakeDoc();
    const win = new EventTarget();
    const c = new DwellClock();
    c.attach(doc, win);
    c.start("a");
    vi.advanceTimersByTime(1_000);
    doc.hide();
    vi.advanceTimersByTime(300_000); // phone locked for 5 minutes
    doc.show();
    vi.advanceTimersByTime(500);
    expect(c.stop()).toBe(1_500);
    c.detach();
  });

  it("pauses on pagehide and resumes on pageshow", () => {
    const doc = new FakeDoc();
    const win = new EventTarget();
    const c = new DwellClock();
    c.attach(doc, win);
    c.start("a");
    vi.advanceTimersByTime(700);
    win.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(10_000);
    win.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(300);
    expect(c.stop()).toBe(1_000);
  });

  it("hard-caps a single dwell at 60s", () => {
    const c = new DwellClock();
    c.start("a");
    vi.advanceTimersByTime(45 * 60_000);
    expect(c.elapsed()).toBe(DWELL_CAP_MS);
    expect(c.stop()).toBe(60_000);
  });

  it("a card started while hidden only counts time after it becomes visible", () => {
    const doc = new FakeDoc();
    const c = new DwellClock();
    c.attach(doc, null);
    doc.hide();
    c.start("a");
    vi.advanceTimersByTime(5_000);
    doc.show();
    vi.advanceTimersByTime(800);
    expect(c.stop()).toBe(800);
  });

  it("start() replaces the current card and resets accumulated time", () => {
    const c = new DwellClock();
    c.start("a");
    vi.advanceTimersByTime(3_000);
    c.start("b");
    vi.advanceTimersByTime(1_000);
    expect(c.current).toBe("b");
    expect(c.stop()).toBe(1_000);
  });
});
