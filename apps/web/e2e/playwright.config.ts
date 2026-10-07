import { defineConfig, devices } from "@playwright/test";

// Spike (prototype/uat-e2e): UAT cases as browser tests against a running demo.
// Start the demo first (`pnpm demo`); E2E_BASE_URL defaults to lane 1's web port.
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../e2e-report" }]],
  outputDir: "../e2e-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    video: "on",
    trace: "on",
    screenshot: "on",
    viewport: { width: 1366, height: 820 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 820 } } }],
});
