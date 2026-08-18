import { test, expect, type Page } from "@playwright/test";

/**
 * The v2 card views (stat / open / crossroads / wrap) and the inline glossary, on the static
 * showcase deck (/dev/cards, no network). Prime-directive fit + banned words for these cards are
 * covered by e2e/prime-directive.spec.ts, which walks every slide of the same deck; this spec is
 * about behaviour.
 */

async function goToType(page: Page, type: string) {
  await page.evaluate((t) => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const s = [...document.querySelectorAll("section.card")].find(
      (x) => (x as HTMLElement).dataset.cardType === t,
    ) as HTMLElement | undefined;
    if (feed && s) feed.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior });
  }, type);
  await page.waitForTimeout(500);
}

test.describe("v2 cards: stat, open, crossroads, wrap, inline glossary", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
  });

  test("stat card renders one huge number with its scale", async ({ page }) => {
    await goToType(page, "stat");
    const card = page.locator('section.card[data-card-type="stat"]');
    await expect(card).toHaveCount(1);
    const value = card.locator("[data-stat-value]");
    await expect(value).toBeVisible();
    const fs = await value.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(64);          // the number IS the card
    await expect(card.locator("[data-stat-compare]")).toBeVisible();
  });

  test("glossary: tapping an underlined term opens a chip, tapping away closes it", async ({ page }) => {
    // the stat card's context carries a term; slides are windowed, so scroll by card type
    await goToType(page, "stat");
    const card = page.locator('section.card[data-card-type="stat"]');
    const term = card.locator("[data-gloss-term]").first();
    await expect(term).toBeVisible();
    const deco = await term.evaluate((el) => getComputedStyle(el).textDecorationStyle);
    expect(deco).toBe("dotted");
    await term.click();
    const chip = card.locator("[data-gloss-chip]");
    await expect(chip).toBeVisible();
    // the chip stays inside the phone
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(393);
    expect(box!.y + box!.height).toBeLessThanOrEqual(852);
    await page.mouse.click(196, 90);
    await expect(chip).toHaveCount(0);
  });

  test("open card: type an answer, send it, and the card leaves the idle state", async ({ page }) => {
    await goToType(page, "open");
    const card = page.locator('section.card[data-card-type="open"]');
    const input = card.locator("[data-open-input]");
    await expect(input).toBeVisible();
    await input.fill("it keeps the answer in memory so the database only gets asked once");
    await card.getByRole("button", { name: "send it" }).click();
    // what they wrote is quoted back, compactly
    await expect(card.locator("[data-open-said]")).toBeVisible({ timeout: 5_000 });
    await expect(input).toHaveCount(0);
    // no grader wired in staticMode → the model answer is handed over instead of a fake grade
    await expect(card.locator("[data-open-model]")).toBeVisible({ timeout: 5_000 });
  });

  test("open card: 'just show me' reveals the answer without grading", async ({ page }) => {
    await goToType(page, "open");
    const card = page.locator('section.card[data-card-type="open"]');
    await card.getByRole("button", { name: "just show me" }).click();
    await expect(card.locator("[data-open-model]")).toBeVisible();
    await expect(card.locator("[data-open-said]")).toHaveCount(0);   // nothing was graded
    await expect(card.locator("[data-open-input]")).toBeVisible();   // they can still answer
  });

  test("crossroads: picking a direction locks the fork and names what's next", async ({ page }) => {
    await goToType(page, "crossroads");
    const card = page.locator('section.card[data-card-type="crossroads"]');
    await expect(card.locator('[data-choice="continue"]')).toContainText("next up");
    const deeper = card.locator('[data-choice="deeper"]');
    await deeper.click();
    await expect(deeper).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator('[data-choice="continue"]')).toBeDisabled();
    await expect(card.getByText(/going deeper/i)).toBeVisible();
  });

  test("wrap card ends the thread with beats and an open thread", async ({ page }) => {
    await goToType(page, "wrap");
    const card = page.locator('section.card[data-card-type="wrap"]');
    const beats = card.locator("[data-wrap-beats] li");
    const n = await beats.count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    await expect(card.locator("[data-wrap-open-thread]")).toBeVisible();
  });

  test("reduced motion: the new cards still show their content", async ({ browser }) => {
    const ctx = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const page = await ctx.newPage();
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    for (const type of ["stat", "crossroads", "wrap"]) {
      await goToType(page, type);
      const opacity = await page
        .locator(`section.card[data-card-type="${type}"]`)
        .locator("h1, h2, [data-stat-value]")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).opacity));
      expect(opacity, type).toBeGreaterThan(0.9);
    }
    await ctx.close();
  });
});
