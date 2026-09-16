import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'operations.spec.ts',
  use: { ...base.use, baseURL: 'https://127.0.0.1:8791', serviceWorkers: 'block', ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/browser-worker.mjs operations',
    url: 'https://127.0.0.1:8791', reuseExistingServer: false, ignoreHTTPSErrors: true, timeout: 120_000,
  },
});
