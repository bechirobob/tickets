import { test as base, expect } from '@playwright/test';
import { excludeAuditAnalytics } from '../../scripts/audit-analytics.mjs';

// Do not put the exclusion header in browser-wide extraHTTPHeaders: it reaches
// third-party beacons and causes a CORS preflight failure in Chromium.
export const test = base.extend<{ excludeAuditAnalytics: void }>({
  excludeAuditAnalytics: [async ({ context, baseURL }, runTest) => {
    if (!baseURL) throw new Error('Analytics exclusion requires the configured first-party baseURL');
    if (process.env.BECORE_ISOLATED_PREVIEW === 'true') {
      const origin = new URL(baseURL).origin;
      if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Synthetic previews require a local fixture.');
      await context.route(url => url.origin !== origin, route => route.abort());
    }
    const remove = await excludeAuditAnalytics(context, baseURL);
    try { await runTest(); } finally { await remove(); }
  }, { auto: true }],
});

export { expect };
export type { Page } from '@playwright/test';
