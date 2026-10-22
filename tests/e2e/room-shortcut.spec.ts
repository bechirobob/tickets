import AxeBuilder from '@axe-core/playwright';
import { expect, test as base } from './catalogue';

const test = base.extend({ eventSlug: async ({ catalogue }, provide) => {
  const event = catalogue.events.find(candidate => candidate.scheduleStatus === 'confirmed');
  expect(event, 'The Room fixture needs a published event with a confirmed schedule').toBeTruthy();
  await provide(event!.slug);
} });

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated Room fixture' } }));
});
const expiry = () => new Date(Date.now() + 3600_000).toISOString();

test('Room summaries do not poll behind the desktop breakpoint and refresh on mobile re-entry', async ({ page, eventSlug }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.clock.install();
  let requests = 0;
  await page.route('**/api/customer/room-updates', route => {
    requests++;
    return route.fulfill({ json: { rooms: [{ eventSlug, title: 'Garden', unread: 2, expiresAt: expiry() }], unread: 2 } });
  });
  await page.goto('/');
  const dock = page.getByRole('navigation', { name: 'Customer navigation', includeHidden: true });
  await expect(dock).toBeHidden(); await page.clock.fastForward(60_000); expect(requests).toBe(0);
  await page.setViewportSize({ width: 700, height: 800 });
  const room = dock.getByRole('link', { name: 'Room, 2 new updates' });
  await expect(room).toBeVisible(); expect(requests).toBe(1);
  await page.clock.fastForward(30_000); await expect.poll(() => requests).toBe(2);
  await page.setViewportSize({ width: 701, height: 800 });
  await expect(room).toHaveCount(0); await page.clock.fastForward(60_000); expect(requests).toBe(2);
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(room).toBeVisible(); expect(requests).toBe(3);
});

test('a quiet visible Room retries a transient read failure with the same rendered boundary', async ({ page, eventSlug }) => {
  await page.clock.install();
  const room = { eventSlug, eventTitle: 'Garden Party', readOnly: false, readOnlyAt: expiry() };
  let marks = 0, access = 0, connections = 0;
  let accessAtFirstMark = 0, connectionsAtFirstMark = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access')) { access++; return route.fulfill({ json: { allowed: true, attendee: { id: 'self' }, room, updateSnapshot: 'viewed-boundary' } }); }
    if (path.endsWith('/updates/read')) {
      marks++;
      // Initial page lifecycle events may restart access before a boundary renders.
      if (marks === 1) { accessAtFirstMark = access; connectionsAtFirstMark = connections; }
      expect(route.request().postDataJSON()).toEqual({ snapshot: 'viewed-boundary' });
      return route.fulfill(marks === 1 ? { status: 503, json: { error: 'Try again' } } : { json: { updated: true } });
    }
    if (path.endsWith('/flashes')) return route.fulfill({ json: { flashes: [] } });
    return route.fulfill({ status: 401, json: { error: 'Isolated fixture' } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => { connections++; socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online: 1 })); });
  await page.goto(`/room/${eventSlug}`); await expect(page.locator('.room-stream')).toBeVisible();
  await expect.poll(() => marks).toBe(1);
  expect(accessAtFirstMark).toBeGreaterThan(0); expect(connectionsAtFirstMark).toBeGreaterThan(0);
  await page.clock.fastForward(1000); await expect.poll(() => marks).toBe(2);
  expect(access).toBe(accessAtFirstMark); expect(connections).toBe(connectionsAtFirstMark);
  await page.clock.fastForward(10_000); expect(marks).toBe(2);
  expect(access).toBe(accessAtFirstMark); expect(connections).toBe(connectionsAtFirstMark);
});

