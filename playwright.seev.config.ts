import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Isolated UI verification only. These are deliberately invalid provider keys;
// the browser tests intercept initiation and never contact a payment service.
export default defineConfig({
  ...base,
  testMatch: "seevplus-checkout.spec.ts",
  use: { ...base.use, baseURL: "http://127.0.0.1:8789", serviceWorkers: "block" },
  webServer: {
    command: "npx wrangler dev --config dist/server/wrangler.json --port 8789 --local --persist-to .wrangler/state --var ENVIRONMENT:test --var PAYSTACK_SECRET_KEY:sk_test_ui_fixture --var SEEV_ENABLED:true --var SEEV_ENVIRONMENT:sandbox --var SEEV_CHECKOUT_API_KEY:ui-test-only --var SEEV_WEBHOOK_SECRET:ui-test-only",
    url: "http://127.0.0.1:8789",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
