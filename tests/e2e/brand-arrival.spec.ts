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
    contents: "import React from 'react';import{createRoot}from'react-dom/client';import BrandArrival from './app/brand-arrival';createRoot(document.getElementById('root')).render(<React.StrictMode><BrandArrival/></React.StrictMode>);",
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
  script = result.outputFiles[0].text;
});

async function fixture(page: Page, options: { noCss?: boolean; brokenLogo?: boolean; delayedScript?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/brand/becore-ticket.webp', route => options.brokenLogo ? route.abort() : route.fulfill({ contentType: 'image/webp', body: logo }));
  await page.route(url => !url.pathname.startsWith('/brand/'), route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui;background:#f8eee7;color:#281b2b}main{padding:32px}#underlying{position:fixed;left:40%;top:50%;min-height:44px} ${options.noCss ? '' : css}</style></head><body><div id="root"></div><main><h1>Destination remains mounted</h1><button id="underlying" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Continue underlying page</button></main><script>${options.delayedScript ? `setTimeout(()=>{${script.replaceAll('</script', '<\\/script')}},1600)` : script.replaceAll('</script', '<\\/script')}</script></body></html>` });
  });
}
const arrival = (page: Page) => page.getByTestId('brand-arrival');

async function stallControllerAfterReveal(page: Page) {
  await page.addInitScript(() => {
    const timer = window.setTimeout.bind(window), raf = window.requestAnimationFrame.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => timeout === 2000 ? 999999 : timer(handler, timeout, ...args)) as typeof window.setTimeout;
    window.requestAnimationFrame = callback => document.querySelector('[data-running]') ? 999999 : raf(callback);
  });
}

