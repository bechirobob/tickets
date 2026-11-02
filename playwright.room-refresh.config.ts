import { defineConfig } from '@playwright/test';
import config from './playwright.config';
const engine = process.env.CUSTOMER_BROWSER;
if (engine !== 'chromium' && engine !== 'webkit') throw new Error('Exact diagnostic engine required');
const out = process.env.CUSTOMER_EVIDENCE_DIR;
if (!out) throw new Error('Diagnostic evidence directory required');
export default defineConfig({ ...config, webServer: undefined, outputDir: `${out}/browser`,
  reporter: [['list'], ['json', { outputFile: `${out}/playwright.json` }]],
  use: { ...config.use, ignoreHTTPSErrors: true, trace: 'on', screenshot: { mode: 'on', fullPage: true },
    ...(process.env.LOCAL_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.LOCAL_CHROMIUM_PATH } } : {}) },
  projects: config.projects!.filter(p => engine === 'webkit' ? p.name === 'mobile-webkit' : p.name !== 'mobile-webkit'),
});
