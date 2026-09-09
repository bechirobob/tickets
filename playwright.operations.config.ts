import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'operations.spec.ts',
  use: { ...base.use, baseURL: 'https://127.0.0.1:8791', serviceWorkers: 'block', ignoreHTTPSErrors: true },
  webServer: {
    command: 'npx wrangler dev --config dist/server/wrangler.json --port 8791 --local-protocol https --local --persist-to .wrangler/state --var ENVIRONMENT:test --var STAFF_LOGIN_DECOY_SECRET:isolated-browser-login-decoy-secret-only',
    url: 'https://127.0.0.1:8791', reuseExistingServer: false, ignoreHTTPSErrors: true, timeout: 120_000,
  },
});
