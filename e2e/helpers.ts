import { expect, type Page } from "@playwright/test";

/** Create a session from the home sheet and land on the feed. Returns the session id. */
export async function createSession(page: Page, input: string, opts: { chill?: boolean } = {}) {
  await page.goto("/");
  await page.getByRole("button", { name: "new session" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill(input);
  if (opts.chill) await dialog.getByRole("switch", { name: /chill/i }).click().catch(() => {});
  await dialog.getByRole("button", { name: /drip it/i }).click();
  await page.waitForURL(/\/s\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const id = page.url().split("/s/")[1].split(/[?#]/)[0];
  return id;
}

/** Wait until at least n real (non-pseudo) card slides are rendered. */
export async function waitForCards(page: Page, n: number, timeout = 30_000) {
  await expect
    .poll(async () => page.locator('section.card[data-slide-kind="card"], section.card[data-slide-kind="predict_reveal"]').count(), { timeout })
    .toBeGreaterThanOrEqual(n);
}

export function slides(page: Page) {
  return page.locator("section.card");
}

/** Snap-scroll the feed to slide i (instant) and wait for it to become active. */
export async function goToSlide(page: Page, i: number) {
  await page.evaluate((i) => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const s = document.querySelectorAll("section.card")[i] as HTMLElement | undefined;
    if (feed && s) feed.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior });
  }, i);
  await page.waitForTimeout(350);
}

export async function activeSlideIndex(page: Page) {
  return page.evaluate(() => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const all = Array.from(document.querySelectorAll("section.card")) as HTMLElement[];
    let best = 0, bestD = Infinity;
    all.forEach((s, i) => { const d = Math.abs(s.offsetTop - feed.scrollTop); if (d < bestD) { bestD = d; best = i; } });
    return best;
  });
}
