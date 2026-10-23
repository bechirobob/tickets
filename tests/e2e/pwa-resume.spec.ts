import { test, expect } from './analytics-fixture';

// Synthetic lifecycle coverage against the real served shell. This is not a
// substitute for iOS process eviction/suspension on an installed physical PWA.
test('foreground and BFCache repair viewport without reloading a healthy route', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false, height = 800;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    if (window.visualViewport) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => height });
    Object.assign(window, { setResumeFixture: (nextHidden: boolean, nextHeight: number) => { hidden = nextHidden; height = nextHeight; } });
  });
  await page.goto('/events');
  await expect(page.locator('main')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-height'))).toBe('800px');
  const url = page.url();
  await page.evaluate(() => {
    const fixture = window as unknown as Window & { setResumeFixture: (hidden: boolean, height: number) => void; resumeIdentity?: object };
    fixture.resumeIdentity = {};
    fixture.setResumeFixture(true, 0);
    window.visualViewport?.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-height'))).toBe('800px');
  await page.evaluate(() => {
    (window as unknown as Window & { setResumeFixture: (hidden: boolean, height: number) => void }).setResumeFixture(false, 720);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-height'))).toBe('720px');
  await expect(page.locator('main')).toBeVisible();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => Boolean((window as Window & { resumeIdentity?: object }).resumeIdentity))).toBe(true);
});

test('root recovery UI exposes controls under the production CSP', async ({ page }) => {
  const { build } = await import('esbuild');
  const result = await build({ stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import GlobalError from './app/global-error';createRoot(document).render(<GlobalError error={new Error('synthetic root layout failure')} reset={()=>{}}/>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const { contentSecurityPolicy } = await import('../../worker/security-response');
  const nonce = 'synthetic-pwa-resume-fixture';
  const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
  await page.route('**/__pwa-root-error-fixture', route => route.fulfill({
    contentType: 'text/html', headers: { 'content-security-policy': contentSecurityPolicy(nonce) },
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script nonce="${nonce}">${script}</script></body></html>`,
  }));
  await page.goto('/__pwa-root-error-fixture');
  await expect(page.getByRole('heading', { name: 'Let’s get your page back.' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 241, 234)');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Saved offline tickets' })).toHaveAttribute('href', '/offline-ticket.html');
  await page.getByRole('button', { name: 'Reload page' }).click();
  await expect(page.getByRole('heading', { name: 'Let’s get your page back.' })).toBeVisible();
});
