import { test, expect, type Page } from "@playwright/test";
import { createSession, goToSlide, slides, waitForCards } from "./helpers";

/** Press and hold an element (pointer events; iOS Safari has no contextmenu on touch). */
async function longPress(page: Page, selector: string, ms = 800) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const RAIL = '[data-testid="depth-rail"]';

/** Vertical geometry of a rail piece, as a fraction of the rail's own height. */
async function frac(page: Page, selector: string) {
  const rail = await page.locator(RAIL).boundingBox();
  const el = await page.locator(selector).first().boundingBox();
  if (!rail || !el) return null;
  return { top: (el.y - rail.y) / rail.height, height: el.height / rail.height };
}

/** What the reader is actually looking at: the slide under the thumb, where it sits, and what's below it. */
function activeInfo(page: Page) {
  return page.evaluate(() => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const cards = [...document.querySelectorAll("section.card")] as HTMLElement[];
    const index = cards.findIndex((c) => Math.abs(c.offsetTop - feed.scrollTop) < 40);
    return {
      index,
      key: index >= 0 ? cards[index].getAttribute("data-slide-key") : null,
      total: cards.length,
      below: cards.length - 1 - index,
    };
  });
}

/** Wait for the feed to stop changing shape (deck size + where the reader is), then report it. */
async function settled(page: Page, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let last = JSON.stringify(await activeInfo(page));
  let same = 0;
  while (Date.now() < deadline && same < 3) {
    await page.waitForTimeout(200);
    const now = JSON.stringify(await activeInfo(page));
    if (now === last) same += 1;
    else {
      same = 0;
      last = now;
    }
  }
  return JSON.parse(last) as { index: number; key: string | null; total: number; below: number };
}

test.describe("the depth rail", () => {
  test("a vertical rail on the right edge: geometry only, never a digit, and the thumb sinks as you scroll", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");

    const rail = page.locator(RAIL);
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    // hugging the right edge, spanning most of the viewport height
    expect(box!.x + box!.width).toBeGreaterThan(393 - 30);
    expect(box!.height).toBeGreaterThan(852 * 0.6);
    // the ambient indicator carries NO text at all — the "now: <topic>" label lives outside it
    expect((await rail.innerText()).trim()).toBe("");

    // topic boundaries are ticks; spans are proportional, so there are exactly outline-1 of them
    await expect(page.locator(`${RAIL} [data-tick]`)).toHaveCount(3);

    // endowed progress: the thumb starts visibly past zero before any scrolling
    const thumb0 = await frac(page, `${RAIL} [data-thumb]`);
    expect(thumb0!.top).toBeGreaterThan(0.01);

    // …and it sinks as the reader goes deeper (position maps to geometry 1:1)
    await goToSlide(page, 18);
    await page.waitForTimeout(600);
    const thumb1 = await frac(page, `${RAIL} [data-thumb]`);
    expect(thumb1!.top).toBeGreaterThan(thumb0!.top + 0.1);

    // read is solid down to the thumb, and everything in hand draws as existing
    const read = await frac(page, `${RAIL} [data-band="read"]`);
    expect(read!.top).toBeLessThan(0.02);
    expect(Math.abs(read!.top + read!.height - thumb1!.top)).toBeLessThan(0.03);
    expect(errors).toEqual([]);
  });

  test("ambient discipline: a hairline at rest, swollen and bright while moving", async ({ page }) => {
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");
    // rest: wait out the arrival brightness
    await page.waitForTimeout(1_800);
    const rest = await page.locator(`${RAIL} > div`).evaluate((el) => ({ w: el.getBoundingClientRect().width, o: Number(getComputedStyle(el).opacity) }));
    expect(rest.w).toBeLessThan(4);
    expect(rest.o).toBeLessThan(0.6);
    // moving: it wakes up
    await goToSlide(page, 3);
    await page.waitForTimeout(250);
    const awake = await page.locator(`${RAIL} > div`).evaluate((el) => ({ w: el.getBoundingClientRect().width, o: Number(getComputedStyle(el).opacity) }));
    expect(awake.w).toBeGreaterThan(rest.w);
    expect(awake.o).toBeGreaterThan(rest.o);
  });

  test("a detour doubles the rail beside itself", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    const detour = page.locator('section.card[data-card-type="detour_marker"]').first();
    const idx = await detour.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
    await goToSlide(page, idx + 1); // inside the detour, not on the marker
    await expect(page.locator(`${RAIL}[data-detour="true"]`)).toHaveCount(1);
    await expect(page.locator(`${RAIL} [data-band="detour"]`)).toHaveCount(1);
    await goToSlide(page, 0);
    await expect(page.locator(`${RAIL}[data-detour="true"]`)).toHaveCount(0);
  });

  test("crossing into a new topic says so, then gets out of the way", async ({ page }) => {
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");
    await goToSlide(page, 2);
    await goToSlide(page, 8); // over the boundary into the second topic
    const label = page.getByTestId("topic-label");
    // (the previous topic's line may still be cross-fading out — the incoming one is last)
    await expect(label.last()).toHaveText(/now: how a cache actually answers/, { timeout: 4_000 });
    await expect(label).toHaveCount(0, { timeout: 6_000 });
  });
});

