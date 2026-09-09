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
    baseURL: externalBaseUrl ?? "http://127.0.0.1:8788",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: externalBaseUrl ? undefined : {
    command: "npx wrangler dev --config dist/server/wrangler.json --port 8788 --local --persist-to .wrangler/state",
    url: "http://127.0.0.1:8788",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
