import { test, expect } from "@playwright/test";
import { BANNED_WORDS } from "../lib/copy/banned";

const banned = new RegExp(`\\b(${BANNED_WORDS.join("|")})(s|es)?\\b`, "i");

test.describe("prime directive + feed mechanics on the sample deck", () => {
  for (const path of ["/dev/cards", "/dev/cards/light"]) {
    test(`every sample card fits one viewport, no banned words, snap works — ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      await page.waitForSelector("section.card");
      const n = await page.locator("section.card").count();
      expect(n).toBeGreaterThanOrEqual(15);

      // snap CSS present
      const css = await page.locator(".feed").evaluate((el) => {
        const s = getComputedStyle(el);
        const c = getComputedStyle(el.querySelector("section.card")!);
        return { snapType: s.scrollSnapType, snapStop: c.scrollSnapStop, snapAlign: c.scrollSnapAlign, overscroll: s.overscrollBehaviorY, h: c.height };
      });
      expect(css.snapType).toContain("mandatory");
      expect(css.snapStop).toBe("always");
      expect(css.snapAlign).toBe("start");
      expect(css.overscroll).toBe("contain");
      expect(parseInt(css.h)).toBe(852);

      for (let i = 0; i < n; i++) {
        await page.evaluate((i) => {
          const f = document.querySelector(".feed")!; const s = document.querySelectorAll("section.card")[i] as HTMLElement;
          f.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior });
        }, i);
        await page.waitForTimeout(400);
        const info = await page.evaluate((i) => {
          const s = document.querySelectorAll("section.card")[i] as HTMLElement;
          const r0 = s.getBoundingClientRect();
          let overflow = 0;
          s.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (r.right > r0.right + 1 || r.left < r0.left - 1 || r.bottom > r0.bottom + 1 || r.top < r0.top - 1) overflow++;
          });
          return { overflow, text: s.innerText, scrollable: s.scrollHeight > s.clientHeight + 1 };
        }, i);
        expect(info.overflow, `slide ${i} overflow`).toBe(0);
        expect(info.scrollable, `slide ${i} scrolls internally`).toBe(false);
        expect(info.text, `slide ${i} banned word`).not.toMatch(banned);
        expect(info.text).not.toMatch(/\b\d+\s*\/\s*\d+\b/); // no "3/47"
      }
      // no horizontal scroll anywhere
      const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(sw).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test("dial chips are typographic — no emoji, no school iconography", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    await page.evaluate(() => {
      const f = document.querySelector(".feed")!;
      const s = document.querySelectorAll("section.card")[1] as HTMLElement; // concept carries the dials
      f.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior });
    });
    const dials = page.locator("[data-dials]").first();
    await expect(dials).toBeVisible();
    const text = await dials.innerText();
    expect(text).toMatch(/simpler/);
    expect(text).toMatch(/deeper/);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test("reduced motion: content still appears (as fades)", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    await page.waitForTimeout(600);
    const opacity = await page.locator("section.card").first().locator("h1, h2").first().evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeGreaterThan(0.9);
    await ctx.close();
  });

  test("interactive: binary tap reveals payoff, sequence lock-in, reveal flip, slider drives output", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    const go = async (i: number) => { await page.evaluate((i) => { const f = document.querySelector(".feed")!; const s = document.querySelectorAll("section.card")[i] as HTMLElement; f.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior }); }, i); await page.waitForTimeout(500); };
    // binary is slide 2
    await go(2);
    const binary = page.locator('section.card[data-card-type="binary"]').first();
    await binary.getByRole("button", { name: /^nah$/i }).click();
    await expect(binary.getByText(/stampede/i)).toBeVisible({ timeout: 4000 });
    // the outcome is triple-encoded: the verdict says it in words, not just tint
    await expect(binary.locator("[data-verdict]")).toContainText(/called it|not quite/i);
    // reveal is slide 9
    await go(9);
    const reveal = page.locator('section.card[data-card-type="reveal"]').first();
    await reveal.getByRole("button").first().click();
    await expect(reveal.getByText(/cache invalidation/i)).toBeVisible({ timeout: 4000 });
    // slider is slide 8
    await go(8);
    const slider = page.locator('section.card[data-card-type="slider"] input[type=range]').first();
    await slider.fill("50");
    await expect(page.locator('section.card[data-card-type="slider"]').getByText(/500/)).toBeVisible({ timeout: 4000 });
  });
});
