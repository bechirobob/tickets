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
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect(dock.getByRole('link')).toHaveText(['Home', 'The Drop', 'My Nights']);
  await dock.getByRole('link', { name: 'The Drop', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Find your next night.' })).toBeVisible();
  await expect.poll(() => page.locator('.drop-card__image img').evaluateAll(images => images.length === 2 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const posters = await page.locator('.drop-card__image').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, fit: getComputedStyle(node.querySelector('img')!).objectFit })));
  expect(posters).toHaveLength(2); expect(posters[0]).toEqual(posters[1]); expect(posters[0].fit).toBe('contain');
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
  const link = page.locator('.drop-card').getByRole('link', { name: /View event/ });
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
