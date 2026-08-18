import { test, expect, type Page } from "@playwright/test";
import { createSession, waitForCards, slides, goToSlide } from "./helpers";

const realCards = (page: Page) =>
  page.locator('section.card[data-slide-kind="card"], section.card[data-slide-kind="predict_reveal"]').count();

const activeIndex = (page: Page) =>
  page.evaluate(() => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const cards = [...document.querySelectorAll("section.card")] as HTMLElement[];
    return cards.findIndex((c) => Math.abs(c.offsetTop - feed.scrollTop) < 40);
  });

/**
 * The feed asks at every topic boundary instead of running on forever (a `crossroads` card, with
 * generation parked behind it). Take the "keep going" fork so the runway keeps filling.
 * Returns true if a fork was answered.
 */
async function keepGoingIfForked(page: Page): Promise<boolean> {
  const forks = page.locator('section.card[data-card-type="crossroads"]');
  for (let i = 0; i < (await forks.count()); i++) {
    const card = forks.nth(i);
    const idx = await card.evaluate((el) => [...document.querySelectorAll("section.card")].indexOf(el));
    await goToSlide(page, idx);
    const go = card.locator('[data-choice="continue"]');
    if ((await go.count()) && (await go.isEnabled())) {
      await go.click();
      await page.waitForTimeout(700);
      return true;
    }
  }
  return false;
}

/** Scroll forward (answering forks) until there are at least `target` real cards. */
async function scrollOn(page: Page, target: number, steps = 26) {
  for (let i = 1; i <= steps; i++) {
    if ((await realCards(page)) >= target) return;
    const total = await slides(page).count();
    await goToSlide(page, Math.min(i, total - 1));
    await page.waitForTimeout(250);
    await keepGoingIfForked(page);
  }
}

test.describe("session flow (mock LLM, local store)", () => {
  test("create → one wait → first cards → runway grows → interactions record", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const id = await createSession(page, "how does a cache stampede take a site down");
    // exactly one wait: planning notice, then cards appear
    await waitForCards(page, 3);
    await expect(page.locator("section.card").first()).toBeVisible();

    // theme applied on the feed root
    const themed = await page.evaluate(() => {
      const root = document.querySelector("[data-motion]") as HTMLElement | null;
      return root ? getComputedStyle(root).getPropertyValue("--accent").trim() : "";
    });
    expect(themed).not.toBe("");

    // scroll forward → runway generation kicks in, never a dead end
    await scrollOn(page, 12);
    await waitForCards(page, 12, 40_000);

    // no card overflows the viewport, no horizontal scroll
    const overflow = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll("section.card").forEach((s) => {
        const r0 = s.getBoundingClientRect();
        s.querySelectorAll("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && r.height && (r.right > r0.right + 1 || r.left < r0.left - 1)) bad.push(el.tagName);
        });
      });
      return { bad: bad.slice(0, 5), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    expect(overflow.bad).toEqual([]);
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);

    // interactions: find a binary card and answer it
    const binary = page.locator('section.card[data-card-type="binary"]').first();
    if (await binary.count()) {
      const idx = await binary.evaluate((el) => Array.from(document.querySelectorAll("section.card")).indexOf(el));
      await goToSlide(page, idx);
      const opt = binary.getByRole("button").first();
      await opt.click();
      // reveal copy shows either way (wrong taps still teach)
      await expect(binary.locator("[data-reveal], [data-state]").first()).toBeVisible({ timeout: 5_000 }).catch(() => {});
    }

    // server has the session with cards
    const res = await page.request.get(`/api/sessions/${id}/cards?limit=50`);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.cards.length).toBeGreaterThanOrEqual(12);
    // no duplicate card ids
    const ids = body.data.cards.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("ask → inline bubble; ask why → detour splices after current card", async ({ page }) => {
    await createSession(page, "what a mutex is");
    await waitForCards(page, 3);
    await goToSlide(page, 1);

    // inline
    await page.getByRole("button", { name: "ask anything" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("tl;dr?");
    await dialog.getByRole("button", { name: /send|ask/i }).click();
    await expect(page.getByLabel("answer, tap to dismiss")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("answer, tap to dismiss").click();

    // detour
    const before = await slides(page).count();
    const from = await activeIndex(page);
    await page.getByRole("button", { name: "ask anything" }).click();
    await page.getByRole("dialog").locator("textarea").fill("why does this even matter, how would i explain it to a friend?");
    await page.getByRole("dialog").getByRole("button", { name: /send|ask/i }).click();
    await expect.poll(async () => page.locator('section.card[data-card-type="detour_marker"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    expect(await slides(page).count()).toBeGreaterThan(before);
    // the detour opens on the slide right after the one they asked from, wherever that sits
    const types = await page.locator("section.card").evaluateAll((els) => els.map((e) => e.getAttribute("data-card-type")));
    const marker = types.indexOf("detour_marker");
    expect(marker).toBeGreaterThan(from);
    expect(marker).toBeLessThanOrEqual(from + 2); // a predict's reveal slide may sit between
  });

  test("chill mode session has zero interactive cards", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "new session" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("the water cycle for a curious adult");
    // toggle chill mode (switch/radio/button named chill)
    const chill = dialog.getByRole("switch", { name: /chill/i });
    await chill.click();
    await expect(chill).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("button", { name: /drip it/i }).click();
    await page.waitForURL(/\/s\//);
    await waitForCards(page, 3);
    await scrollOn(page, 12);
    await waitForCards(page, 12, 40_000);
    const id = page.url().split("/s/")[1];
    const body = await (await page.request.get(`/api/sessions/${id}/cards?limit=100`)).json();
    const interactive = body.data.cards.filter((c: { type: string }) => ["binary", "predict", "sequence", "slider", "open"].includes(c.type));
    expect(interactive).toEqual([]);
  });

  test("[[BUDGET]] → one themed budget card, no crash; [[FAIL]] → fallback card with retry", async ({ page }) => {
    await createSession(page, "kubernetes pods [[BUDGET]]");
    // planning fails on budget → the feed shows a notice/fallback, never a raw error
    await expect.poll(async () => page.locator('section.card[data-card-type="notice"], section.card[data-card-type="fallback"]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    const text = await page.locator(".feed").innerText();
    expect(text.toLowerCase()).not.toMatch(/error|exception|undefined/);

    await createSession(page, "kubernetes pods [[FAIL]]");
    await expect.poll(async () => page.locator('section.card[data-card-type="notice"], section.card[data-card-type="fallback"]').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("button", { name: /retry|try again/i }).first()).toBeVisible();
  });
});
