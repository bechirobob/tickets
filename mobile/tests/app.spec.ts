import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { braai, guest, catalogue } from './fixtures';
const origin = 'https://tickets.becoreops.com';
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-10T12:00:00Z'));
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: catalogue, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${origin}/events/*`, async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ body: await readFile(new URL(`../../public${path}`, import.meta.url)), contentType: path.endsWith('webp') ? 'image/webp' : 'image/jpeg' });
  });
});

test('shared Home, Drop, full posters and menu use the website destinations', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.night-home')).toBeVisible();
  await expect(page.locator('.payment-footer__crypto')).toHaveText('CryptoUSDC through SeevPlus');
  await expect(page.locator('.payment-footer')).not.toContainText('Coming soon');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(dock.getByRole('link')).toHaveText(['Home', 'The Drop', 'My Nights']);
  await dock.getByRole('link', { name: 'The Drop', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Find your next night.' })).toBeVisible();
  await expect.poll(() => page.locator('.drop-card__image img').evaluateAll(images => images.length === 2 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const posters = await page.locator('.drop-card__image').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, fit: getComputedStyle(node.querySelector('img')!).objectFit })));
  expect(posters).toHaveLength(2);
  for (const poster of posters) {
    expect(poster.fit).toBe('contain');
    expect(poster.height).toBeGreaterThan(0);
  }
  // WebKit can round equivalent bounds differently (~0.000061 CSS px apart).
  // One thousandth of a CSS pixel tolerates that noise, not a layout mismatch.
  expect(Math.abs(posters[0].height - posters[1].height)).toBeLessThan(0.001);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('shared-drop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const menu = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Home', exact: true })).not.toBeVisible();
  await expect(menu.getByRole('link', { name: 'Help', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
});

test('event screens share the full facts, original icons, countdown and signup action', async ({ page }, info) => {
  await page.goto(`/event/${guest.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: guest.title })).toBeVisible();
  await expect(page.locator('.event-dress-code')).toContainText('Light pink & white');
  await expect(page.locator('.event-guest-perk .mimosa-glass')).toBeVisible();
  await expect(page.locator('.event-coming-soon')).toContainText('Coming soon');
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.locator('.event-detail-poster img')).toHaveCSS('object-fit', 'contain');
  await expect(page.locator('.event-detail-poster')).toHaveClass(/event-detail-poster--portrait/);
  await expect(page.locator('.event-practical-details')).toContainText('Special Guest DJ');
  await expect(page.locator('.event-practical-details')).toContainText('Cuppy');
  await expect(page.locator('.cuppy-guest')).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Keep me posted', exact: true }).click();
  const opened = await popup; await expect.poll(() => opened.url()).toBe(`${origin}/rsvp/${guest.slug}`); await opened.close();
  await page.goto(`/event/${braai.slug}`);
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.locator('.event-guest-perk')).toContainText('Unlimited grills & drinks');
  await expect(page.getByRole('button', { name: 'Copy Link', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('shared-event.png'), fullPage: true });
});

test('failed refresh retains labelled public data, blocks stale signup and recovers', async ({ page }) => {
  await page.goto(`/event/${braai.slug}`); await expect(page.getByRole('heading', { name: braai.title })).toBeVisible();
  await page.route(`${origin}/api/public/events`, route => route.abort());
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/Saved events/)).toBeVisible();
  await expect(page.locator('#register')).toHaveAttribute('inert', '');
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: catalogue, headers: { 'access-control-allow-origin': '*' } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#register')).not.toHaveAttribute('inert');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['becore.public-catalogue.v2']);
});

test('My Nights goes directly to the existing account flow with no intermediate app page', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Find your next night.' })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('navigation', { name: 'Customer navigation' }).getByRole('link', { name: 'My Nights', exact: true }).click();
  const opened = await popup;
  await expect.poll(() => opened.url()).toBe(`${origin}/my-nights`);
  await expect(page.getByRole('button', { name: 'Open My Nights' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/);
  await opened.close();
});

test('back restores Drop position and filtering; edge gestures distinguish vertical scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/events');
  await page.getByRole('searchbox', { name: 'Search events, artists or venues' }).fill('Braai');
  const link = page.locator('.drop-card').getByRole('link', { name: `See ${braai.title}`, exact: true });
  await link.scrollIntoViewIfNeeded(); const position = await page.evaluate(() => scrollY);
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: braai.title })).toBeFocused();
  const content = page.locator('main');
  await content.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 10, clientY: 180 }] });
  await content.dispatchEvent('touchend', { changedTouches: [{ identifier: 0, clientX: 120, clientY: 310 }] });
  await expect(page.getByRole('heading', { level: 1, name: braai.title })).toBeVisible();
  await content.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: 10, clientY: 180 }] });
  await content.dispatchEvent('touchend', { changedTouches: [{ identifier: 0, clientX: 140, clientY: 190 }] });
  await expect(page.getByRole('heading', { level: 1, name: 'Find your next night.' })).toBeFocused();
  await expect(page.getByRole('searchbox', { name: 'Search events, artists or venues' })).toHaveValue('Braai');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
});

test('small screens, larger text and empty states keep visible lettering intact', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/event/${guest.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: guest.title })).toBeVisible();
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('h1,h2,dd,.event-story-intro p').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent))).toEqual([]);
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: { ...catalogue, events: [], screens: [] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'The next plan is still cooking.' })).toBeVisible();
});


test('packaged public screens load bundled payment marks and the current host portrait', async ({ page }, info) => {
  const withHost = { ...catalogue, events: [guest], screens: [{ ...catalogue.screens![1], host: { slug: 'kofi-bills', name: 'Kofi Bills', role: 'Host', city: 'Accra', verificationStatus: 'verified', profileImageUrl: '/hosts/kofi-bills.webp' } }] };
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: withHost, headers: { 'access-control-allow-origin': '*' } }));
  // Host portraits are current public catalogue assets, not private/local state.
  // The server's actual cross-origin response policy is covered by its own gate.
  await page.route(`${origin}/hosts/kofi-bills.webp`, async route => route.fulfill({ body: await readFile(new URL('../../public/hosts/kofi-bills.webp', import.meta.url)), contentType: 'image/webp', headers: { 'cross-origin-resource-policy': 'cross-origin' } }));
  await page.goto('/');
  const footer = page.locator('.payment-footer');
  await footer.scrollIntoViewIfNeeded();
  const marks = footer.locator('img');
  await expect(marks).toHaveCount(7);
  await expect.poll(() => marks.evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(await marks.evaluateAll(images => images.every(image => new URL((image as HTMLImageElement).currentSrc).origin === location.origin))).toBe(true);
  await page.screenshot({ path: info.outputPath('bundled-payment-marks.png') });
  await page.goto(`/event/${guest.slug}`);
  const portrait = page.locator('.event-host img');
  await portrait.scrollIntoViewIfNeeded();
  await expect(portrait).toHaveAttribute('src', `${origin}/hosts/kofi-bills.webp`);
  await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.event-host')).toContainText('Verified host');
  await page.screenshot({ path: info.outputPath('current-host-portrait.png') });
});

test('absolute native artwork keeps the same portrait hero geometry as the website', async ({ page }, info) => {
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: { ...catalogue, events: [guest], screens: [catalogue.screens![1]] }, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/');
  const hero = page.locator('.compact-hero');
  const artwork = hero.locator('img.compact-hero__image--active');
  await expect(artwork).toHaveAttribute('data-portrait-crop', 'true');
  await expect(hero).toHaveCSS('height', '560px');
  await expect(artwork).toHaveCSS('height', '300px');
  // The kicker intentionally overlaps the faded artwork edge. The actual
  // title and actions must remain below it and inside the shared hero frame.
  const geometry = await hero.evaluate(element => {
    const title = element.querySelector('h1')!.getBoundingClientRect();
    const image = element.querySelector('.compact-hero__image--active')!.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    const actions = element.querySelector('.hero-actions')!.getBoundingClientRect();
    return { titleTop: title.top, imageBottom: image.bottom, actionsBottom: actions.bottom, heroBottom: frame.bottom };
  });
  expect(geometry.titleTop).toBeGreaterThan(geometry.imageBottom);
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.heroBottom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  await page.screenshot({ path: info.outputPath('shared-portrait-hero.png') });
});
