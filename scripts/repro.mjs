import { webkit, devices } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3100";
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14 Pro"], viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (/\[feed\]|\[llm\]|\[engine\]/.test(m.text())) console.log("  console:", m.text().slice(0, 120)); });

await page.goto(base + "/");
await page.getByRole("button", { name: "new session" }).click();
await page.getByRole("dialog").locator("textarea").fill("how a cache stampede takes a site down");
await page.getByRole("dialog").getByRole("button", { name: /drip it/i }).click();
await page.waitForURL(/\/s\//, { timeout: 30000 });
await page.waitForSelector("section.card", { timeout: 60000 });
console.log("landed on the feed while it plans");

const snap = () => page.evaluate(() => {
  const feed = document.querySelector(".feed");
  const cards = [...document.querySelectorAll("section.card")];
  const i = cards.findIndex((c) => Math.abs(c.offsetTop - feed.scrollTop) < 40);
  return {
    scrollTop: feed.scrollTop,
    activeIndex: i,
    activeKey: i >= 0 ? cards[i].getAttribute("data-slide-key") : null,
    activeType: i >= 0 ? cards[i].getAttribute("data-card-type") : null,
    keys: cards.map((c) => c.getAttribute("data-slide-key")),
  };
});

// scroll to the last card that exists right now (during planning that's the notice)
await page.evaluate(() => {
  const feed = document.querySelector(".feed");
  const cards = [...document.querySelectorAll("section.card")];
  const last = cards[Math.min(cards.length - 1, 2)];
  if (last) feed.scrollTo({ top: last.offsetTop, behavior: "instant" });
});
await page.waitForTimeout(800);
let prev = await snap();
console.log(`t=0  index ${prev.activeIndex} key ${prev.activeKey} (${prev.activeType})  total ${prev.keys.length}`);

for (let t = 5; t <= 60; t += 5) {
  await page.waitForTimeout(5000);
  const cur = await snap();
  const changed = cur.activeKey !== prev.activeKey;
  const grewAbove = cur.keys.indexOf(prev.activeKey) !== prev.activeIndex;
  if (changed || grewAbove || cur.keys.length !== prev.keys.length) {
    console.log(`t=${t}s index ${cur.activeIndex} key ${cur.activeKey} (${cur.activeType}) total ${cur.keys.length}` +
      (changed ? "   ⚠️  CARD UNDER THUMB CHANGED" : "") +
      (grewAbove && !changed ? `   ⚠️  position of my card moved ${prev.activeIndex}→${cur.keys.indexOf(prev.activeKey)}` : ""));
    prev = cur;
  }
}
console.log("done");
await browser.close();