for (const boundary of ['hidden', 'unmounted'] as const) {
  test(`a ${boundary} Room cancels pending transient acknowledgement retries`, async ({ page, eventSlug }) => {
    await page.clock.install();
    const room = { eventSlug, eventTitle: 'Garden Party', readOnly: false, readOnlyAt: expiry() };
    let marks = 0;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/access')) return route.fulfill({ json: { allowed: true, attendee: { id: 'self' }, room, updateSnapshot: 'viewed-boundary' } });
      if (path.endsWith('/updates/read')) { marks++; return route.fulfill({ status: 503, json: { error: 'Try again' } }); }
      if (path.endsWith('/flashes')) return route.fulfill({ json: { flashes: [] } });
      return route.fulfill({ status: 401, json: { error: 'Isolated fixture' } });
    });
    await page.routeWebSocket(/\/api\/room\/socket/u, socket => socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online: 1 })));
    await page.goto(`/room/${eventSlug}`); await expect(page.locator('.room-stream')).toBeVisible(); await expect.poll(() => marks).toBe(1);
    if (boundary === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    else { await page.getByRole('link', { name: 'Back to My Nights' }).click(); await expect(page).toHaveURL(/\/my-nights$/u); }
    await page.clock.fastForward(10_000); expect(marks).toBe(1);
  });
}

