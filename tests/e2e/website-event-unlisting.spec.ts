import { expect, test, expectWebsiteDiscovery } from './catalogue';

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
    if (path === '/events' && await expectWebsiteDiscovery(page, catalogue)) {
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
  const accessResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/rooms/${slug}/access`);
  await page.goto(`/room/${slug}`);
  expect([401, 403]).toContain((await accessResponse).status());
  await expect(page.locator('.room-gate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This Room is ticket-locked.', exact: true })).toBeVisible();
  await expect(page.locator('.room-page')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message The Room' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This link left early.', exact: true })).toHaveCount(0);
});

test('temporary Kempinski unlisting preserves Room entry for an explicitly authorized guest fixture', async ({ page, catalogue }) => {
  const event = catalogue.events.find(event => event.slug === slug);
  expect(event, 'The direct-detail API must retain the published event').toBeTruthy();
  const room = { eventSlug: slug, eventTitle: event!.title, readOnly: false, readOnlyAt: new Date(Date.now() + 86400000).toISOString() };
  // Isolated authorization, following discovery-pass-access: no credentials,
  // real API writes or live Room connection are needed to exercise guest entry.
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated fixture' } }));
  await page.route(`**/api/rooms/${slug}/access`, route => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { allowed: true, attendee: { id: 'approved-guest' }, room } });
  });
  await page.route(`**/api/rooms/${slug}/flashes`, route => route.fulfill({ json: { flashes: [], expiresAt: room.readOnlyAt } }));
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online: 1 })));
  const response = await page.goto(`/room/${slug}`);
  expect(response?.ok()).toBe(true);
  await expect(page.locator('.room-page')).toBeVisible();
  await expect(page.locator('.room-page')).toContainText(event!.title);
  await expect(page.getByRole('textbox', { name: 'Message The Room' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message The Room' })).toBeEnabled();
  await expect(page.locator('.room-gate')).toHaveCount(0);
});
