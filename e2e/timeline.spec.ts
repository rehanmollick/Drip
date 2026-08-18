import { test, expect, type Page } from "@playwright/test";
import { createSession, goToSlide, slides, waitForCards } from "./helpers";

/** Press and hold an element (pointer events; iOS Safari has no contextmenu on touch). */
async function longPress(page: Page, selector: string, ms = 800) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.max(2, box.height - 4));
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const segmentStates = (page: Page) =>
  page.locator('[data-testid="timeline"] [data-segment]').evaluateAll((els) => els.map((e) => e.getAttribute("data-segment")));

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

test.describe("timeline", () => {
  test("one segment per topic, in order, filling where you are — and never a number", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");

    const segs = page.locator('[data-testid="timeline"] [data-segment]');
    await expect(segs).toHaveCount(4);

    await goToSlide(page, 0);
    expect(await segmentStates(page)).toEqual(["current", "ahead", "ahead", "ahead"]);

    await goToSlide(page, 18);
    expect(await segmentStates(page)).toEqual(["done", "done", "current", "ahead"]);

    await goToSlide(page, 22);
    expect(await segmentStates(page)).toEqual(["done", "done", "done", "current"]);

    // the bar is a hairline pinned to the top, below any safe-area inset, and carries no digits
    const box = await page.locator('[data-testid="timeline"] [data-segment]').first().boundingBox();
    expect(box!.height).toBeLessThanOrEqual(4);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(40);
    expect(await page.locator('[data-testid="timeline"]').innerText()).not.toMatch(/\d/);
    expect(errors).toEqual([]);
  });

  test("a detour reads as off the main thread on the current segment", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    const detour = page.locator('section.card[data-card-type="detour_marker"]').first();
    const idx = await detour.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
    await goToSlide(page, idx + 1); // inside the detour, not on the marker
    await expect(page.locator('[data-testid="timeline"] [data-segment][data-detour="true"]')).toHaveCount(1);
    await goToSlide(page, 0);
    await expect(page.locator('[data-testid="timeline"] [data-detour="true"]')).toHaveCount(0);
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

test.describe("session map", () => {
  test("long-press the timeline → the thread, with where you are marked", async ({ page }) => {
    await page.goto("/dev/timeline");
    await page.waitForSelector("section.card");
    await goToSlide(page, 18); // third topic; the first two are behind us and seen

    await longPress(page, '[data-testid="timeline"]');
    const sheet = page.getByRole("dialog", { name: "the thread" });
    await expect(sheet).toBeVisible();

    const rows = page.locator("[data-map-row]");
    await expect(rows.filter({ hasText: "why a cache exists at all" })).toHaveCount(1);
    await expect(page.locator('[data-map-row="current"]')).toHaveCount(1);
    await expect(page.locator("[data-branch]")).toHaveCount(1); // the detour hangs off its topic
    await expect(sheet).toContainText("you’re here");
    // nothing in the sheet is a counter
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
    await longPress(page, '[data-testid="timeline"]');
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
    // exactly when we say so (the server's own frontier is irrelevant to this test)
    let held = true;
    await page.route("**/api/sessions/*/generate", async (route) => {
      const data = held
        ? { batch: { id: "held", status: "done", frontierKey: "held", reason: "superseded" }, cards: [] }
        : { batch: { id: "landed", status: "done", frontierKey: "landed" }, cards: later };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data, error: null, meta: {} }) });
    });

    // walk to the end until the "catching up" placeholder is the card under the thumb
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

test.describe("what the bar costs to keep honest", () => {
  test("scrolling for 20s never re-reads the session", async ({ page }) => {
    // Every GET /api/sessions/:id is a full card scan plus a session read, and a bar kept live on a
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

    const cross = page.locator('section.card[data-card-type="crossroads"]').first();
    const idx = await cross.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
    await goToSlide(page, idx);
    const before = await slides(page).count();

    const [req] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/choose")),
      cross.locator('[data-choice="continue"]').click(),
    ]);
    expect(JSON.parse(req.postData() ?? "{}").choice).toBe("continue");
    await expect.poll(async () => slides(page).count(), { timeout: 30_000 }).toBeGreaterThan(before);
  });
});

/** Widths of the two bands inside one segment, in px — what the reader can actually see. */
async function bands(page: Page, seg: number) {
  const track = page.locator('[data-testid="timeline"] [data-segment]').nth(seg);
  const read = await track.locator('[data-band="read"]').boundingBox();
  const buffered = await track.locator('[data-band="buffered"]').boundingBox();
  return { read: Math.round(read?.width ?? -1), buffered: Math.round(buffered?.width ?? -1) };
}

test.describe("the bar tells written apart from planned", () => {
  test("a topic ahead of you shows what is already written, and one that is only a heading shows nothing", async ({ page }) => {
    await page.goto("/dev/timeline?state=buffered");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-testid="timeline"] [data-segment]')).toHaveCount(4);
    // deep into the second topic, so the current segment has read behind it and runway in front
    await goToSlide(page, Math.floor((await slides(page).count()) * 0.75));
    await expect(page.locator('[data-testid="timeline"] [data-segment="current"]')).toHaveCount(1);

    // the topic the reader is in: written runway sitting ahead of where they've read to
    const here = await bands(page, 1);
    expect(here.buffered).toBeGreaterThan(here.read);
    expect(here.read).toBeGreaterThan(0);

    // one they have not reached: 4 cards counted by the server, none of them read
    const ahead = await bands(page, 2);
    expect(ahead.read).toBe(0);
    expect(ahead.buffered).toBeGreaterThan(ahead.read);

    // and one that is nothing but a heading so far — a bare track, no promise on it
    expect(await bands(page, 3)).toEqual({ read: 0, buffered: 0 });

    // still not a digit anywhere on it
    expect(await page.locator('[data-testid="timeline"]').innerText()).not.toMatch(/\d/);
  });

  test("exactly one nib, on the topic being written right now", async ({ page }) => {
    await page.goto("/dev/timeline?state=live");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-live="true"]')).toHaveCount(1);
    const on = await page.locator('[data-testid="timeline"] [data-segment]')
      .evaluateAll((els) => els.findIndex((e) => !!e.querySelector('[data-live="true"]')));
    expect(on).toBe(2);
  });

  test("a fork pulses nothing and dims everything past it", async ({ page }) => {
    await page.goto("/dev/timeline?state=gate");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-live="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="timeline"] [data-segment][data-gate="crossroads"]')).toHaveCount(1);
    const dim = await page.locator('[data-testid="timeline"] [data-segment]')
      .evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
    // the fork's own segment reads normally; the two behind it too. everything downstream fades.
    expect(dim.slice(0, 2).every((o) => o === 1)).toBe(true);
    expect(dim.slice(2).every((o) => o < 1)).toBe(true);
  });
});

test.describe("the bar under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the nib is still there and nothing on the bar is animating", async ({ page }) => {
    await page.goto("/dev/timeline?state=live");
    await page.waitForSelector("section.card");
    await expect(page.locator('[data-live="true"]')).toHaveCount(1);
    await expect
      .poll(async () =>
        page.evaluate(() =>
          [document.querySelector('[data-testid="timeline"]')!, ...document.querySelectorAll('[data-testid="timeline"] *')]
            .reduce((n, el) => n + el.getAnimations().length, 0),
        ),
      )
      .toBe(0);
  });
});