test.describe("the rail tells written apart from planned", () => {
  test("existing cards draw solid, a heading-only topic stays a dashed nothing, and an open topic never reads finished", async ({ page }) => {
    await page.goto("/dev/timeline?state=buffered");
    await page.waitForSelector("section.card");
    // n0, n1 and n2 have cards; n3 is nothing but a heading — three exists bands, never four
    await expect(page.locator(`${RAIL} [data-band="exists"]`)).toHaveCount(3);

    // the last topic's stretch of rail is purely the dashed planned band: no exists band overlaps it
    const rail = await page.locator(RAIL).boundingBox();
    const lastTick = await page.locator(`${RAIL} [data-tick]`).last().boundingBox();
    const existsBoxes = await page.locator(`${RAIL} [data-band="exists"]`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    for (const bottom of existsBoxes) expect(bottom).toBeLessThanOrEqual(lastTick!.y + 3);
    expect(lastTick!.y).toBeLessThan(rail!.y + rail!.height); // there IS rail below it: the planned zone

    // still not a digit anywhere on the ambient indicator
    expect((await page.locator(RAIL).innerText()).trim()).toBe("");
  });

  test("exactly one pulse, on the writing frontier, only while a batch is in flight", async ({ page }) => {
    await page.goto("/dev/timeline?state=live");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-pulse="true"]')).toHaveCount(1);
    await expect(page.locator(`${RAIL}[data-live="true"]`)).toHaveCount(1);

    await page.goto("/dev/timeline?state=buffered");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-pulse="true"]')).toHaveCount(0);
  });

  test("a fork is a gate: the rail stops, nothing pulses, downstream is dimmed", async ({ page }) => {
    await page.goto("/dev/timeline?state=gate");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-pulse="true"]')).toHaveCount(0);
    await expect(page.locator(`${RAIL}[data-gate="crossroads"]`)).toHaveCount(1);
    await expect(page.locator(`${RAIL} [data-gate-mark]`)).toHaveCount(1);
    // everything below the gate mark sits under the parked veil
    const gate = await frac(page, `${RAIL} [data-gate-mark]`);
    const veil = await frac(page, `${RAIL} [data-band="parked"]`);
    expect(Math.abs(veil!.top - gate!.top)).toBeLessThan(0.03);
    expect(veil!.top + veil!.height).toBeGreaterThan(0.97);
  });

  test("a wrap is a hard end cap: all written, nothing dim below", async ({ page }) => {
    await page.goto("/dev/timeline?state=wrapped");
    await page.waitForSelector("section.card");
    await expect(page.locator(`${RAIL}[data-wrapped="true"]`)).toHaveCount(1);
    await expect(page.locator(`${RAIL} [data-cap]`)).toHaveCount(1);
    await expect(page.locator(`${RAIL}[data-open]`)).toHaveCount(0);
    await expect(page.locator('[data-pulse="true"]')).toHaveCount(0);
    const cap = await frac(page, `${RAIL} [data-cap]`);
    expect(cap!.top).toBeGreaterThan(0.95); // the cap IS the bottom: the rail is exactly what was written
  });
});

