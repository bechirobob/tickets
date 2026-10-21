import { expect, test, type Page } from './analytics-fixture';

test.use({ serviceWorkers: 'block' });

async function assertTopBounds(page: Page) {
  const bounds = await page.locator('.night-mobile-menu__panel').evaluate(panel => {
    const rect = panel.getBoundingClientRect();
    const header = document.querySelector('main > header')!.getBoundingClientRect();
    const dock = document.querySelector('.customer-dock')?.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      headerBottom: header.bottom, dockTop: dock?.width ? dock.top : Infinity,
      viewportBottom: viewport.offsetTop + viewport.height, width: viewport.width };
  });
  expect(bounds.top).toBeCloseTo(bounds.headerBottom + 8, 0);
  expect(bounds.bottom).toBeLessThanOrEqual(Math.min(bounds.dockTop - 8, bounds.viewportBottom - 12) + 1);
  expect(bounds.left).toBeGreaterThanOrEqual(11);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width - 11);
}

test('main Menu stays at the top in narrow portrait, short landscape and keyboard viewports', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 320, height: 664 }, { width: 568, height: 320 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/events');
    const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await expect(menu).toBeVisible();
    await assertTopBounds(page);
    const pageScroll = await page.evaluate(() => scrollY);
    for (const link of await menu.getByRole('link').all()) {
      await link.focus();
      await expect(link).toBeInViewport({ ratio: 1 });
      await assertTopBounds(page);
    }
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
    await menu.getByRole('button', { name: 'Close navigation', exact: true }).focus();
    await page.screenshot({ path: info.outputPath(`menu-top-${viewport.width}x${viewport.height}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 320, height: 664 });
  await page.goto('/events');
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  await trigger.click();
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 210 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(menu).toBeVisible();
  await assertTopBounds(page);
  for (const link of await menu.getByRole('link').all()) {
    await link.focus();
    await expect(link).toBeInViewport({ ratio: 1 });
    await assertTopBounds(page);
  }
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 140 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => Boolean(history.state?.becoreLayer))).toBe(false);
});

test('Menu, notifications and Room chooser replace each other without panel overlap', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 664 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated panel fixture' } }));
  await page.route('**/api/customer/notifications', route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route('**/api/customer/room-updates', route => route.fulfill({ json: { rooms: [
    { eventSlug: 'first-night', title: 'First night', unread: 1, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    { eventSlug: 'second-night', title: 'Second night', unread: 0, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  ], unread: 1 } }));
  await page.goto('/my-nights');
  const trigger = page.locator('.night-mobile-menu__trigger');
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const buzz = page.getByRole('dialog', { name: 'The Buzz', exact: true });
  const chooser = page.getByRole('dialog', { name: 'Choose your Room', exact: true });
  const room = page.getByRole('button', { name: 'Room, 1 new updates', exact: true });
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(buzz).toBeVisible();
  await trigger.click();
  await expect(buzz).toHaveCount(0);
  await expect(menu).toBeVisible();
  await room.click();
  await expect(menu).toHaveCount(0);
  await expect(chooser).toBeVisible();
  await trigger.click();
  await expect(chooser).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await assertTopBounds(page);
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/my-nights$/);
});
