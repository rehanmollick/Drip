import { defineConfig, devices } from "@playwright/test";

/**
 * Inner-loop device testing: headless iPhone viewport 393×852 @3x.
 * Runs against `next dev` with LLM_MODE=mock and the local JSON store so no
 * API key / Supabase is needed. Standalone-PWA scroll feel is NOT verifiable
 * here — see MANUAL_CHECKLIST.md.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["iPhone 14 Pro"],
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: "LLM_MODE=mock DRIP_STORE=local DRIP_DATA_DIR=.data/e2e NEXT_PUBLIC_SW=0 pnpm exec next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
