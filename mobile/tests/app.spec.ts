import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const origin = 'https://tickets.becoreops.com';
const braai = { slug: 'the-weekend-braai', title: 'The Weekend Braai — Birthday Edition', image: '/events/the-weekend-braai.jpeg', venue: 'Number Nineteen', area: 'No. 19 Akosombo Street, Airport Residential Area, Accra', vibe: 'Day party', fullDate: 'Sunday 20 September 2026', time: '14:00 onwards', startsAt: '2026-09-20T14:00:00.000Z', scheduleStatus: 'end_pending', isVerified: true, eventState: 'on_sale', priceFromMinor: 35000, ticketsAvailable: false, colourScheme: 'sunset', dressCode: null, guestPerk: 'Unlimited grills & drinks', awarenessNote: null, lineup: 'Kofi Billz × Ghadi × Shepherd', ageRestriction: '18+', note: 'Grills, beers, tequila and games.', quip: 'Come hungry. Leave legendary.' };
const guest = { ...braai, slug: 'sun-chasers-labadi', title: 'On The Guest List', image: '/events/on-the-guest-list.webp', venue: 'Asana Restaurant', area: 'Kempinski Gold Coast Hotel, Accra', colourScheme: 'blush', startsAt: null, fullDate: 'Coming soon', scheduleStatus: 'coming_soon', dressCode: 'Light pink & white', guestPerk: 'Free mimosas till 5pm', quip: 'Your name looks good here.', lineup: 'Kofi Billz', note: 'Good music, familiar faces and a little pink for a cause close to many hearts.' };
const data = { version: 1, updatedAt: new Date().toISOString(), events: [braai, guest] };

test.beforeEach(async ({ page }) => {
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${origin}/events/*`, async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ body: await readFile(new URL(`../../public${path}`, import.meta.url)), contentType: path.endsWith('webp') ? 'image/webp' : 'image/jpeg' });
  });
});

test('discovery uses aligned full posters, unique routes and event palettes', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: braai.title })).toBeVisible();
  await expect.poll(() => page.locator('.event-card img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const posters = await page.locator('.event-card .poster').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, fit: getComputedStyle(node.querySelector('img')!).objectFit })));
  expect(posters).toHaveLength(2); expect(posters[0]).toEqual(posters[1]); expect(posters[0].fit).toBe('contain');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('app-drop.png'), fullPage: true });
  await page.getByRole('heading', { name: guest.title }).click();
  await expect(page.getByRole('heading', { level: 1, name: guest.title })).toBeVisible();
  await expect(page.getByText('Light pink & white')).toBeVisible();
  await expect(page.getByText('Free mimosas till 5pm')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get tickets' })).toHaveCount(0);
  await expect(page.locator('.app')).toHaveCSS('background-color', 'rgb(255, 249, 248)');
  await page.screenshot({ path: info.outputPath('app-event.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to The Drop' }).click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'More', exact: true }).getByRole('button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
});

test('offline catalogue is labelled, retries recover and storage contains no identity', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: braai.title })).toBeVisible();
  await page.route(`${origin}/api/public/events`, route => route.abort());
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/Saved events/)).toBeVisible();
  await expect(page.getByRole('heading', { name: braai.title })).toBeVisible();
  await page.route(`${origin}/api/public/events`, route => route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['becore.public-catalogue.v1']);
});

test('ticket access opens the secure web destination without fake native sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'My Nights', exact: true }).click();
  await expect(page.getByText('Opens securely in your browser.', { exact: true })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open My Nights' }).click();
  const opened = await popup;
  await expect.poll(() => opened.url()).toBe(`${origin}/my-nights`);
  await opened.close();
});

test('small screens keep all event text and controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('heading', { name: braai.title }).click();
  await expect(page.getByRole('heading', { level: 1, name: braai.title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const clipped = await page.locator('h1,h2,dd,.card-venue,.card-price').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
  expect(clipped).toEqual([]);
  await page.getByRole('button', { name: 'Bring your people' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Bring your people' })).toBeInViewport();
});

test('back restores discovery position and edge gestures distinguish scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: braai.title })).toBeVisible();
  await page.getByRole('heading', { name: braai.title }).scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  await page.getByRole('heading', { name: braai.title }).click();
  await expect(page.getByRole('heading', { level: 1, name: braai.title })).toBeFocused();
  const content = page.locator('main');
  await content.dispatchEvent('touchstart', { touches: [{ clientX: 10, clientY: 180 }] });
  await content.dispatchEvent('touchend', { changedTouches: [{ clientX: 120, clientY: 310 }] });
  await expect(page.getByRole('heading', { level: 1, name: braai.title })).toBeVisible();
  await content.dispatchEvent('touchstart', { touches: [{ clientX: 10, clientY: 180 }] });
  await content.dispatchEvent('touchend', { changedTouches: [{ clientX: 140, clientY: 190 }] });
  await expect(page.getByRole('heading', { level: 1, name: 'The Drop' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name: 'The Drop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('enlarged text and reduced motion keep every detail readable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 25.5px !important; }' });
  await page.getByRole('heading', { name: guest.title }).click();
  await expect(page.locator('main')).toHaveCSS('animation-name', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('h1,h2,dd,.description,button').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent))).toEqual([]);
  await page.getByRole('button', { name: 'Bring your people' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Bring your people' })).toBeInViewport();
});
