import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "input-modality.spec.ts",
  outputDir: "test-results/input-modality", reporter: "line",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], channel: "chromium" } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
