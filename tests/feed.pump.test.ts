// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pumpOutcome, useFeedCards } from "@/components/feed/useFeedCards";
import type { GenerateData } from "@/lib/api/contract";
import type { CardRow } from "@/lib/schemas/session";

/**
 * The generation loop's stopping rules.
 *
 * A feed that keeps asking for cards nobody is going to write is the cheapest bug in the app to
 * ship and the most expensive to run: it costs a request every few seconds, per reader, forever,
 * for an answer that cannot change. `wrapped` and `awaiting_choice` used to land in the generic
 * backoff and be harmless purely by accident.
 */

type Feed = ReturnType<typeof useFeedCards>;

const SESSION = "11111111-1111-4111-8111-111111111111";

const row = (id: string, idx: string): CardRow =>
  ({
    id,
    sessionId: SESSION,
    idx,
    detourId: null,
    type: "concept",
    payload: { id, type: "concept", topicNodeId: "n0", detourId: null, headline: "h", body: "b" },
    viewedAt: null,
    interaction: null,
    createdAt: new Date().toISOString(),
  }) as unknown as CardRow;

const wrapped: GenerateData = { batch: { id: "wrapped", status: "done", frontierKey: "w", reason: "wrapped" }, cards: [] };
const nothing: GenerateData = { batch: { id: "b", status: "done", frontierKey: "k" }, cards: [] };
const landed = (id: string, idx: string): GenerateData => ({ batch: { id: "b2", status: "done", frontierKey: "k2" }, cards: [row(id, idx)] });

let reply: GenerateData = nothing;
let posts = 0;

function mount(): { feed: () => Feed; unmount: () => void } {
  const box: { current: Feed | null } = { current: null };
  function Probe() {
    box.current = useFeedCards({ sessionId: SESSION, initialCards: [], initialHasMore: false, enabled: true, staticMode: false });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { feed: () => box.current!, unmount: () => act(() => root.unmount()) };
}

/** Let the in-flight fetch chain settle without letting any scheduled retry fire. */
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  posts = 0;
  reply = nothing;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (_url: string, init?: { method?: string }) => {
    if ((init?.method ?? "GET") === "POST") posts += 1;
    return { ok: true, status: 200, json: async () => ({ data: reply, error: null, meta: {} }) } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pumpOutcome", () => {
  it("a wrapped thread and an unanswered fork are terminal, not failures", () => {
    expect(pumpOutcome("wrapped", 0)).toEqual({ kind: "terminal", reason: "wrapped" });
    expect(pumpOutcome("awaiting_choice", 0)).toEqual({ kind: "terminal", reason: "awaiting_choice" });
  });

  it("cards landing beat every reason there is", () => {
    expect(pumpOutcome("wrapped", 1)).toEqual({ kind: "fresh" });
    expect(pumpOutcome("budget", 2)).toEqual({ kind: "fresh" });
  });

  it("the daily cap waits for midnight, our own dial asks straight back, everything else backs off", () => {
    // …and never further out than an hour: a tab left open overnight has to re-check
    expect(pumpOutcome("budget", 0, Date.UTC(2026, 0, 2, 23, 30))).toEqual({ kind: "wait", ms: 30 * 60_000 });
    expect(pumpOutcome("budget", 0, Date.UTC(2026, 0, 2, 12))).toEqual({ kind: "wait", ms: 60 * 60_000 });
    expect(pumpOutcome("superseded", 0)).toEqual({ kind: "again", ms: 300 });
    expect(pumpOutcome("pending_plan", 0)).toEqual({ kind: "backoff" });
    expect(pumpOutcome(null, 0)).toEqual({ kind: "backoff" });
  });
});

describe("the loop after a terminal answer", () => {
  it("stops asking, and never on a clock", async () => {
    const { feed, unmount } = mount();
    reply = wrapped;
    act(() => feed().setWantMore(true));
    await settle();

    expect(posts).toBe(1);
    expect(feed().terminal).toBe("wrapped");
    expect(feed().fill).toBe("idle");

    // twenty seconds — past every step of the 2/4/8/15s backoff — and nothing was asked again
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(posts).toBe(1);

    // …and runway pressure re-asserting itself doesn't restart it either
    act(() => feed().setWantMore(false));
    act(() => feed().setWantMore(true));
    await settle();
    expect(posts).toBe(1);
    unmount();
  });

  it("counted nothing as failed: the next real miss backs off from the first step, not the fourth", async () => {
    const { feed, unmount } = mount();
    reply = wrapped;
    act(() => feed().setWantMore(true));
    await settle();
    expect(posts).toBe(1);

    // a reader action (a fork answered, a dial) is allowed out of a terminal state
    reply = nothing;
    act(() => feed().pump());
    await settle();
    expect(posts).toBe(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_900); });
    expect(posts).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(posts).toBe(3); // 2s = BACKOFF_MS[0]: the wrapped answer never incremented the counter
    unmount();
  });

  it("a card landing later clears it", async () => {
    const { feed, unmount } = mount();
    reply = wrapped;
    act(() => feed().setWantMore(true));
    await settle();
    expect(feed().terminal).toBe("wrapped");

    reply = landed("22222222-2222-4222-8222-222222222222", "a1");
    act(() => feed().pump());
    await settle();

    expect(feed().terminal).toBeNull();
    expect(feed().cards).toHaveLength(1);
    unmount();
  });

  it("keeps the frontier every generate response carried, so nothing has to poll for it", async () => {
    const { feed, unmount } = mount();
    reply = { ...nothing, frontier: { written: { n0: 3 }, nodeIdx: 1, deeper: {}, closed: [], gate: null, live: null, epoch: 0 } };
    act(() => feed().setWantMore(true));
    await settle();
    expect(feed().frontier?.written).toEqual({ n0: 3 });

    // a response that couldn't count says nothing; "we didn't look" must not blank the bar
    reply = nothing;
    act(() => feed().pump());
    await settle();
    expect(feed().frontier?.written).toEqual({ n0: 3 });
    unmount();
  });
});