test.describe("the rail under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the pulse is still there and nothing on the rail is animating", async ({ page }) => {
    await page.goto("/dev/timeline?state=live");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-pulse="true"]')).toHaveCount(1);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const rail = document.querySelector('[data-testid="depth-rail"]')!;
          return [rail, ...rail.querySelectorAll("*")].reduce((n, el) => n + el.getAnimations().length, 0);
        }),
      )
      .toBe(0);
  });
});

test.describe("the planning theatre", () => {
  test("before the plan: a breathing proto-rail, no skeleton bars, no fake progress, no digits", async ({ page }) => {
    await page.goto("/dev/timeline?state=planning");
    await page.waitForSelector("section.card");
    await expect(page.getByTestId("proto-rail")).toBeVisible();
    await expect(page.locator(".shimmer")).toHaveCount(0);
    const text = await page.locator("section.card").first().innerText();
    expect(text).toMatch(/reading your stuff/);
    // no fake progress: never a percent, never a counter (the theme's signature device — hex
    // addresses, tickers — may carry digits; those are art direction, not measurement)
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\b\d+\s*(\/|of)\s*\d+\b/);
  });

  test("the moment the plan lands: the persona says one line and the thread's stops tick in", async ({ page }) => {
    await page.goto("/dev/timeline?state=planned");
    await page.waitForSelector("section.card");
    const reveal = page.getByTestId("plan-reveal");
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText("the night-shift SRE");
    await expect(reveal).toContainText("the second ask free");
    // the outline's stops, one by one, on the proto-rail — the same language the depth rail speaks
    await expect(page.locator("[data-plan-stop]")).toHaveCount(4, { timeout: 6_000 });
    await expect(reveal).toContainText("why a cache exists at all");
    // never a counter on the reveal either
    expect(await reveal.innerText()).not.toMatch(/\b\d+\s*(\/|of)\s*\d+\b/);
  });
});

test.describe("session map", () => {
  test("long-press the rail → the thread as a vertical path, with where you are marked", async ({ page }) => {
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");
    await goToSlide(page, 18); // third topic; the first two are behind us and seen

    await longPress(page, RAIL);
    const sheet = page.getByRole("dialog", { name: "the thread" });
    await expect(sheet).toBeVisible();

    const rows = page.locator("[data-map-row]");
    await expect(rows.filter({ hasText: "why a cache exists at all" })).toHaveCount(1);
    await expect(page.locator('[data-map-row="current"]')).toHaveCount(1);
    await expect(page.locator("[data-branch]")).toHaveCount(1); // the detour hangs off its topic
    await expect(sheet).toContainText("you’re here");
    // the one number allowed anywhere near this surface: time-as-effort, on demand, in the sheet
    await expect(page.getByTestId("minutes-left")).toContainText(/~\d+ min left in this thread/);
    // …and still never a counter
    expect(await sheet.innerText()).not.toMatch(/\b\d+\s*(\/|of)\s*\d+\b/);

    // a topic still ahead of the reader is inert — the map never jumps past what's written
    await expect(page.locator('[data-map-row="ahead"]').first()).toBeDisabled();

    // …and one they've been through takes them back to its first card
    await page.locator("[data-map-row]", { hasText: "why a cache exists at all" }).click();
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(500);
    expect((await activeInfo(page)).index).toBe(0);
  });

  test("the sheet keeps the in-app refresh reachable", async ({ page }) => {
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");
    await longPress(page, RAIL);
    await expect(page.getByRole("button", { name: "refresh this feed" })).toBeVisible();
  });
});