test('the fourth dock item is private, count-only, responsive and directly opens one Room', async ({ page, eventSlug }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile dock');
  await page.setViewportSize({ width: 320, height: 740 });
  let allowed = false, requests = 0, inboxRequests = 0, sockets = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/customer/notifications') inboxRequests++; });
  page.on('websocket', () => sockets++);
  await page.route('**/api/customer/room-updates', route => {
    requests++;
    return route.fulfill({ json: { rooms: allowed ? [{ eventSlug, title: 'Garden Party', unread: 126, expiresAt: expiry() }] : [], unread: allowed ? 126 : 0 } });
  });
  await page.goto('/');
  const dock = page.getByRole('navigation', { name: 'Customer navigation' });
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(dock.getByRole('link')).toHaveCount(3);
  allowed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const room = dock.getByRole('link', { name: 'Room, 126 new updates' });
  await expect(room).toBeVisible(); await expect(room.locator('b')).toHaveText('99+');
  await expect(room).toHaveAttribute('href', `/room/${eventSlug}`);
  await expect(room.locator('svg')).toHaveCSS('width', '23px');
  expect(await room.boundingBox()).toMatchObject({ height: 54 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(inboxRequests).toBe(0); expect(sockets).toBe(0);
  expect((await new AxeBuilder({ page }).include('.customer-dock').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('room-dock-320.png') });
  await room.click(); await expect(page).toHaveURL(new RegExp(`/room/${eventSlug}$`, 'u'));
  await expect(dock).toHaveCount(0);
});

test('multiple Rooms use a count-only chooser, Back and Escape dismiss, navigation does not return to the chooser', async ({ page, eventSlug }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile dock');
  const title = 'A very long event title that wraps cleanly without exposing any private Room message';
  await page.route('**/api/customer/room-updates', route => route.fulfill({ json: { rooms: [
    { eventSlug, title, unread: 2, expiresAt: expiry() },
    { eventSlug: 'another-event', title: 'Another night', unread: 0, expiresAt: expiry() },
  ], unread: 2 } }));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Room, 2 new updates' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Choose your Room' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('link')).toHaveCount(2);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(dialog).toBeVisible(); await page.goBack(); await expect(dialog).toHaveCount(0);
  await trigger.click(); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole('link', { name: `${title}, 2 new updates` }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${eventSlug}$`, 'u'));
  await page.goBack(); await expect(page).toHaveURL(/\/$/u); await expect(dialog).toHaveCount(0);
});

test('zero unread has no badge and expired or failed summaries disappear on resume', async ({ page, eventSlug }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile dock');
  let state: 'active' | 'expired' | 'error' = 'active';
  await page.route('**/api/customer/room-updates', route => route.fulfill(state === 'error' ? { status: 503, json: { error: 'Unavailable' } } : { json: { rooms: [{ eventSlug, title: 'Garden', unread: 0, expiresAt: state === 'expired' ? '2026-01-01T00:00:00Z' : expiry() }], unread: 0 } }));
  await page.goto('/');
  const link = page.getByRole('navigation', { name: 'Customer navigation' }).getByRole('link', { name: 'Room', exact: true });
  await expect(link).toBeVisible(); await expect(link.locator('b')).toHaveCount(0);
  state = 'expired'; await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await expect(link).toHaveCount(0);
  state = 'active'; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect(link).toBeVisible();
  state = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(link).toHaveCount(0);
});

test('a Room acknowledges only its captured boundary after a visible successful snapshot', async ({ page, eventSlug }) => {
  const room = { eventSlug, eventTitle: 'Garden Party', readOnly: false, readOnlyAt: expiry() };
  let marks = 0;
  await page.addInitScript(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access')) return route.fulfill({ json: { allowed: true, attendee: { id: 'self' }, room, updateSnapshot: 'server-signed-boundary' } });
    if (path.endsWith('/updates/read')) { marks++; expect(route.request().postDataJSON()).toEqual({ snapshot: 'server-signed-boundary' }); return route.fulfill({ json: { updated: true } }); }
    if (path.endsWith('/flashes')) return route.fulfill({ json: { flashes: [] } });
    return route.fulfill({ status: 401, json: { error: 'Isolated fixture' } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online: 1 })));
  await page.goto(`/room/${eventSlug}`); await expect(page.locator('.room-stream')).toBeVisible(); expect(marks).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => marks).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); expect(marks).toBe(1);
});

test('same-page sign-out immediately clears private Room counts and the chooser', async ({ page, eventSlug }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile dock');
  let signedOut = false;
  await page.route('**/api/customer/tickets', route => route.fulfill({ json: { attendee: { attendeeId: 'self', displayName: 'Guest', emailVerified: true }, orders: [] } }));
  await page.route('**/api/customer/session', route => { if (route.request().method() !== 'DELETE') return route.fulfill({ status: 401, json: { signedIn: false } }); signedOut = true; return route.fulfill({ json: { signedOut: true } }); });
  await page.route('**/api/customer/room-updates', async route => {
    if (signedOut) { await new Promise(resolve => setTimeout(resolve, 3000)); await route.fulfill({ json: { rooms: [], unread: 0 } }).catch(() => {}); return; }
    return route.fulfill({ json: { rooms: [{ eventSlug, title: 'Private night', unread: 2, expiresAt: expiry() }, { eventSlug: 'another-night', title: 'Another night', unread: 1, expiresAt: expiry() }], unread: 3 } });
  });
  await page.goto('/tickets');
  const trigger = page.getByRole('button', { name: 'Room, 3 new updates' });
  await trigger.click(); await expect(page.getByRole('dialog', { name: 'Choose your Room' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(trigger).toHaveCount(0, { timeout: 1500 });
  await expect(page.getByRole('dialog', { name: 'Choose your Room' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/tickets$/u);
});

test('an expired read boundary requires fresh access and a new socket snapshot before retry', async ({ page, eventSlug }) => {
  await page.addInitScript((readPath: string) => {
    'use strict';
    const readViews: (string | null)[] = [];
    Object.assign(window, { roomReadViews: readViews });
    const fetch = window.fetch;
    window.fetch = function (this: unknown, ...args) {
      const input = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (new URL(input, location.href).pathname === readPath) {
        readViews.push(document.querySelector('.room-header__activity [aria-label$=" people online"]')?.getAttribute('aria-label') ?? null);
      }
      return fetch.apply(this, args);
    };
  }, `/api/rooms/${encodeURIComponent(eventSlug)}/updates/read`);
  const room = { eventSlug, eventTitle: 'Garden Party', readOnly: false, readOnlyAt: expiry() };
  let access = 0, marks = 0, connections = 0;
  let recovering = false, expiredBoundary = '', freshBoundary = '';
  const issuedBoundaries = new Set<string>();
  let expireBoundary: (() => Promise<void>) | undefined;
  let freshSnapshot: (() => void) | undefined;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access')) {
      const snapshot = `${recovering ? 'fresh' : 'expired'}-boundary-${++access}`;
      issuedBoundaries.add(snapshot);
      if (recovering) freshBoundary = snapshot;
      return route.fulfill({ json: { allowed: true, attendee: { id: 'self' }, room, updateSnapshot: snapshot } });
    }
    if (path.endsWith('/updates/read')) {
      marks++;
      if (marks === 1) {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ snapshot: expect.stringMatching(/^expired-boundary-\d+$/u) });
        expect(issuedBoundaries).toContain(body.snapshot);
        expiredBoundary = body.snapshot;
        // Complete initial navigation before deliberately expiring its rendered boundary.
        return new Promise<void>(resolve => { expireBoundary = async () => {
          recovering = true;
          await route.fulfill({ status: 400, json: { error: 'Expired boundary' } });
          resolve();
        }; });
      }
      expect(freshBoundary).toMatch(/^fresh-boundary-\d+$/u);
      expect(freshBoundary).not.toBe(expiredBoundary);
      expect(route.request().postDataJSON()).toEqual({ snapshot: freshBoundary });
      return route.fulfill({ json: { updated: true } });
    }
    if (path.endsWith('/flashes')) return route.fulfill({ json: { flashes: [] } });
    return route.fulfill({ status: 401, json: { error: 'Isolated fixture' } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => {
    connections++;
    const online = recovering ? 2 : 1;
    const send = () => socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online }));
    if (!recovering) send(); else freshSnapshot = send;
  });
  await page.goto(`/room/${eventSlug}`);
  await expect(page.locator('.room-stream')).toBeVisible(); await expect.poll(() => marks).toBe(1);
  const initialAccess = access, initialConnections = connections;
  expect(initialAccess).toBeGreaterThan(0); expect(initialConnections).toBeGreaterThan(0);
  await expireBoundary!();
  await expect.poll(() => access).toBe(initialAccess + 1); await expect.poll(() => connections).toBe(initialConnections + 1);
  expect(marks).toBe(1);
  freshSnapshot!(); await expect.poll(() => marks).toBe(2);
  expect(access).toBe(initialAccess + 1); expect(connections).toBe(initialConnections + 1);
  // Observe the rendered snapshot at fetch invocation, not delayed route delivery.
  expect(await page.evaluate(() => (window as Window & { roomReadViews?: (string | null)[] }).roomReadViews)).toEqual(['1 people online', '2 people online']);
});

test('top-only Room and notification panels stay clear of the header and dock and replace the menu', async ({ page, eventSlug }, info) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'Mobile dock');
  await page.setViewportSize({ width: 568, height: 320 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/customer/room-updates', route => route.fulfill({ json: { rooms: [
    { eventSlug, title: 'A longer event title that must wrap inside a compact top panel', unread: 125, expiresAt: expiry() },
    { eventSlug: 'another-night', title: 'Another night', unread: 0, expiresAt: expiry() },
  ], unread: 125 } }));
  await page.goto('/my-nights');
  const room = page.getByRole('button', { name: 'Room, 125 new updates' });
  const chooser = page.getByRole('dialog', { name: 'Choose your Room' });
  await room.click(); await expect(chooser).toBeVisible();
  const assertTopBounds = async (selector: string) => {
    const readBounds = () => page.evaluate(selector => {
      const panel = document.querySelector(selector)!.getBoundingClientRect();
      const header = document.querySelector('.directory-header')!.getBoundingClientRect();
      const dock = document.querySelector('.customer-dock')!.getBoundingClientRect();
      return { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right, headerBottom: header.bottom, dockTop: dock.top, width: innerWidth };
    }, selector);
    await expect.poll(async () => { const bounds = await readBounds(); return bounds.top - bounds.headerBottom; }).toBeGreaterThanOrEqual(7);
    const bounds = await readBounds();
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerBottom + 7);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.dockTop - 7);
    expect(bounds.left).toBeGreaterThanOrEqual(11); expect(bounds.right).toBeLessThanOrEqual(bounds.width - 11);
  };
  await assertTopBounds('.customer-room-chooser');
  await expect(chooser.locator('p')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('room-chooser-short-landscape.png') });
  await page.locator('.night-mobile-menu__trigger').click();
  await expect(chooser).toHaveCount(0);
  await expect(page.locator('.night-mobile-menu__panel')).toHaveAttribute('data-phase', 'open');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const buzz = page.getByRole('dialog', { name: 'The Buzz' });
  await expect(buzz).toBeVisible();
  await expect(page.locator('.night-mobile-menu__panel')).toHaveAttribute('data-phase', 'closed');
  await assertTopBounds('.notification-panel--dropdown');
  await room.click(); await expect(buzz).toHaveCount(0); await expect(chooser).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 210, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.dispatchEvent(new Event('resize'));
  });
  await expect(chooser).toBeVisible();
  expect((await chooser.boundingBox())!.y + (await chooser.boundingBox())!.height).toBeLessThanOrEqual(199);
  await page.evaluate(() => { Object.defineProperty(window.visualViewport!, 'height', { value: 140 }); window.dispatchEvent(new Event('resize')); });
  await expect(chooser).toHaveCount(0); // Too little room closes safely; never moves over the header.
});
