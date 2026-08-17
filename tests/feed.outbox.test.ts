import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import { classifyFailure, Outbox } from "@/lib/feed/outbox";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("classifyFailure", () => {
  it("4xx (except 408/429) is permanent; 5xx, 408, 429 and network errors are transient", () => {
    expect(classifyFailure(new ApiClientError(404, "not_found", "card not found"))).toBe("permanent");
    expect(classifyFailure(new ApiClientError(400, "invalid_request", "bad"))).toBe("permanent");
    expect(classifyFailure(new ApiClientError(408, "timeout", "slow"))).toBe("transient");
    expect(classifyFailure(new ApiClientError(429, "rate", "slow down"))).toBe("transient");
    expect(classifyFailure(new ApiClientError(502, "bad_gateway", "down"))).toBe("transient");
    expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("transient");
  });
});

describe("Outbox", () => {
  it("sends in order and empties on success", async () => {
    const sent: string[] = [];
    const ob = new Outbox(async (rowId) => { sent.push(rowId); }, { online: () => true });
    ob.push("a", { viewed: true });
    ob.push("b", { dwellMs: 100 });
    await ob.drain();
    expect(sent).toEqual(["a", "b"]);
    expect(ob.size).toBe(0);
  });

  it("an empty drain never leaves a stale handle: the next drain sends (regression: contract-consistency-1)", async () => {
    const sent: string[] = [];
    const ob = new Outbox(async (rowId) => { sent.push(rowId); }, { online: () => true });
    await ob.drain(); // empty
    await tick();
    ob.push("a", { viewed: true });
    await ob.drain();
    expect(sent).toEqual(["a"]);
  });

  it("drops a permanent 404 head, reports it, and keeps draining what's behind it", async () => {
    const sent: string[] = [];
    const dropped: string[] = [];
    const ob = new Outbox(
      async (rowId) => {
        if (rowId === "ghost") throw new ApiClientError(404, "not_found", "card not found");
        sent.push(rowId);
      },
      { online: () => true, onDrop: (item) => dropped.push(item.rowId) },
    );
    ob.push("ghost", { viewed: true });
    ob.push("b", { viewed: true });
    ob.push("c", { choice: 1, correct: true });
    await ob.drain();
    expect(dropped).toEqual(["ghost"]);
    expect(sent).toEqual(["b", "c"]);
    expect(ob.size).toBe(0);
  });

  it("stops on a transient failure, keeps the head, and retries it on the next drain", async () => {
    let fail = true;
    const sent: string[] = [];
    const ob = new Outbox(
      async (rowId) => {
        if (fail) throw new ApiClientError(503, "unavailable", "down");
        sent.push(rowId);
      },
      { online: () => true },
    );
    ob.push("a", { viewed: true });
    ob.push("b", { viewed: true });
    await ob.drain();
    expect(sent).toEqual([]);
    expect(ob.size).toBe(2);
    fail = false;
    await ob.drain();
    expect(sent).toEqual(["a", "b"]);
  });

  it("gives up on a head that keeps failing transiently after maxTries", async () => {
    const dropped: string[] = [];
    const ob = new Outbox(async () => { throw new TypeError("Failed to fetch"); }, { online: () => true, maxTries: 3, onDrop: (i) => dropped.push(i.rowId) });
    ob.push("a", { viewed: true });
    await ob.drain();
    await ob.drain();
    expect(dropped).toEqual([]);
    await ob.drain();
    expect(dropped).toEqual(["a"]);
    expect(ob.size).toBe(0);
  });

  it("does not try (or count strikes) while offline", async () => {
    let online = false;
    const send = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const ob = new Outbox(send, { online: () => online, maxTries: 2 });
    ob.push("a", { viewed: true });
    for (let i = 0; i < 5; i++) await ob.drain();
    expect(send).not.toHaveBeenCalled();
    expect(ob.size).toBe(1);
    online = true;
    await ob.drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(ob.size).toBe(1); // one strike, still queued
  });

  it("coalesces concurrent drains into one run", async () => {
    let resolveFirst: () => void = () => {};
    const send = vi.fn(() => new Promise<void>((r) => { resolveFirst = r; }));
    const ob = new Outbox(send, { online: () => true });
    ob.push("a", { viewed: true });
    const d1 = ob.drain();
    const d2 = ob.drain();
    expect(d1).toBe(d2);
    resolveFirst();
    await d1;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retain() drops reports for rows that no longer exist locally; hasViewed() spots a waiting viewed", () => {
    const ob = new Outbox(async () => {}, { online: () => false });
    ob.push("a", { viewed: true });
    ob.push("b", { dwellMs: 5 });
    ob.push("gone", { viewed: true });
    expect(ob.hasViewed("a")).toBe(true);
    expect(ob.hasViewed("b")).toBe(false);
    ob.retain(new Set(["a", "b"]));
    expect(ob.size).toBe(2);
    ob.forget(new Set(["a"]));
    expect(ob.size).toBe(1);
  });
});