for (const path of ['/', '/events', '/event/on-the-guest-list?ref=promoter', '/my-nights?source=pwa', '/admin?source=staff-pwa', '/scan?source=staff-pwa']) {
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

for (const path of ['/my-nights?welcome=1', '/my-nights?recovered=1', '/my-nights?recover=1', '/my-nights?view=passes', '/my-nights/a-night', '/payment/return?reference=fixture', '/checkout/a-night', '/scan', '/room/a-night', '/event/a-night?register=1']) {
  test(`critical entry is immediately usable: ${path}`, async ({ page }) => {
    await fixture(page); await page.goto(path);
    await expect(arrival(page)).toHaveAttribute('hidden', '');
    await page.getByRole('button', { name: 'Continue underlying page' }).click();
    await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
    await expect(arrival(page)).toBeHidden();
  });
}

test('Skip removes the overlay and does not click through', async ({ page }) => {
  await fixture(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
  await page.getByRole('button', { name: 'Skip opening animation' }).click();
  await expect(arrival(page)).toHaveAttribute('hidden', '');
  await expect(page.locator('#underlying')).not.toHaveAttribute('data-clicks', /.+/);
  await page.locator('#underlying').click();
  await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
});

test('native pointer tap dismisses without activating an obscured action', async ({ page, hasTouch }) => {
  await fixture(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
  const box = await page.locator('#underlying').boundingBox();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  if (hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await expect(arrival(page)).toBeHidden();
  await expect(page.locator('#underlying')).not.toHaveAttribute('data-clicks', /.+/);
  await page.locator('#underlying').click();
  await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
});

for (const cancel of [false, true]) {
  test(`later native taps remain usable after ${cancel ? 'pointer cancellation' : 'touch dismissal'}`, async ({ page, hasTouch }) => {
    await fixture(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
    const box = await page.locator('#underlying').boundingBox();
    const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
    if (cancel) {
      await arrival(page).dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', bubbles: true, cancelable: true });
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch' })));
    } else if (hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await expect(arrival(page)).toHaveAttribute('hidden', '');
    await expect(page.locator('#underlying')).not.toHaveAttribute('data-clicks', /.+/);
    for (const count of ['1', '2']) {
      if (hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', count);
    }
  });
}

for (const time of [1070, 1500]) {
  test(`scene still owns hit testing at ${time}ms and cannot click through`, async ({ page, hasTouch }) => {
    await fixture(page); await stallControllerAfterReveal(page); await page.goto('/');
    await expect(arrival(page)).toBeVisible();
    await arrival(page).evaluate((root, time) => {
      for (const animation of root.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
    }, time);
    await expect(arrival(page)).toHaveCSS('pointer-events', 'auto');
    const box = await page.locator('#underlying').boundingBox(), x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
    if (hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await expect(arrival(page)).toHaveAttribute('hidden', '');
    await expect(page.locator('#underlying')).not.toHaveAttribute('data-clicks', /.+/);
  });
}

test('internal navigation, back/forward and synthetic restore/resume never replay', async ({ page }) => {
  await fixture(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
  await page.evaluate(() => history.pushState({}, '', '/events'));
  await expect(arrival(page)).toBeHidden();
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(arrival(page)).toHaveAttribute('hidden', '');
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(new URL('/events', page.url()).href);
  await expect(arrival(page)).toHaveAttribute('hidden', '');
});

test('background during the intro cancels permanently', async ({ page }) => {
  await fixture(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(arrival(page)).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(arrival(page)).toHaveAttribute('hidden', '');
});

test('reduced motion bypasses the scene and changing preference cannot replay it', async ({ page }) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(arrival(page)).toHaveAttribute('hidden', '');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(arrival(page)).toHaveAttribute('hidden', '');
  await page.reload(); await expect(arrival(page)).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(arrival(page)).toBeHidden();
});

for (const failure of ['css', 'image', 'late-script', 'throw'] as const) {
  test(`${failure} failure leaves the page usable without an invisible overlay`, async ({ page }) => {
    await fixture(page, { noCss: failure === 'css', brokenLogo: failure === 'image', delayedScript: failure === 'late-script' });
    if (failure === 'throw') await page.addInitScript(() => { window.matchMedia = () => { throw new Error('Fixture failure'); }; });
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue underlying page' }).click();
    await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
    await expect(arrival(page)).toHaveAttribute('hidden', '');
  });
}

test('early interaction while the emblem loads cancels the pending intro', async ({ page }) => {
  await fixture(page);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/brand/becore-ticket.webp', async route => { await gate; await route.fulfill({ contentType: 'image/webp', body: logo }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#underlying').click();
  finish();
  await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
  await expect(arrival(page)).toHaveAttribute('hidden', '');
});

test('CSS deadline independently releases visibility and hit testing if JS cleanup stalls', async ({ page }) => {
  await fixture(page);
  await stallControllerAfterReveal(page);
  await page.goto('/'); await expect(arrival(page)).toBeVisible();
  await expect(arrival(page)).toBeHidden({ timeout: 2600 });
  await page.locator('#underlying').click();
  await expect(page.locator('#underlying')).toHaveAttribute('data-clicks', '1');
});

test('approved assembled lockup is compact, non-overlapping and uses the real B asset', async ({ page }, info) => {
  await fixture(page); await stallControllerAfterReveal(page); await page.goto('/'); await expect(arrival(page)).toBeVisible();
  await arrival(page).evaluate(root => { for (const animation of root.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 1070; } });
  const geometry = await arrival(page).evaluate(root => {
    const box = (selector: string) => { const r = root.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    // SVG text rectangles include font descent even for letters without
    // descenders. Measure painted glyph height, not the full font line box.
    const ink = (selector: string) => {
      const element = root.querySelector<SVGTextElement>(selector)!, style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = context.measureText(element.textContent!), matrix = element.getScreenCTM()!;
      const baseline = new DOMPoint(0, Number(element.getAttribute('y'))).matrixTransform(matrix).y;
      return { top: baseline - metrics.actualBoundingBoxAscent * matrix.d, bottom: baseline + metrics.actualBoundingBoxDescent * matrix.d };
    };
    return { word: box('.brand-arrival__word'), wordInk: ink('.brand-arrival__word'), ticketsInk: ink('.brand-arrival__tickets'), logo: box('.brand-arrival__emblem'), door: box('.brand-arrival__door'), source: root.querySelector('image')!.getAttribute('href'), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  expect(geometry.source).toBe('/brand/becore-ticket.webp');
  expect(geometry.wordInk.bottom).toBeLessThanOrEqual(geometry.ticketsInk.top);
  expect(geometry.word.left - geometry.logo.right).toBeGreaterThanOrEqual(0);
  expect(geometry.door.left - geometry.word.right).toBeGreaterThanOrEqual(0);
  expect(geometry.door.left - geometry.word.right).toBeLessThan(24);
  expect(geometry.door.right - geometry.logo.left).toBeLessThan(240);
  expect(geometry.overflow).toBe(false);
  await page.screenshot({ path: info.outputPath('brand-arrival-approved-lockup.png') });
});
