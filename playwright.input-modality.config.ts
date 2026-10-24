import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "input-modality.spec.ts",
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  outputDir: "test-results/input-modality", reporter: "line",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], channel: "chromium" } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
