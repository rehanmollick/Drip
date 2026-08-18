import { test, expect, type Page } from "@playwright/test";

/**
 * scrub and spot, driven at their SCHEMA MAXIMUMS (/dev/cards/worst — 6 frames of 100-char
 * captions, 7 pieces of 48-char code with 120-char notes). prime-directive.spec.ts walks the
 * showcase deck idle; the thing that can only break here is the shape these two cards take AFTER
 * the reader touches them — the caption swaps under the meter, the note and the payoff share one
 * reserved slot. If either grows the card, the slide starts scrolling inside itself.
 */

const SCRUB_STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1];

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

/** The slide still fits its own viewport and nothing pokes out of it. */
async function fits(page: Page, type: string) {
  return page.evaluate((t) => {
    const s = [...document.querySelectorAll("section.card")].find(
      (x) => (x as HTMLElement).dataset.cardType === t,
    ) as HTMLElement;
    const box = s.getBoundingClientRect();
    const out: string[] = [];
    s.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1)
        out.push(`${el.tagName}.${(el as HTMLElement).className}`.slice(0, 60));
    });
    return { out, scrolls: s.scrollHeight > s.clientHeight + 1 };
  }, type);
}

test.describe("scrub + spot at their schema maximums", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/cards/worst");
    await page.waitForSelector("section.card");
  });

  test("scrub: every stop swaps the caption and the card never grows", async ({ page }) => {
    await goToType(page, "scrub");
    const card = page.locator('section.card[data-card-type="scrub"]');
    const track = card.locator("[data-scrub-track]");
    const box = (await track.boundingBox())!;
    const seen = new Set<string>();
    for (const at of SCRUB_STOPS) {
      await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
      await page.waitForTimeout(450);
      seen.add((await card.locator("[data-scrub-frame]").innerText()).trim());
      const f = await fits(page, "scrub");
      expect(f.out, `overflow at ${at}: ${f.out.join(", ")}`).toEqual([]);
      expect(f.scrolls, `scrolls inside itself at ${at}`).toBe(false);
    }
    expect(seen.size).toBeGreaterThan(1);           // the meter actually moves between stops
  });

  test("spot: misses keep the hunt open, the hit closes it, and neither grows the card", async ({ page }) => {
    await goToType(page, "spot");
    const card = page.locator('section.card[data-card-type="spot"]');
    const pieces = card.locator("[data-spot-piece]");
    // the ruler carries the schema maximum, which is what makes this the fit test that matters
    await expect(pieces).toHaveCount(6);
    const last = 5;

    // the ruler's hit is piece 3, so 0..2 are misses: each strikes itself out and leaves the rest live
    for (const k of [0, 1, 2]) {
      await pieces.nth(k).click();
      await page.waitForTimeout(700);
      await expect(pieces.nth(k)).toBeDisabled();
      await expect(pieces.nth(last)).toBeEnabled();
      const f = await fits(page, "spot");
      expect(f.out, `overflow after miss ${k}: ${f.out.join(", ")}`).toEqual([]);
      expect(f.scrolls, `scrolls inside itself after miss ${k}`).toBe(false);
    }

    await pieces.nth(3).click();
    await page.waitForTimeout(900);
    for (let k = 0; k <= last; k++) await expect(pieces.nth(k)).toBeDisabled();
    const f = await fits(page, "spot");
    expect(f.out, `overflow after the hit: ${f.out.join(", ")}`).toEqual([]);
    expect(f.scrolls, "scrolls inside itself after the hit").toBe(false);
  });
});
