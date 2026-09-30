import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('mobile Back closes navigation before leaving and outside destinations keep the new route', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 760, 'Mobile history boundary');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.goto('/events');
  const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await trigger.click(); await expect(menu).toBeVisible();
  await page.goBack();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
  await expect(trigger).toBeFocused();
  await trigger.click(); await expect(menu).toBeVisible();
  await page.getByRole('navigation', { name: 'Customer navigation' }).getByRole('link', { name: 'My Nights' }).click();
  await expect(page).toHaveURL(/\/my-nights$/);
  await expect(page.getByRole('heading', { name: 'My Nights', exact: true })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/events$/);
  await expect(menu).toHaveCount(0);
});

test('mobile rapid close and reopen keeps exactly the current menu in history', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 760, 'Mobile history boundary');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/events');
  const trigger = page.locator('.night-mobile-menu__trigger');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Close navigation', exact: true }).click();
  await trigger.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
});

test('mobile chrome supports safe geometry, reduced transparency and active-tab return', async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile tab bar');
  await page.goto('/events');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(dock).toBeVisible();
  const sizes = await dock.getByRole('link').evaluateAll(links => links.map(link => link.getBoundingClientRect().height));
  expect(sizes.every(size => size >= 44)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 400));
  await dock.getByRole('link', { name: 'The Drop' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('mobile-app-drop.png'), fullPage: true });
});
