import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Route handlers call after() for background planning; run those tasks inline
// (awaited before the test continues) so we can assert on their effects.
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: unknown) => { pending.push(Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task)); } };
});
const flush = async () => { while (pending.length) await pending.splice(0).reduce((p, x) => p.then(() => x), Promise.resolve()); };

import { createLocalStore } from "@/lib/db/local";
import type { LlmApi, LlmResult } from "@/lib/llm-types";
import type { Card } from "@/lib/schemas/cards";
import { PlanOutputSchema } from "@/lib/schemas/plan";
import { SAMPLE_THEME_TERMINAL_NOIR } from "@/lib/theme/defaults";
import { uuid } from "@/lib/id";
import { setEngineDepsForTests } from "@/lib/generation/engine";
import * as sessionsRoute from "@/app/api/sessions/route";
import * as sessionRoute from "@/app/api/sessions/[id]/route";
import * as cardsRoute from "@/app/api/sessions/[id]/cards/route";
import * as generateRoute from "@/app/api/sessions/[id]/generate/route";
import * as dialRoute from "@/app/api/sessions/[id]/dial/route";
import * as askRoute from "@/app/api/sessions/[id]/ask/route";
import * as retryRoute from "@/app/api/sessions/[id]/retry/route";
import * as remixRoute from "@/app/api/sessions/[id]/remix/route";
import * as interactRoute from "@/app/api/cards/[id]/interact/route";

