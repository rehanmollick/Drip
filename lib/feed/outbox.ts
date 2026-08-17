import type { InteractBody } from "@/lib/api/contract";
import { ApiClientError } from "@/lib/api/client";

/**
 * Interact outbox (pure-ish; unit-tested in tests/feed.outbox.test.ts).
 *
 * `viewed` / `dwellMs` / `choice` / `scrollBack` reports that fail wait here and drain in order
 * on `online`, before every generate, and whenever something new is queued. The server's runway
 * math counts unviewed rows, so `viewed` MUST eventually land — but a report that can never
 * succeed (404: the server deleted that card under a dial / re-plan; 400: bad body) must never
 * block the reports behind it. Rules:
 *
 *   - permanent failure (4xx except 408/429)   → drop the item, tell `onDrop`, keep draining
 *   - transient failure (network, 5xx, 408/429) → stop; the item stays at the head, retried later
 *   - a single item that keeps failing transiently is dropped after `maxTries` attempts
 *     (attempts made while `online()` says we're offline don't count — nothing was tried)
 *   - only one drain runs at a time; a drain that finds the queue empty settles immediately and
 *     the NEXT drain call starts a fresh one (the promise handle is set before anything runs)
 */
export type OutboxItem = { rowId: string; body: InteractBody; tries: number };

export type FailureKind = "permanent" | "transient";

export function classifyFailure(e: unknown): FailureKind {
  if (e instanceof ApiClientError) {
    const s = e.status;
    if (s >= 400 && s < 500 && s !== 408 && s !== 429) return "permanent";
    return "transient";
  }
  return "transient"; // TypeError (network), aborted, non-JSON 502 pages …
}

export class Outbox {
  private items: OutboxItem[] = [];
  private draining: Promise<void> | null = null;
  private readonly maxTries: number;
  private readonly onDrop?: (item: OutboxItem, err: unknown) => void;
  private readonly online: () => boolean;

  constructor(
    private readonly send: (rowId: string, body: InteractBody) => Promise<void>,
    opts: { maxTries?: number; onDrop?: (item: OutboxItem, err: unknown) => void; online?: () => boolean } = {},
  ) {
    this.maxTries = opts.maxTries ?? 8;
    this.onDrop = opts.onDrop;
    this.online = opts.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  }

  get size(): number {
    return this.items.length;
  }

  /** Something older is (or may be) stuck: keep order by queueing behind it. */
  push(rowId: string, body: InteractBody): void {
    this.items.push({ rowId, body, tries: 0 });
  }

  /** A `viewed` report for this row is already waiting (don't queue a twin). */
  hasViewed(rowId: string): boolean {
    return this.items.some((i) => i.rowId === rowId && i.body.viewed === true);
  }

  /** Forget queued reports for rows that no longer exist locally. */
  forget(rowIds: ReadonlySet<string>): void {
    if (!this.items.length) return;
    this.items = this.items.filter((i) => !rowIds.has(i.rowId));
  }

  /** Keep only reports for rows that still exist locally (the rest can only 404). */
  retain(known: ReadonlySet<string>): void {
    if (!this.items.length) return;
    this.items = this.items.filter((i) => known.has(i.rowId));
  }

  /** Send in order until empty or a transient failure. Safe to call any time; coalesces. */
  drain(): Promise<void> {
    if (this.draining) return this.draining;
    const run = this.runDrain().finally(() => {
      if (this.draining === run) this.draining = null;
    });
    this.draining = run; // set BEFORE anything can settle — an empty queue must not leave a stale handle
    return run;
  }

  private async runDrain(): Promise<void> {
    while (this.items.length) {
      if (!this.online()) return; // nothing to try; `online` re-drains
      const head = this.items[0];
      try {
        await this.send(head.rowId, head.body);
        this.items.shift();
      } catch (e) {
        if (this.online()) head.tries += 1; // an attempt that died because we went offline mid-flight isn't a strike
        if (classifyFailure(e) === "permanent" || head.tries >= this.maxTries) {
          this.items.shift();
          this.onDrop?.(head, e);
          continue;
        }
        return; // still down; try again later
      }
    }
  }
}
