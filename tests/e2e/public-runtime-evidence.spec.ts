import { writeFile } from 'node:fs/promises';
import { expect, test } from './catalogue';

// A short, read-only lab observation, not field Core Web Vitals or a capacity SLA.
// No new performance thresholds are imposed by this evidence collection.
const observationMs = 1_000;

for (const path of ['/', '/events', '/event/$published']) {
  test(`${path} records public runtime metrics and critical asset health`, async ({ page, eventSlug, request }, info) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedAssets: Array<{ url: string; type: string; failure: string }> = [];
    const criticalTypes = new Set(['script', 'stylesheet', 'font', 'image']);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => { if (criticalTypes.has(request.resourceType())) failedAssets.push({ url: request.url(), type: request.resourceType(), failure: request.failure()?.errorText ?? 'Request failed' }); });
    page.on('response', response => { const type = response.request().resourceType(); if (criticalTypes.has(type) && response.status() >= 400) failedAssets.push({ url: response.url(), type, failure: `HTTP ${response.status()}` }); });
    await page.addInitScript(() => {
      type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
      const metrics = { supported: PerformanceObserver.supportedEntryTypes ?? [], lcpMs: null as number | null, shifts: [] as Array<{ time: number; value: number }> };
      Object.assign(window, { publicRuntimeMetrics: metrics });
      if (metrics.supported.includes('largest-contentful-paint')) {
        new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.lcpMs = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      }
      if (metrics.supported.includes('layout-shift')) {
        new PerformanceObserver(list => { for (const entry of list.getEntries() as Shift[]) if (!entry.hadRecentInput) metrics.shifts.push({ time: entry.startTime, value: entry.value }); }).observe({ type: 'layout-shift', buffered: true });
      }
    });
    const route = path.replace('$published', eventSlug);
    const response = await page.goto(route, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // A declared, fixed post-readiness observation window makes these lab samples
    // comparable. It does not claim that a user's eventual LCP/CLS is final.
    await page.waitForTimeout(observationMs);
    const metrics = await page.evaluate(() => {
      const observed = (window as typeof window & { publicRuntimeMetrics: { supported: string[]; lcpMs: number | null; shifts: Array<{ time: number; value: number }> } }).publicRuntimeMetrics;
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      let maxSession = 0, session = 0, first = -1, previous = 0;
      for (const shift of observed.shifts) {
        if (first < 0 || shift.time - previous > 1000 || shift.time - first > 5000) { session = 0; first = shift.time; }
        session += shift.value; previous = shift.time; maxSession = Math.max(maxSession, session);
      }
      return {
        url: location.href, observedAtMs: performance.now(), viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        navigation: navigation ? { type: navigation.type, ttfbMs: navigation.responseStart - navigation.startTime, serverWaitMs: navigation.responseStart - navigation.requestStart, domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd, transferBytes: navigation.transferSize, encodedBodyBytes: navigation.encodedBodySize } : null,
        paint: Object.fromEntries(performance.getEntriesByType('paint').map(entry => [entry.name, entry.startTime])),
        largestContentfulPaint: { supported: observed.supported.includes('largest-contentful-paint'), observedMs: observed.lcpMs },
        cumulativeLayoutShift: { supported: observed.supported.includes('layout-shift'), observedMaximumSession: observed.supported.includes('layout-shift') ? maxSession : null, entries: observed.shifts },
        resources: { count: resources.length, transferBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0), encodedBodyBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0), zeroTransferEntries: resources.filter(entry => entry.transferSize === 0).length },
        brokenLoadedImages: [...document.images].filter(image => image.complete && image.currentSrc && image.naturalWidth === 0).map(image => image.currentSrc),
      };
    });
    const versionResponse = await request.get('/api/version');
    const version = versionResponse.ok() ? await versionResponse.json() : { unavailableStatus: versionResponse.status() };
    const headers = response?.headers() ?? {};
    const evidence = {
      project: info.project.name, capturedAt: new Date().toISOString(), route, status: response?.status(), version,
      observation: { afterReadinessMs: observationMs, scope: 'Initial viewport, fresh browser context, automated hosted lab; not field data, final Core Web Vitals, physical-device or throughput acceptance', cachePolicy: 'Endpoint-scoped analytics routing disables browser HTTP caching; this is not warm-cache evidence', transferLimit: 'Zero transfer sizes may represent caching or missing cross-origin timing visibility; resource bytes exclude the navigation document, which is reported separately', unsupported: 'Unsupported LCP/CLS entries remain null rather than being reported as zero' },
      headers: Object.fromEntries(['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cache-control'].map(name => [name, headers[name] ?? null])),
      ...metrics, pageErrors, consoleErrors, failedAssets,
    };
    const body = JSON.stringify(evidence, null, 2);
    await writeFile(info.outputPath('public-runtime-metrics.json'), body);
    await info.attach('public-runtime-metrics', { body, contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('public-runtime-viewport.png') });
    expect(response?.ok()).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
    expect(metrics.brokenLoadedImages).toEqual([]);
  });
}