const okR = <T>(value: T): LlmResult<T> => ({ ok: true, value, meta: { model: "fake", promptVersion: "t", latencyMs: 1, inTokens: 1, outTokens: 1, attempts: 1 } });
const concept = (i: string): Card => ({ id: uuid(), type: "concept", topicNodeId: "n1", detourId: null, headline: `concept ${i}`, body: "b" });
const hook = (i: string): Card => ({ id: uuid(), type: "hook", topicNodeId: "n1", detourId: null, headline: `hook ${i}` });
let planOk = true;
const llm: LlmApi = {
  async plan() {
    if (!planOk) return { ok: false, code: "api", error: "down" };
    return okR(PlanOutputSchema.parse({
      title: "t", theme: SAMPLE_THEME_TERMINAL_NOIR,
      persona: { traits: ["a", "b", "c"], tics: ["x", "y"], humor: "dry", neverDoes: "z" },
      outline: [{ id: "n1", title: "one", estCards: 4, dependsOn: [] }, { id: "n2", title: "two", estCards: 4, dependsOn: [] }],
      clarifiers: [], firstCards: [hook("1"), concept("2"), concept("3")],
    }));
  },
  async writeBatch(ctx) { return okR(Array.from({ length: ctx.batchSize }, (_, i) => concept(`w${i}`))); },
  async triage() { return okR({ kind: "inline" as const, answer: "yep." }); },
  async writeDetour(ctx) { return okR(Array.from({ length: ctx.cardCount }, (_, i) => concept(`d${i}`))); },
  async dialToast() { return "say less."; },
  async evaluateOpen() { return { ok: false as const, code: "api" as const, error: "n/a" }; },
  async updateStoryline() { return { ok: false as const, code: "api" as const, error: "n/a" }; },
  async writeWrap() { return { ok: false as const, code: "api" as const, error: "n/a" }; },
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://drip.local${url}`, { method, headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
type Env<T> = { data: T; error: { code: string; message: string } | null; meta: Record<string, unknown> };
const read = async <T>(res: Response): Promise<{ status: number; env: Env<T> }> => ({ status: res.status, env: (await res.json()) as Env<T> });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drip-routes-"));
  setEngineDepsForTests({ llm, store: createLocalStore({ dir }) });
});
afterAll(() => {
  setEngineDepsForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("api routes", () => {
  it("full flow: create → poll → cards → generate → interact → dial → ask → remix → delete", async () => {
    // create (planning kicks off after the response)
    const c = await read<{ session: { id: string; status: string; sourceChars: number } }>(await sessionsRoute.POST(json("POST", "/api/sessions", { input: "how a cache keeps a site alive" }), {}));
    expect(c.status).toBe(201);
    expect(c.env.error).toBeNull();
    expect(c.env.data.session.status).toBe("planning");
    expect(c.env.data.session.sourceChars).toBe(30);
    expect((c.env.data.session as Record<string, unknown>).sourceText).toBeUndefined();
    const id = c.env.data.session.id;
    await flush();

    // detail
    const g = await read<{ session: { status: string; cardCount: number; title: string } }>(await sessionRoute.GET(json("GET", `/api/sessions/${id}`), ctx(id)));
    expect(g.env.data.session.status).toBe("active");
    expect(g.env.data.session.cardCount).toBe(3);
    expect(g.env.data.session.title).toBe("t");

    // list
    const l = await read<{ sessions: { id: string }[] }>(await sessionsRoute.GET(json("GET", "/api/sessions"), {}));
    expect(l.env.data.sessions.some((s) => s.id === id)).toBe(true);

    // cards paging
    const p1 = await read<{ cards: { id: string; idx: string }[]; hasMore: boolean }>(await cardsRoute.GET(json("GET", `/api/sessions/${id}/cards?limit=2`), ctx(id)));
    expect(p1.env.data.cards).toHaveLength(2);
    expect(p1.env.data.hasMore).toBe(true);
    const p2 = await read<{ cards: { id: string }[]; hasMore: boolean }>(await cardsRoute.GET(json("GET", `/api/sessions/${id}/cards?after=${encodeURIComponent(p1.env.data.cards[1].idx)}&limit=12`), ctx(id)));
    expect(p2.env.data.cards).toHaveLength(1);
    expect(p2.env.data.hasMore).toBe(false);
    const bad = await read(await cardsRoute.GET(json("GET", `/api/sessions/${id}/cards?limit=0`), ctx(id)));
    expect(bad.status).toBe(400);
    expect(bad.env.error?.code).toBe("invalid_request");

    // generate (empty body tolerated)
    const gen = await read<{ batch: { status: string }; cards: { id: string }[] }>(await generateRoute.POST(json("POST", `/api/sessions/${id}/generate`), ctx(id)));
    expect(gen.env.data.batch.status).toBe("done");
    expect(gen.env.data.cards).toHaveLength(4);

    // interact: dwell over 60s is rejected by the contract
    const cardId = p1.env.data.cards[0].id;
    const tooLong = await read(await interactRoute.POST(json("POST", `/api/cards/${cardId}/interact`, { dwellMs: 61_000 }), ctx(cardId)));
    expect(tooLong.status).toBe(400);
    const ok1 = await read<{ card: { viewedAt: string | null }; learnerState: unknown; inserted: unknown[] }>(await interactRoute.POST(json("POST", `/api/cards/${cardId}/interact`, { viewed: true, dwellMs: 2000 }), ctx(cardId)));
    expect(ok1.env.data.card.viewedAt).toBeTruthy();
    expect(ok1.env.data.inserted).toEqual([]);

    // dial
    const d = await read<{ session: { learnerState: { globalLevel: number } }; toast: string; removedAfter: string }>(await dialRoute.POST(json("POST", `/api/sessions/${id}/dial`, { direction: "simpler", currentCardId: cardId }), ctx(id)));
    expect(d.env.data.toast).toBe("say less.");
    expect(d.env.data.session.learnerState.globalLevel).toBe(2);
    expect(d.env.data.removedAfter).toBe(p1.env.data.cards[0].idx);

    // ask
    const a = await read<{ kind: string; answer: string }>(await askRoute.POST(json("POST", `/api/sessions/${id}/ask`, { question: "why?", currentCardId: cardId }), ctx(id)));
    expect(a.env.data).toEqual({ kind: "inline", answer: "yep." });

    // patch: settings + position
    const pt = await read<{ session: { settings: { chillMode: boolean }; position: number } }>(await sessionRoute.PATCH(json("PATCH", `/api/sessions/${id}`, { settings: { chillMode: true }, position: 2 }), ctx(id)));
    expect(pt.env.data.session.settings.chillMode).toBe(true);
    expect(pt.env.data.session.position).toBe(2);
    // a partial settings patch must not reset the other keys to defaults
    const pt2 = await read<{ session: { settings: { chillMode: boolean; depthPreset: string } } }>(await sessionRoute.PATCH(json("PATCH", `/api/sessions/${id}`, { settings: { depthPreset: "skim" } }), ctx(id)));
    expect(pt2.env.data.session.settings).toMatchObject({ chillMode: true, depthPreset: "skim" });
    await read(await sessionRoute.PATCH(json("PATCH", `/api/sessions/${id}`, { settings: { depthPreset: "standard" } }), ctx(id)));

    // remix
    const r = await read<{ session: { id: string; status: string; settings: { chillMode: boolean; depthPreset: string } } }>(await remixRoute.POST(json("POST", `/api/sessions/${id}/remix`, { settings: { depthPreset: "deep" } }), ctx(id)));
    expect(r.status).toBe(201);
    expect(r.env.data.session.id).not.toBe(id);
    expect(r.env.data.session.settings).toMatchObject({ chillMode: true, depthPreset: "deep" });
    await flush();
    const rg = await read<{ session: { status: string } }>(await sessionRoute.GET(json("GET", `/api/sessions/${r.env.data.session.id}`), ctx(r.env.data.session.id)));
    expect(rg.env.data.session.status).toBe("active");

    // delete → 404 afterwards
    const del = await read<{ deleted: true }>(await sessionRoute.DELETE(json("DELETE", `/api/sessions/${id}`), ctx(id)));
    expect(del.env.data.deleted).toBe(true);
    const nf = await read(await sessionRoute.GET(json("GET", `/api/sessions/${id}`), ctx(id)));
    expect(nf.status).toBe(404);
    expect(nf.env.error?.code).toBe("not_found");
  });

  it("planning failure → error status → retry replans", async () => {
    planOk = false;
    const c = await read<{ session: { id: string } }>(await sessionsRoute.POST(json("POST", "/api/sessions", { input: "x" }), {}));
    const id = c.env.data.session.id;
    await flush();
    const g = await read<{ session: { status: string; error: string } }>(await sessionRoute.GET(json("GET", `/api/sessions/${id}`), ctx(id)));
    expect(g.env.data.session.status).toBe("error");
    // generate while errored → failed pseudo batch, no throw
    const gen = await read<{ batch: { status: string }; cards: unknown[] }>(await generateRoute.POST(json("POST", `/api/sessions/${id}/generate`, {}), ctx(id)));
    expect(gen.env.data.batch.status).toBe("failed");
    planOk = true;
    const r = await read<{ session: { status: string } }>(await retryRoute.POST(json("POST", `/api/sessions/${id}/retry`), ctx(id)));
    expect(r.env.data.session.status).toBe("planning");
    await flush();
    const g2 = await read<{ session: { status: string } }>(await sessionRoute.GET(json("GET", `/api/sessions/${id}`), ctx(id)));
    expect(g2.env.data.session.status).toBe("active");
  });

  it("invalid bodies → 400 envelope; unknown ids → 404 envelope", async () => {
    const bad = await read(await sessionsRoute.POST(json("POST", "/api/sessions", { nope: 1 }), {}));
    expect(bad.status).toBe(400);
    expect(bad.env.data).toBeNull();
    expect(bad.env.error?.code).toBe("invalid_request");
    const notJson = await read(await sessionsRoute.POST(new Request("http://drip.local/api/sessions", { method: "POST", body: "{" }), {}));
    expect(notJson.env.error?.code).toBe("invalid_json");
    const nf = await read(await dialRoute.POST(json("POST", `/api/sessions/${uuid()}/dial`, { direction: "deeper", currentCardId: "x" }), ctx(uuid())));
    expect(nf.status).toBe(404);
  });
});
