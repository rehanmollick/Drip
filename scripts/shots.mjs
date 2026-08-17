import { chromium, devices } from "@playwright/test";
const out = "/private/tmp/claude-501/-Users-rehan-Documents-Drip/bb5feee4-6208-4b54-84d3-20ddd51e7068/scratchpad/shots";
const base = process.env.BASE ?? "http://localhost:3100";
const path = process.argv[2] ?? "/dev/cards";
const prefix = process.argv[3] ?? "dark";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 14 Pro"], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(base + path, { waitUntil: "networkidle" });
await page.waitForSelector("section.card", { timeout: 20000 });
const n = await page.locator("section.card").count();
console.log("slides:", n);
const feed = page.locator(".feed").first();
for (let i = 0; i < n; i++) {
  await page.evaluate((i) => { const f = document.querySelector(".feed"); const s = document.querySelectorAll("section.card")[i]; f.scrollTo({ top: s.offsetTop, behavior: "instant" }); }, i);
  await page.waitForTimeout(900);
  const type = await page.locator("section.card").nth(i).getAttribute("data-card-type");
  const kind = await page.locator("section.card").nth(i).getAttribute("data-slide-kind");
  await page.screenshot({ path: `${out}/${prefix}-${String(i).padStart(2, "0")}-${type ?? kind}.png` });
  // overflow check: any descendant wider than viewport or scrollable inner
  const ov = await page.evaluate((i) => {
    const s = document.querySelectorAll("section.card")[i];
    const bad = [];
    const r0 = s.getBoundingClientRect();
    s.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > r0.right + 1 || r.left < r0.left - 1 || r.bottom > r0.bottom + 1 || r.top < r0.top - 1) bad.push(el.tagName + "." + (el.className?.toString?.().slice(0, 40) ?? "") + ` [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
    });
    return bad.slice(0, 5);
  }, i);
  if (ov.length) console.log(`slide ${i} (${type}) overflow:`, ov);
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
