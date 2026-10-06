import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Offline production email rendering needs neither an application server nor D1.
export default defineConfig({
  ...base,
  testDir: './tests/email-preview',
  outputDir: 'test-results/customer-email-preview',
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: { ...base.use, baseURL: undefined, serviceWorkers: 'block', trace: 'off', screenshot: 'off' },
  webServer: undefined,
});
