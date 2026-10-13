import { test, expect, type Page } from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';

async function readyPortrait(page: Page, selector: string) {
  const portrait = page.locator(selector);
  await portrait.scrollIntoViewIfNeeded();
  for (const image of await portrait.locator('img').all()) {
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    await image.evaluate((element: HTMLImageElement) => element.decode());
  }
}

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
  await expect(page.locator('.host-profile__identity')).not.toContainText('Henry Yorke');
  await expect(page.locator('.host-profile__bio')).toContainText('Henry Yorke');
  await expect(page.locator('.host-profile__identity')).toContainText('Verified host');
  await expect(page.locator('.host-profile__portrait .host-portrait__image')).toHaveAttribute('src', '/hosts/kofi-bills.webp');
  await readyPortrait(page, '.host-profile__portrait .host-portrait');
  const signature = page.locator('.host-profile__identity .host-brand-eyebrow');
  await expect(signature).toHaveText('The Yorke Way');
  const seal = page.locator('.host-profile__portrait .host-portrait__seal');
  await expect(seal.locator('img')).toHaveAttribute('src', '/hosts/the-yorke-way.svg');
  await expect.poll(() => seal.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const size = await seal.boundingBox(), portrait = await page.locator('.host-profile__portrait .host-portrait__image').boundingBox();
  expect(size?.width).toBe(page.viewportSize()!.width > 600 ? 52 : 36);
  expect(size?.height).toBe(size?.width);
  expect(size!.y).toBeGreaterThan(portrait!.y + portrait!.height / 2);
  expect(size!.x + size!.width).toBeCloseTo(portrait!.x + portrait!.width + (page.viewportSize()!.width > 600 ? 8 : 6), 0);
  const brandBox = await signature.boundingBox(), nameBox = await page.locator('#host-name').boundingBox();
  expect(nameBox!.y - brandBox!.y - brandBox!.height).toBeCloseTo(6, 0);
  await expect(signature).toHaveCSS('text-transform', 'none');
  await expect(signature).toHaveCSS('font-weight', '600');
  await expect(seal).toHaveCSS('box-shadow', 'none');
  await expect(page.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/mr.yorke/');
  await expect(page.getByRole('link', { name: /Snapchat/ })).toHaveAttribute('href', 'https://www.snapchat.com/add/kofi_billz123');
  expect((await new AxeBuilder({ page }).include('.host-profile').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-profile.png'), fullPage: true, scale: 'css' });
});

test('linked event gives the host a subordinate brand credit without replacing organizer or poster', async ({ page }) => {
  await page.goto('/event/sun-chasers-labadi');
  const host = page.locator('.event-host').filter({ has: page.getByRole('heading', { name: 'Kofi Bills', exact: true }) });
  await expect(host.locator('.host-brand-eyebrow')).toHaveText('The Yorke Way');
  await readyPortrait(page, '.event-host .host-portrait');
  await expect(host.locator('.host-portrait__seal img')).toHaveAttribute('src', '/hosts/the-yorke-way.svg');
  const portrait = await host.locator('.event-host__portrait').boundingBox(), name = await host.locator('h2').boundingBox();
  expect(portrait!.y).toBeCloseTo(name!.y, 0);
  await expect(host.locator('.host-brand-eyebrow')).toHaveCSS('text-transform', 'none');
  await expect(host.getByRole('link', { name: 'View Host', exact: true })).toHaveAttribute('href', '/hosts/kofi-bills');
  await expect(page.locator('.event-detail-poster img')).toHaveAttribute('src', /on-the-guest-list/);
  await expect(page.locator('.event-detail-story')).toContainText('Club House Inc');
  expect((await new AxeBuilder({ page }).include('.event-host').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-event.png'), fullPage: true, scale: 'css' });
  await page.locator('.event-detail-story').screenshot({ path: test.info().outputPath('yorke-event-host.png'), scale: 'css' });
  await host.getByRole('link', { name: 'View Host', exact: true }).click();
  await expect(page.locator('.host-profile__identity .host-brand-eyebrow')).toHaveText('The Yorke Way');
});

test('the portrait seal and brand hierarchy stay contained on a 320px phone', async ({ page }) => {
  test.skip(test.info().project.name === 'desktop-chromium', 'Narrow phone evidence uses the phone browser context.');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/hosts/kofi-bills');
  const seal = page.locator('.host-profile__portrait .host-portrait__seal');
  await readyPortrait(page, '.host-profile__portrait .host-portrait');
  await expect(seal).toBeVisible();
  expect((await seal.boundingBox())!.width).toBe(36);
  await expect(page.locator('.host-profile__city')).toContainText('Verified host');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-profile-narrow.png'), fullPage: true, scale: 'css' });
  await page.goto('/event/sun-chasers-labadi');
  await expect(page.locator('.event-host .host-brand-eyebrow')).toHaveText('The Yorke Way');
  await readyPortrait(page, '.event-host .host-portrait');
  await expect(page.locator('.event-host .host-portrait__seal')).toBeVisible();
  await page.locator('.event-detail-story').screenshot({ path: test.info().outputPath('yorke-event-host-narrow.png'), scale: 'css' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('host directory uses the same portrait seal and one display name', async ({ page }) => {
  await page.goto('/hosts');
  const host = page.locator('.hosts-list article').filter({ has: page.getByRole('heading', { name: 'Kofi Bills', exact: true }) });
  await readyPortrait(page, '.hosts-list article:has(h2:text-is("Kofi Bills")) .host-portrait');
  await expect(host.locator('.host-portrait__seal img')).toHaveAttribute('src', '/hosts/the-yorke-way.svg');
  await expect(host.locator('h2')).toHaveText('Kofi Bills');
  await expect(host).toContainText('Henry Yorke');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-directory.png'), fullPage: true, scale: 'css' });
});
