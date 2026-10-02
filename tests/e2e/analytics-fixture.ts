import { test as base, expect } from '@playwright/test';
import { excludeAuditAnalytics } from '../../scripts/audit-analytics.mjs';

// Do not put the exclusion header in browser-wide extraHTTPHeaders: it reaches
// third-party beacons and causes a CORS preflight failure in Chromium.
export const test = base.extend<{ excludeAuditAnalytics: void }>({
  excludeAuditAnalytics: [async ({ context, baseURL }, runTest) => {
    if (!baseURL) throw new Error('Analytics exclusion requires the configured first-party baseURL');
    const remove = await excludeAuditAnalytics(context, baseURL);
    try { await runTest(); } finally { await remove(); }
  }, { auto: true }],
});

export { expect };
export type { Page } from '@playwright/test';
