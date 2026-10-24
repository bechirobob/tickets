import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './analytics-fixture';
async function settledClick(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded();
  let previous = '', stable = 0;
  await expect.poll(async () => {
    const position = await target.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return JSON.stringify([scrollX, scrollY, rect.x, rect.y, rect.width, rect.height]);
    });
    stable = position === previous ? stable + 1 : 0; previous = position;
    return stable;
  }, { intervals: [50], timeout: 5000 }).toBeGreaterThanOrEqual(3);
  await target.click();
}
async function recordGeometry(page: Page) {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    Object.assign(window, { rsvpPointerGeometry: log });
    const ids = new WeakMap<Element, number>(); let nextId = 1;
    function describe(element: Element | null) {
      if (!element) return null;
      if (!ids.has(element)) ids.set(element, nextId++);
      const rect = element.getBoundingClientRect();
      return { id: ids.get(element), tag: element.tagName, class: element.getAttribute('class'), text: element.textContent?.slice(0, 80), x: rect.x, y: rect.y, width: rect.width, height: rect.height, disabled: element.hasAttribute('disabled'), busy: element.getAttribute('aria-busy'), connected: element.isConnected, reactBound: Object.keys(element).some(key => key.startsWith('__reactProps')) };
    }
    function state() {
      const arrival = document.querySelector('[data-testid="brand-arrival"]');
      const trigger = Array.from(document.querySelectorAll('.registration-form button')).find(el => el.textContent?.trim() === 'RSVP') ?? null;
      return { time: performance.now(), ready: document.readyState, scrollX, scrollY, modality: document.documentElement.dataset.inputModality, summary: describe(document.querySelector('.registration-manage summary')), trigger: describe(trigger), open: document.querySelector('.registration-manage')?.hasAttribute('open'), namePresent: Boolean(document.querySelector('input[name="guestName"]')), arrivalHidden: arrival?.hasAttribute('hidden'), arrivalRunning: arrival?.hasAttribute('data-running'), arrivalPointer: arrival ? getComputedStyle(arrival).pointerEvents : null, focused: describe(document.activeElement) };
    }
    for (const type of ['pointerdown', 'mousedown', 'focusin', 'pointerup', 'mouseup', 'click', 'toggle', 'scroll', 'touchstart', 'touchend']) {
      window.addEventListener(type, event => {
        if (log.length >= 1000) return;
        const pointer = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : null;
        const entry = { type, ...state(), target: describe(event.target instanceof Element ? event.target : null), pointer, hit: pointer ? describe(document.elementFromPoint(pointer.x, pointer.y)) : null, defaultPrevented: event.defaultPrevented, preventedAfter: false };
        log.push(entry);
        queueMicrotask(() => { entry.preventedAfter = event.defaultPrevented; });
      }, true);
    }
    document.addEventListener('DOMContentLoaded', () => {
      log.push({ type: 'DOMContentLoaded', ...state() });
      new MutationObserver(records => {
        if (log.length >= 1000) return;
        if (records.some(r => r.target instanceof Element && (r.target.closest('.registration-form, .my-registrations, .brand-arrival') || Array.from(r.addedNodes).some(n => n instanceof Element && n.matches('.registration-form, .my-registrations, .brand-arrival'))))) log.push({ type: 'mutation', ...state() });
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'open', 'hidden', 'data-running', 'aria-busy'] });
    });
  });
}
test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const events = await page.evaluate(() => (window as Window & { rsvpPointerGeometry?: unknown[] }).rsvpPointerGeometry ?? []);
  await info.attach('rsvp-pointer-geometry', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
});
for (const variant of ['mouse-settled'] as const) {
test(`${variant}: My Nights distinguishes waitlisted guests from confirmed passes and supports cancellation`, async ({ page }) => {
  await recordGeometry(page);
  let status = 'waitlisted';
  await page.route('**/api/customer/my-nights', route => route.fulfill({ json: { attendee: { displayName: 'Ama' }, nights: [] } }));
  await page.route('**/api/customer/notifications', route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route('**/api/customer/registrations', route => {
    if (route.request().method() === 'POST') { expect(route.request().postDataJSON().action).toBe('cancel'); status = 'cancelled'; return route.fulfill({ json: { registration: { status } } }); }
    return route.fulfill({ json: { registrations: [{ id: 'browser-rsvp', eventSlug: 'after-dark-osu', title: 'After Dark: Osu', kind: 'rsvp', status, partySize: 2, maxPartySize: 3, mode: 'rsvp', roomAccess: 0 }] } });
  });
  await page.goto('/my-nights?view=rsvps');
  const section = page.locator('.my-registrations');
  await expect(section).toContainText('On the waitlist · your spot isn’t confirmed yet');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  status = 'confirmed'; await page.reload();
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveAttribute('href', '/my-nights/after-dark-osu?view=passes');
  await settledClick(page, section.locator('summary'));
  await section.getByRole('button', { name: 'Cancel RSVP' }).click();
  await section.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(section).toContainText('Cancelled');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('.my-registrations').analyze()).violations).toEqual([]);
});

