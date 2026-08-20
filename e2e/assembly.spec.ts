import { test, expect, type Page } from "@playwright/test";

/**
 * The deck assembles — and assembling is only ever allowed to change WHEN
 * something appears, never where it sits.
 *
 * The one invariant everything here defends: text inside a paragraph or a
 * headline animates OPACITY ONLY. A transform on an inline span can push a line
 * past the edge of a 393px screen mid-flight, and a card that overflowed for
 * 200ms is still a card that overflowed. Block-level children may move in y;
 * anything living inside a <p>/<h1>/<h2> may not.
 */

const DECKS = ["/dev/cards", "/dev/cards/worst"];

async function goToSlide(page: Page, i: number) {
  await page.evaluate((i) => {
    const feed = document.querySelector(".feed") as HTMLElement;
    const s = document.querySelectorAll("section.card")[i] as HTMLElement | undefined;
    if (feed && s) feed.scrollTo({ top: s.offsetTop, behavior: "instant" as ScrollBehavior });
  }, i);
  await page.waitForTimeout(450);
}

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

test.describe("cards assemble instead of appearing", () => {
  for (const deck of DECKS) {
    test(`nothing inside a paragraph or a headline is ever transformed — ${deck}`, async ({ page }) => {
      await page.goto(deck);
      await page.waitForSelector("section.card");
      const n = await page.locator("section.card").count();
      let checked = 0;

      for (let i = 0; i < n; i++) {
        await goToSlide(page, i);
        const bad = await page.evaluate((i) => {
          const slide = document.querySelectorAll("section.card")[i] as HTMLElement;
          const out: string[] = [];
          let seen = 0;
          slide.querySelectorAll("p, h1, h2").forEach((block) => {
            block.querySelectorAll("*").forEach((el) => {
              seen++;
              const t = getComputedStyle(el).transform;
              if (t !== "none") out.push(`${el.tagName}.${(el as HTMLElement).dataset.beat ?? ""} → ${t}`);
            });
          });
          // and while we're on the slide: it still owns exactly one screen
          const box = slide.getBoundingClientRect();
          let over = 0;
          slide.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1) over++;
          });
          return { out, seen, over, scrollable: slide.scrollHeight > slide.clientHeight + 1 };
        }, i);
        expect(bad.out, `slide ${i} moved inline text`).toEqual([]);
        expect(bad.over, `slide ${i} overflows its screen`).toBe(0);
        expect(bad.scrollable, `slide ${i} scrolls internally`).toBe(false);
        checked += bad.seen;
      }
      // the assertion is only worth anything if the deck actually has inline pieces
      expect(checked).toBeGreaterThan(20);
    });
  }

  test("sentence pieces are never left invisible under reduced motion", async ({ browser }) => {
    test.slow(); // walks every slide of both decks at ~1s each — the worst deck now carries a ruler per diagram variant
    const ctx = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    const page = await ctx.newPage();
    for (const deck of DECKS) {
      await page.goto(deck);
      await page.waitForSelector("section.card");
      const n = await page.locator("section.card").count();
      let seen = 0;
      for (let i = 0; i < n; i++) {
        await goToSlide(page, i);
        await page.waitForTimeout(600);
        const opacities = await page.evaluate((i) => {
          const slide = document.querySelectorAll("section.card")[i] as HTMLElement;
          return [...slide.querySelectorAll("[data-beat]")].map((el) => parseFloat(getComputedStyle(el).opacity));
        }, i);
        for (const o of opacities) expect(o, `${deck} slide ${i} sentence left faded`).toBeGreaterThanOrEqual(0.9);
        seen += opacities.length;
      }
      expect(seen, `${deck} rendered no sentence pieces`).toBeGreaterThan(0);
    }
    await ctx.close();
  });

  test("code: opening an annotation pulls focus to that line", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    await goToType(page, "code");
    const card = page.locator('section.card[data-card-type="code"]').first();
    const rows = card.locator("[data-code-block] > div");
    const before = await rows.first().locator("> span").evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(before)).toBeGreaterThan(0.9);
    await card.locator("[data-annotated]").first().click();
    await page.waitForTimeout(300);
    const after = await rows.first().locator("> span").evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(after)).toBeLessThan(0.6);   // every other line steps back
  });

  test("slider: the expression is drawn as a curve above the track", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    await goToType(page, "slider");
    const card = page.locator('section.card[data-card-type="slider"]').first();
    const curve = card.locator("[data-curve] polyline");
    await expect(curve).toBeVisible();
    const pts = await curve.getAttribute("points");
    expect((pts ?? "").split(" ").length).toBeGreaterThan(10);
    // the output still tracks the slider
    await card.locator("input[type=range]").fill("50");
    await expect(card.locator("[data-output]")).toContainText("500", { timeout: 4000 });
  });

  test("recap: the beats are strung together, and the numbers arrive whole", async ({ page }) => {
    await page.goto("/dev/cards");
    await page.waitForSelector("section.card");
    await goToType(page, "recap");
    await expect(page.locator('section.card[data-card-type="recap"] [data-beat-link]')).toHaveCount(2);

    await goToType(page, "stat");
    const stat = page.locator('section.card[data-card-type="stat"] [data-stat-value]');
    await expect(stat).toHaveText(/0\.2/, { timeout: 4000 });   // lands on the authored string
  });

  test("diagrams: every variant earns the card's full height at schema max", async ({ page }) => {
    // the squish regression: the drawing clustered in the top half of the card and node
    // gaps collapsed. Each worst-deck ruler (8 nodes / 12 labelled edges) must spread its
    // nodes across most of a tall drawing area and keep every node a real tap target.
    await page.goto("/dev/cards/worst");
    await page.waitForSelector("section.card");
    const idx: number[] = await page.evaluate(() =>
      [...document.querySelectorAll("section.card")].flatMap((s, i) => ((s as HTMLElement).dataset.cardType === "diagram" ? [i] : [])),
    );
    expect(idx.length).toBe(6); // one ruler per variant
    const seen: string[] = [];
    for (const i of idx) {
      await goToSlide(page, i);
      await page.waitForTimeout(800);
      const d = await page.evaluate((i) => {
        const slide = document.querySelectorAll("section.card")[i] as HTMLElement;
        const el = slide.querySelector("[data-diagram]") as HTMLElement;
        const box = el.getBoundingClientRect();
        const nodes = [...el.querySelectorAll("[data-node-id]")].map((n) => n.getBoundingClientRect());
        const top = Math.min(...nodes.map((r) => r.top));
        const bottom = Math.max(...nodes.map((r) => r.bottom));
        return {
          variant: el.dataset.diagram!,
          boxH: box.height,
          nodeCount: nodes.length,
          minNodeH: Math.min(...nodes.map((r) => r.height)),
          spread: (bottom - top) / box.height,
        };
      }, i);
      seen.push(d.variant);
      expect(d.nodeCount, `${d.variant} nodes`).toBe(8);
      expect(d.boxH, `${d.variant} drawing area`).toBeGreaterThan(380);      // the fill-height fix
      expect(d.spread, `${d.variant} vertical spread`).toBeGreaterThan(0.6); // no top-clustering
      expect(d.minNodeH, `${d.variant} tap target`).toBeGreaterThanOrEqual(40);
    }
    expect(seen.sort()).toEqual(["boxes", "compare", "cycle", "flow", "layers", "timeline"]);
  });
});
