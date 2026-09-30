import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Local non-test event with production-shaped configuration and invalid keys.
// The browser intercepts all payment initiation: no payment service is contacted.
export default defineConfig({
  ...base,
  testMatch: "seevplus-crypto-checkout.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:8792", serviceWorkers: "block" },
  webServer: {
    command: "node scripts/browser-worker.mjs seevCrypto",
    url: "http://127.0.0.1:8792",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
