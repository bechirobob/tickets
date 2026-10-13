import { test, expect } from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page, request }, info) => {
  await page.setViewportSize({ width: info.project.name === 'desktop-chromium' ? 1280 : 390, height: 900 });
  if (process.env.BECORE_ISOLATED_PREVIEW === 'true') {
    const version = await (await request.get('/api/version')).json();
    expect(version.revision).toBe(process.env.BECORE_RELEASE_SHA);
  }
});

test('The Yorke Way signature preserves Kofi’s personal profile and source artwork', async ({ page }) => {
  await page.goto('/hosts/kofi-bills');
  await expect(page.getByRole('heading', { name: 'Kofi Bills', exact: true })).toBeVisible();
  await expect(page.locator('.host-profile__identity')).toContainText('Henry Yorke');
  await expect(page.locator('.host-profile__identity')).toContainText('Verified host');
  await expect(page.locator('.host-profile__portrait img')).toHaveAttribute('src', '/hosts/kofi-bills.webp');
  const signature = page.locator('.host-profile__brand');
  await expect(signature).toHaveText('The Yorke Way');
  await expect(signature.locator('img')).toHaveAttribute('src', '/hosts/the-yorke-way.svg');
  await expect.poll(() => signature.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const size = await signature.locator('img').boundingBox();
  expect(size?.width).toBeLessThanOrEqual(64);
  expect(size?.height).toBe(size?.width);
  await expect(page.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/mr.yorke/');
  await expect(page.getByRole('link', { name: /Snapchat/ })).toHaveAttribute('href', 'https://www.snapchat.com/add/kofi_billz123');
  expect((await new AxeBuilder({ page }).include('.host-profile').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-profile.png'), fullPage: true, scale: 'css' });
});

test('linked event gives the host a subordinate brand credit without replacing organizer or poster', async ({ page }) => {
  await page.goto('/event/sun-chasers-labadi');
  const host = page.locator('.event-host').filter({ has: page.getByRole('heading', { name: 'Kofi Bills', exact: true }) });
  await expect(host.locator('.event-host__brand')).toHaveText('The Yorke Way');
  await expect(host.getByRole('link', { name: 'View Host', exact: true })).toHaveAttribute('href', '/hosts/kofi-bills');
  await expect(page.locator('.event-detail-poster img')).toHaveAttribute('src', /on-the-guest-list/);
  await expect(page.locator('.event-detail-story')).toContainText('Club House Inc');
  expect((await new AxeBuilder({ page }).include('.event-host').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-event.png'), fullPage: true, scale: 'css' });
  await page.locator('.event-detail-story').screenshot({ path: test.info().outputPath('yorke-event-host.png'), scale: 'css' });
  await host.getByRole('link', { name: 'View Host', exact: true }).click();
  await expect(page.locator('.host-profile__brand')).toHaveText('The Yorke Way');
});
