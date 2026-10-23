import { expect, test } from './catalogue';

test.use({ serviceWorkers: 'block' });
const slug = 'sun-chasers-labadi';

test('temporary Kempinski unlisting removes website discovery without cutting direct guest routes', async ({ page, catalogue }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const event = catalogue.events.find(event => event.slug === slug);
  expect(event, 'The direct-detail API must retain the published event').toBeTruthy();
  for (const path of ['/', '/events', '/hosts/kofi-bills']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator(`a[href="/event/${slug}"], a[href="/rsvp/${slug}"]`)).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('On The Guest List');
    if (path === '/') await expect(page.locator('.active-night-experience')).not.toHaveAttribute('data-active-night', slug);
    if (path === '/events') {
      const search = page.getByRole('searchbox', { name: 'Search events, artists or venues' });
      await search.fill('Kempinski');
      await expect(page.locator('.drop-card')).toHaveCount(0);
      await search.fill('On The Guest List');
      await expect(page.locator('.drop-card')).toHaveCount(0);
    }
  }
  expect(await (await page.request.get('/sitemap.xml')).text()).not.toContain(`/event/${slug}`);
  await page.goto(`/event/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'On The Guest List', exact: true })).toBeVisible();
  await page.goto(`/rsvp/${slug}`);
  await expect(page.getByRole('heading', { name: 'This link left early.', exact: true })).toHaveCount(0);
  await expect(page.locator('main')).toContainText('On The Guest List');
  await page.goto(`/room/${slug}`);
  await expect(page.locator('.room-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This link left early.', exact: true })).toHaveCount(0);
});