test.describe("placeholders (bug: my slide turned into something else)", () => {
  test("the placeholder under the thumb keeps its key AND its slot when cards land", async ({ page }) => {
    // This one asserts behaviour, not speed: it waits for the feed to reach each state and to stop
    // changing, so a slow store just means it waits longer. Give it the room to do that.
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const id = await createSession(page, "how a cache stampede takes a site down");
    await waitForCards(page, 3);
    // let the opening batch finish landing — mock topics end parked at a fork, so its arrival means
    // the deck is quiet. Walking earlier makes the in-flight batch land below the pin (correctly!)
    // and the test would be measuring its own impatience instead of the invariant.
    await expect.poll(() => page.locator('section.card[data-card-type="crossroads"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);

    // Clone a real row so what lands later is a card the feed renders for real — and give the
    // clones idx keys derived from the FIRST row, so by `idx` alone they belong near the top of the
    // deck rather than at the end. A batch written against a stale frontier does exactly that (a
    // detour splice, a generate that raced a re-sync), and it is what used to walk the placeholder
    // down the deck: same key, new slot, new cards stranded above the reader. Anchoring on row 0
    // instead of the last row is also what makes this deterministic — it no longer depends on how
    // far generation happened to get before the test looked.
    const listed = await (await page.request.get(`/api/sessions/${id}/cards?limit=50`)).json();
    const rows = listed.data.cards as Array<Record<string, unknown> & { id: string; idx: string; payload: Record<string, unknown> }>;
    const template = rows[0];
    const later = [1, 2].map((n) => {
      const fresh = `11111111-0000-4000-8000-00000000000${n}`;
      return { ...template, id: fresh, idx: template.idx + "V".repeat(n), viewedAt: null, interaction: null, payload: { ...template.payload, id: fresh } };
    });

    // hold the deck still so the reader can actually reach the end of it, then land two cards
    // exactly when we say so. Answering a fork is no way to reach the placeholder any more — the
    // choose itself writes the next topic and parks at the NEXT fork, so a chooser never stands on
    // "catching up". Instead the fork stays unanswered and the held responses clear the gate the
    // last real generate reported (mock topics end parked at one): what the client then believes —
    // no fork in the way, a batch pending, zero runway — is exactly the state the tail exists for.
    let held = true;
    await page.route("**/api/sessions/*/generate", async (route) => {
      if (!held) {
        const data = { batch: { id: "landed", status: "done", frontierKey: "landed" }, cards: later };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data, error: null, meta: {} }) });
        return;
      }
      const res = await route.fetch();
      const body = await res.json().catch(() => null);
      if (!body?.data) return route.fulfill({ response: res });
      body.data.cards = [];
      body.data.batch = { ...body.data.batch, reason: "superseded" }; // never terminal: the loop keeps asking
      if (body.data.frontier) body.data.frontier = { ...body.data.frontier, gate: null, live: null };
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });

    // walk to the end (past the fork — it's just a slide when nobody answers it) until the
    // "catching up" placeholder is the card under the thumb
    await expect
      .poll(
        async () => {
          const n = await slides(page).count();
          await goToSlide(page, n - 1);
          return (await activeInfo(page)).key;
        },
        { timeout: 30_000 },
      )
      .toBe("pseudo:catching_up");

    const before = await settled(page);
    expect(before.key).toBe("pseudo:catching_up");
    expect(before.below).toBe(0);

    // let real cards land while the reader stands still on it
    held = false;
    await expect.poll(async () => slides(page).count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(before.total + later.length);

    // …and wait for the feed to stop changing shape rather than for a fixed number of milliseconds
    const after = await settled(page);
    expect(after.key, "the card under the thumb changed identity").toBe(before.key);
    expect(after.index, "the card under the thumb moved slot").toBe(before.index);
    expect(after.below, "new cards must land AFTER the placeholder").toBe(later.length);

    // the cards that landed are real, reachable card slides sitting below the placeholder —
    // not stranded above the reader where they can never be swiped to
    const belowKeys = await page.evaluate((from: number) =>
      [...document.querySelectorAll("section.card")]
        .slice(from)
        .map((c) => [c.getAttribute("data-slide-key"), c.getAttribute("data-slide-kind")]),
      after.index + 1,
    );
    expect(belowKeys).toEqual(later.map((c) => [c.id, "card"]));
    expect(errors).toEqual([]);
  });
});

