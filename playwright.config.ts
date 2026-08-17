import { defineConfig, devices } from "@playwright/test";

/**
 * Inner-loop device testing: headless iPhone viewport 393×852 @3x.
 * Runs against `next dev` with LLM_MODE=mock and the local JSON store so no
 * API key / Supabase is needed. Standalone-PWA scroll feel is NOT verifiable
 * here — see MANUAL_CHECKLIST.md.
 *
 * Server reuse: outside CI a server already listening on PW_PORT (default 3100)
 * is reused — convenient for the mock dev server most of us keep running, but
 * note that the specs then run against THAT server's env and data dir
 * (e.g. .data/dev), not the .data/e2e store below. For an isolated run pick a
 * free port or force a fresh server:
 *   PW_PORT=3199 pnpm exec playwright test        # own server on 3199, .data/e2e
 *   PW_FRESH=1 pnpm exec playwright test          # never reuse; fails if 3100 is taken
 * `next dev` shares .next/ per checkout, so only run ONE dev server per
 * checkout at a time (or set PW_BASE_URL to a server you started elsewhere).
 */
const port = Number(process.env.PW_PORT ?? 3100);
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${port}`;
const reuse = !process.env.CI && process.env.PW_FRESH !== "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["iPhone 14 Pro"],
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: `LLM_MODE=mock DRIP_STORE=local DRIP_DATA_DIR=.data/e2e NEXT_PUBLIC_SW=0 pnpm exec next dev -p ${port}`,
        url: baseURL,
        reuseExistingServer: reuse,
        timeout: 120_000,
      },
});
