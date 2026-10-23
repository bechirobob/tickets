import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const origin = 'https://tickets.becoreops.com';
const revision = 'ecdad9c8fedf90b234ee5e9a315b54ed12bad07f';

async function geometry(page: Page) {
  return page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>('.night-mobile-menu__trigger')!;
    const panel = document.querySelector<HTMLElement>('.night-mobile-menu--anchored .night-mobile-menu__panel');
    const links = panel?.querySelector<HTMLElement>('.night-mobile-menu__links');
    const dock = document.querySelector<HTMLElement>('.customer-dock');
    return {
      time: performance.now(), width: innerWidth, height: innerHeight, scrollY,
      viewport: visualViewport && { width: visualViewport.width, height: visualViewport.height, offsetTop: visualViewport.offsetTop },
      appHeight: document.documentElement.style.getPropertyValue('--app-viewport-height'),
      trigger: trigger.getBoundingClientRect().toJSON(), expanded: trigger.getAttribute('aria-expanded'),
      phase: panel?.dataset.phase, panel: panel?.getBoundingClientRect().toJSON(),
      maxHeight: panel?.style.getPropertyValue('--menu-max-height'),
      links: links && { bounds: links.getBoundingClientRect().toJSON(), scrollHeight: links.scrollHeight, clientHeight: links.clientHeight },
      dock: dock?.getBoundingClientRect().toJSON(),
    };
  });
}

async function baseline(page: Page) {
  for (const path of ['/healthz', '/api/version']) {
    const response = await page.request.get(origin + path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const value = await response.json();
    expect(value.service).toBe('becore-tickets');
    expect(value.revision).toBe(revision);
    if (path === '/healthz') { expect(value.runtime).toBe('vps'); expect(value.active).toBe(true); }
  }
}

test('records live menu geometry without repairing it', async ({ page, browserName }, info) => {
  test.setTimeout(60000);
  const evidence: unknown[] = [];
  // Only public reads; reject writes and all cross-origin requests before transmission.
  await page.context().route('**/*', route => {
    const request = route.request();
    return request.method() === 'GET' && new URL(request.url()).origin === origin
      ? route.continue() : route.abort('blockedbyclient');
  });
  await page.context().routeWebSocket('**/*', socket => socket.close());
  await baseline(page);
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: browserName === 'chromium' ? 980 : 700, height: browserName === 'chromium' ? 844 : 390 });
    await page.goto(origin + '/events');
    const trigger = page.locator('.night-mobile-menu__trigger');
    await expect(trigger).toBeEnabled();
    if (browserName === 'chromium') {
      for (const y of [0, 11]) {
        await page.evaluate(y => scrollTo(0, y), y);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        evidence.push({ label: `before-scroll-${y}`, value: await geometry(page) });
        await trigger.click(); // Exactly one activation. Do not retry a closed menu.
        for (let frame = 1; frame <= 3; frame++) {
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
          evidence.push({ label: `after-scroll-${y}-frame-${frame}`, value: await geometry(page) });
        }
        await page.screenshot({ path: info.outputPath(`scroll-${y}.png`) });
        await page.keyboard.press('Escape');
      }
    } else {
      await trigger.press('Enter');
      await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
      evidence.push({ label: 'before-resize', value: await geometry(page) });
      await page.setViewportSize({ width: 700, height: 300 });
      evidence.push({ label: 'resize-returned', value: await geometry(page) });
      for (let frame = 1; frame <= 60; frame++) {
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        evidence.push({ label: `resize-frame-${frame}`, value: await geometry(page) });
      }
      await page.screenshot({ path: info.outputPath('resize-settled.png') });
    }
  } finally {
    await info.attach('geometry.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await baseline(page);
  }
});
