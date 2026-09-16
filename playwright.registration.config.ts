import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'registration.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:8790', serviceWorkers: 'block' },
  webServer: {
    command: 'node scripts/browser-worker.mjs registration',
    url: 'http://127.0.0.1:8790', reuseExistingServer: false, timeout: 120_000,
  },
});
