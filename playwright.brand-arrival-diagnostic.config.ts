import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'brand-arrival-diagnostic.spec.ts',
  workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'mobile-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } }],
});
