import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Local fixture journeys share one workerd process and D1 database.
  // Keep hosted-runner traffic serial; concurrent runs intermittently killed that process.
  workers: process.env.CI && !externalBaseUrl ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    extraHTTPHeaders: { "x-becore-analytics": "exclude" },
    baseURL: externalBaseUrl ?? "http://127.0.0.1:8788",
    // Production deliberately disables retries; retain its first failure too.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Full Chromium's current headless mode avoids the separate headless shell
    // that repeatedly segfaulted during context creation in production audits.
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], channel: "chromium" } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: externalBaseUrl ? undefined : {
    command: "node scripts/browser-worker.mjs public",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
