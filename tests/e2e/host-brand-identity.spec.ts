import { test, expect, type Page } from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';

async function readyPortrait(page: Page, selector: string) {
  const portrait = page.locator(selector);
  await portrait.scrollIntoViewIfNeeded();
  for (const image of await portrait.locator('img').all()) {
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    await image.evaluate((element: HTMLImageElement) => element.decode());
  }
}

async function expectHostButton(host: Locator) {
  const portrait = await host.locator('.event-host__portrait').boundingBox();
  const brand = await host.locator('.host-brand-eyebrow').boundingBox();
  const button = host.getByRole('link', { name: 'View Host', exact: true });
  const target = await button.boundingBox();
  expect(portrait!.y).toBeCloseTo(brand!.y, 0);
  expect(portrait!.width).toBe(80);
  expect(target!.x).toBeCloseTo(brand!.x, 0);
  for (const selector of ['h2', '.event-host__meta']) {
    expect((await host.locator(selector).boundingBox())!.x).toBeCloseTo(brand!.x, 0);
  }
  expect((await host.locator('.event-host__meta').boundingBox())!.height).toBe(20);
  const seal = await host.locator('.host-portrait__seal').boundingBox();
  expect(seal!.width).toBe(28);
  expect(brand!.x - seal!.x - seal!.width).toBeGreaterThanOrEqual(12);
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  await expect(button).toHaveAttribute('href', '/hosts/kofi-bills');
  await expect(button).toHaveCSS('text-decoration-line', 'none');
  await expect(button).toHaveCSS('border-radius', '6px');
  await button.focus();
  await button.press('Tab');
  await host.page().keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await expect(button).toHaveCSS('outline-width', '2px');
  await button.evaluate(element => (element as HTMLElement).blur());
  const background = await button.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  await button.hover();
  await expect(button).not.toHaveCSS('background-color', background);
  await host.page().mouse.move(0, 0);
}

async function hostSpacing(host: Locator) {
  return host.evaluate(element => {
    const brand = element.querySelector('.host-brand-eyebrow')!, name = element.querySelector('h2')!, meta = element.querySelector('.event-host__meta')!, link = element.querySelector('a')!, portrait = element.querySelector('.host-portrait')!, seal = element.querySelector('.host-portrait__seal')!;
    const b = brand.getBoundingClientRect(), n = name.getBoundingClientRect(), m = meta.getBoundingClientRect(), l = link.getBoundingClientRect(), p = portrait.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      hostHeight: element.getBoundingClientRect().height,
      brandToName: n.top - b.bottom, nameToMeta: m.top - n.bottom, metaToLink: l.top - m.bottom,
      linkHeight: l.height, paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom),
      nameFontSize: parseFloat(getComputedStyle(name).fontSize), nameLineHeight: parseFloat(getComputedStyle(name).lineHeight),
      brandFontSize: parseFloat(getComputedStyle(brand).fontSize), metaFontSize: parseFloat(getComputedStyle(meta).fontSize),
      portraitWidth: p.width, portraitHeight: p.height, sealWidth: seal.getBoundingClientRect().width,
    };
  });
}

async function recordHostSpacing(page: Page, host: Locator, filename: string) {
  // Controlled CSS comparison, not a claim that the old release was rebuilt.
  // These are the exact prior spacing declarations from 7013070856ed3dc9cfb81693b5c70df19005c0e9.
  // Serve the fixture as a same-origin stylesheet so production style-src 'self' stays enforced.
  const baselineUrl = new URL('/__e2e__/yorke-spacing-baseline.css', page.url()).href;
  await page.route(baselineUrl, route => route.fulfill({ contentType: 'text/css', body: `
    .event-host--branded { padding: 26px 0; }
    .event-host--branded .event-host__portrait { margin-top: 22px; }
    .event-host.event-host--branded .host-brand-eyebrow { margin-bottom: 4px; }
    .event-host--branded h2 { margin: 0 0 6px; line-height: inherit; }
    .event-host--branded a { display: inline-flex; width: auto; margin-top: 12px; padding: 0 0 4px; border: 0; border-bottom: 1px solid #77746d; border-radius: 0; background: transparent; color: inherit; }
  ` }));
  const baseline = await page.addStyleTag({ url: baselineUrl });
  const before = await hostSpacing(host);
  await baseline.evaluate(element => { element.parentNode?.removeChild(element); });
  await page.unroute(baselineUrl);
  const after = await hostSpacing(host);
  expect(after.hostHeight).toBeLessThan(before.hostHeight - 30);
  expect(after.brandToName).toBeCloseTo(2, 0);
  expect(after.nameToMeta).toBeCloseTo(4, 0);
  expect(after.metaToLink).toBeCloseTo(8, 0);
  expect(after.linkHeight).toBeGreaterThanOrEqual(44);
  for (const key of ['nameFontSize', 'brandFontSize', 'metaFontSize', 'portraitWidth', 'portraitHeight', 'sealWidth'] as const) expect(after[key]).toBe(before[key]);
  await writeFile(test.info().outputPath(filename), JSON.stringify({ sourceSha: process.env.BECORE_RELEASE_SHA ?? null, baselineSourceSha: '7013070856ed3dc9cfb81693b5c70df19005c0e9', method: 'Candidate screenshots captured before comparison; prior spacing applied temporarily to the same DOM, then removed before candidate geometry measurement.', viewport: page.viewportSize(), before, after }, null, 2));
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
  await expectHostButton(host);
  await expect(host.locator('.host-brand-eyebrow')).toHaveCSS('text-transform', 'none');
  await expect(host.getByRole('link', { name: 'View Host', exact: true })).toHaveAttribute('href', '/hosts/kofi-bills');
  await expect(page.locator('.event-detail-poster img')).toHaveAttribute('src', /on-the-guest-list/);
  await expect(page.locator('.event-detail-story')).toContainText('Club House Inc');
  expect((await new AxeBuilder({ page }).include('.event-host').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('yorke-event.png'), fullPage: true, scale: 'css' });
  await page.locator('.event-detail-story').screenshot({ path: test.info().outputPath('yorke-event-host.png'), scale: 'css' });
  await recordHostSpacing(page, host, 'yorke-host-spacing.json');
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
  await expectHostButton(page.locator('.event-host--branded'));
  expect((await new AxeBuilder({ page }).include('.event-host').analyze()).violations).toEqual([]);
  await page.locator('.event-detail-story').screenshot({ path: test.info().outputPath('yorke-event-host-narrow.png'), scale: 'css' });
  await recordHostSpacing(page, page.locator('.event-host--branded'), 'yorke-host-spacing-narrow.json');
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
