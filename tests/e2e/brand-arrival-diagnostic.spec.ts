import { test, expect, type Page } from './analytics-fixture';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.use({ serviceWorkers: 'block' });
let script: string;
const css = readFileSync(resolve('app/brand-arrival.css'), 'utf8');
const logo = readFileSync(resolve('public/brand/becore-ticket.webp'));
test.beforeAll(async () => {
  const result = await build({ stdin: {
    contents: "import React from 'react';import{createRoot}from'react-dom/client';import BrandArrival from './app/brand-arrival';import{captureArrivalDocument}from'./lib/brand-arrival';window.__arrivalEntry=()=>captureArrivalDocument();createRoot(document.getElementById('root')).render(<React.StrictMode><BrandArrival/></React.StrictMode>);",
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  script = result.outputFiles[0].text;
});

async function fixture(page: Page, options: { noCss?: boolean; brokenLogo?: boolean; delayedScript?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/brand/becore-ticket.webp', route => options.brokenLogo ? route.abort() : route.fulfill({ contentType: 'image/webp', body: logo }));
  await page.route(url => !url.pathname.startsWith('/brand/'), route => {
    if (route.request().resourceType() !== 'document') return route.abort();
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui;background:#f8eee7;color:#281b2b}main{padding:32px}#underlying{position:fixed;left:40%;top:50%;min-height:44px} ${options.noCss ? '' : css}</style></head><body><div id="root"></div><main><h1>Destination remains mounted</h1><button id="underlying" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Continue underlying page</button></main><script>${options.delayedScript ? `setTimeout(()=>{${script.replaceAll('</script', '<\\/script')}},1600)` : script.replaceAll('</script', '<\\/script')}</script></body></html>` });
  });
}
const arrival = (page: Page) => page.getByTestId('brand-arrival');


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Signal = { kind: string; at: number; hidden: boolean; value?: string | number };
    const signals: Signal[] = [];
    const target = window as unknown as { __arrivalSignals: Signal[] };
    target.__arrivalSignals = signals;
    const record = (kind: string, value?: string | number) => {
      if (signals.length < 80) signals.push({ kind, at: performance.now(), hidden: document.hidden, value });
    };
    record('init');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      record('raf_scheduled');
      return raf(at => { record('raf_callback', at); callback(at); });
    };
    document.addEventListener('visibilitychange', () => record('visibility'));
    document.addEventListener('DOMContentLoaded', () => record('dom_ready'));
    window.addEventListener('load', () => record('load'));
    new MutationObserver(() => {
      const root = document.querySelector('[data-testid="brand-arrival"]');
      if (root) record('root_state', `${root.hasAttribute('hidden')}:${root.hasAttribute('data-running')}`);
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-running'] });
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const evidence = await page.evaluate(() => {
    const target = window as unknown as { __arrivalSignals?: unknown[]; __arrivalEntry?: () => { phase: string; late?: boolean; interacted?: boolean; capturedAt: number; navigationType: string } | null };
    const entry = target.__arrivalEntry?.();
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return { signals: target.__arrivalSignals, entry: entry ? { phase: entry.phase, late: entry.late, interacted: entry.interacted, capturedAt: entry.capturedAt, navigationType: entry.navigationType } : null, now: performance.now(), readyState: document.readyState, hidden: document.hidden, navigation: navigation ? { startTime: navigation.startTime, responseEnd: navigation.responseEnd, domContentLoadedEventEnd: navigation.domContentLoadedEventEnd, loadEventEnd: navigation.loadEventEnd } : null };
  });
  await testInfo.attach('arrival-timing.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

for (const path of ['/']) {
  test(`fresh entry and reload play without changing the target: ${path}`, async ({ page }) => {
    await fixture(page);
    await page.addInitScript(() => {
      for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { configurable: true, get() { throw new Error('Storage unavailable'); } });
    });
    await page.goto(path);
    await expect(arrival(page)).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
    await page.keyboard.press('Escape');
    await expect(arrival(page)).toBeHidden();
    await page.reload();
    await expect(arrival(page)).toBeVisible();
    await expect(arrival(page)).toBeHidden({ timeout: 2500 });
  });
}

