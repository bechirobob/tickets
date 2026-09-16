import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Isolated UI verification only. These are deliberately invalid provider keys;
// the browser tests intercept initiation and never contact a payment service.
export default defineConfig({
  ...base,
  testMatch: "seevplus-checkout.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:8789", serviceWorkers: "block" },
  webServer: {
    command: "node scripts/browser-worker.mjs seev",
    url: "http://127.0.0.1:8789",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