test.describe("what the rail costs to keep honest", () => {
  test("scrolling for 20s never re-reads the session", async ({ page }) => {
    // Every GET /api/sessions/:id is a full card scan plus a session read, and a rail kept live on a
    // clock pays that per reader, for as long as they read. The frontier rides back on the generate
    // the feed was already posting, so the only polls left are the bounded ones for a flip nothing
    // else can announce (still planning, re-planning) — and neither is running once the deck exists.
    test.setTimeout(120_000);
    const id = await createSession(page, "how a cache stampede takes a site down");
    await waitForCards(page, 3);
    // the planning poll stops on this flip; `page.request` doesn't go through the page, so the
    // waiting itself is invisible to the counter below
    await expect
      .poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).data.session.status, { timeout: 60_000 })
      .toBe("active");
    await page.waitForTimeout(3_000); // let the last planning tick land

    let reads = 0;
    page.on("request", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === `/api/sessions/${id}`) reads += 1;
    });

    /** Pull on the runway the way a reader does, for `ms`. */
    const scrollFor = async (ms: number) => {
      const until = Date.now() + ms;
      for (let i = 0; Date.now() < until; i++) await goToSlide(page, i % Math.max(1, await slides(page).count()));
    };

    await scrollFor(10_000);
    const first = reads;
    await scrollFor(10_000);

    expect(first, "the session is being polled while the reader scrolls").toBeLessThanOrEqual(1);
    expect(reads, "session reads grow with time spent in the feed").toBe(first);
  });
});

test.describe("crossroads", () => {
  test("while it waits on the reader, nothing generates and no catching-up tail appears", async ({ page }) => {
    const generates: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/generate")) generates.push(r.url());
    });
    // the session reports itself parked at a fork from the very first poll
    await page.route("**/api/sessions/*", async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      const res = await route.fetch();
      const body = await res.json().catch(() => null);
      if (!body?.data?.session?.progress) return route.fulfill({ response: res });
      body.data.session.progress.awaitingChoice = true;
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });

    await createSession(page, "why kubernetes pods get evicted");
    await waitForCards(page, 3);
    generates.length = 0;

    const n = await slides(page).count();
    await goToSlide(page, n - 1);
    await page.waitForTimeout(4_000);

    expect(generates, "the runway pumped while the feed was waiting on a choice").toEqual([]);
    await expect(page.locator('[data-slide-key="pseudo:catching_up"]')).toHaveCount(0);
  });

  test("a live reader reaching an unanswered fork gets the fork as the end of the deck — no tail below it", async ({ page }) => {
    await createSession(page, "how a cache stampede takes a site down");
    await waitForCards(page, 3);

    // generation stops at the topic boundary; walk to the fork WITHOUT answering it
    await expect
      .poll(
        async () => {
          const n = await slides(page).count();
          await goToSlide(page, Math.min(n - 1, (await activeInfo(page)).index + 1));
          return page.locator('section.card[data-card-type="crossroads"]').count();
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);

    const cross = page.locator('section.card[data-card-type="crossroads"]').first();
    const idx = await cross.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
    await goToSlide(page, idx);
    await page.waitForTimeout(3_000); // give a wrong tail every chance to appear

    // the fork IS the last slide: nothing below it promises cards nobody is writing
    await expect(page.locator('[data-slide-key="pseudo:catching_up"]')).toHaveCount(0);
    const last = page.locator("section.card").last();
    expect(await last.getAttribute("data-card-type")).toBe("crossroads");
  });

  test("picking a direction posts the choice and the deck starts moving again", async ({ page }) => {
    await createSession(page, "how a cache stampede takes a site down");
    await waitForCards(page, 3);

    // generation stops at the topic boundary, so scrolling gets us to the fork
    await expect
      .poll(
        async () => {
          const n = await slides(page).count();
          await goToSlide(page, Math.min(n - 1, (await activeInfo(page)).index + 1));
          return page.locator('section.card[data-card-type="crossroads"]').count();
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0);

    // the fork's data-card-type is on the section even while its content is windowed out, so
    // finding it is not the same as being able to tap it: keep scrolling it under the thumb until
    // the feed has mounted the buttons (the observer needs a beat to move the render window)
    const cross = page.locator('section.card[data-card-type="crossroads"]').first();
    const btn = cross.locator('[data-choice="continue"]');
    await expect
      .poll(
        async () => {
          const idx = await cross.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
          await goToSlide(page, idx);
          return btn.isVisible();
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const before = await slides(page).count();

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/choose")),
      btn.click(),
    ]);
    expect(JSON.parse(req.postData() ?? "{}").choice).toBe("continue");
    await expect.poll(async () => slides(page).count(), { timeout: 30_000 }).toBeGreaterThan(before);
  });
});