for (const routeName of ['event', 'rsvp']) {
  test(`${variant}: ${routeName} RSVP shows live approval for its event after submission, resume and reload`, async ({ page }) => {
    let status: string | null = null;
    const roomAccess = routeName === 'event' ? 1 : 0;
    await page.clock.install();
    await recordGeometry(page);
    await page.route('**/api/customer/registrations?eventSlug=after-dark-osu', route => route.fulfill({ json: { registrations: [
      ...(status ? [{ id: 'live-rsvp', eventSlug: 'after-dark-osu', title: 'After Dark: Osu', kind: 'rsvp', status, partySize: 1, maxPartySize: 3, mode: 'rsvp', roomAccess }] : []),
      { id: 'unrelated', eventSlug: 'another-event', title: 'Unrelated private registration', kind: 'rsvp', status: 'confirmed', partySize: 1, maxPartySize: 1, mode: 'rsvp', roomAccess: 1 },
    ] } }));
    await page.route('**/api/registrations', route => { status = 'requested'; return route.fulfill({ status: 202, json: { message: 'RSVP received.', canManage: true } }); });
    await page.goto(`/${routeName}/after-dark-osu`);
    const form = page.locator('.registration-form');
    if (routeName === 'event') {
      const trigger = form.getByRole('button', { name: 'RSVP', exact: true });
      await settledClick(page, trigger);
    }
    await form.getByLabel('Your name').fill('Approval Guest');
    await form.getByLabel('Email address').fill('approval-fixture@example.com');
    await form.getByRole('checkbox', { name: /I accept the event terms/ }).check();
    await form.getByRole('button', { name: 'Send RSVP' }).click();
    await expect(form.locator('[data-status="requested"]')).toBeVisible();
    await expect(form.getByText('Unrelated private registration')).toHaveCount(0);
    await expect(form.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
    status = 'confirmed';
    if (routeName === 'event') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    else await page.clock.runFor(71_000);
    await expect(form.locator('[data-status="confirmed"]')).toBeVisible();
    await expect(form.getByRole('heading', { name: 'RSVP received.' })).toHaveCount(0);
    await expect(form.getByRole('link', { name: 'Show my QR passes' })).toHaveAttribute('href', '/my-nights/after-dark-osu?view=passes');
    await expect(form.getByRole('link', { name: 'The Room', exact: true })).toHaveCount(roomAccess);
    await page.reload();
    await expect(form.locator('[data-status="confirmed"]')).toBeVisible();
    await expect(form.getByLabel('Email address')).toHaveCount(0);
    status = 'cancelled';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(form.locator('[data-status="cancelled"]')).toBeVisible();
    await expect(form.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
    await expect(form.getByRole('link', { name: 'The Room', exact: true })).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Request my RSVP' })).toBeVisible();
  });
}


}
