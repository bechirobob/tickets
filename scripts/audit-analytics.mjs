/**
 * Exclude automated visits only at the exact first-party analytics endpoint.
 * Derived from the reviewed f2ea9d5 production overlay (run 36938458090).
 * Playwright routing disables browser HTTP caching; cache acceptance needs an
 * independent unrouted context, never this helper.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} baseURL
 */
export async function excludeAuditAnalytics(context, baseURL) {
  const endpoint = new URL('/api/analytics', baseURL).href;
  /** @param {URL} url */
  const matches = url => url.href === endpoint;
  /** @param {import('@playwright/test').Route} route */
  const handler = async route => {
    await route.continue({ headers: { ...route.request().headers(), 'x-becore-analytics': 'exclude' } });
  };
  await context.route(matches, handler);
  return () => context.unroute(matches, handler);
}
