import { expect, test, expectWebsiteDiscovery, nextWebsiteEvents } from "./catalogue";
import { expectSegmentedSelection } from "./segmented-control";

test.use({ serviceWorkers: "block" });

test("date selection survives an event visit and clearing restores the catalogue", async ({ page, eventSlug, catalogue }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!process.env.E2E_BASE_URL) await page.clock.setFixedTime(new Date("2026-09-19T12:00:00Z"));
  await page.goto("/events");
  if (!await expectWebsiteDiscovery(page, catalogue)) return;
  const date = page.getByLabel("Pick a date");
  await expect(date).toBeEnabled();
  const now = process.env.E2E_BASE_URL ? Date.now() : Date.parse("2026-09-19T12:00:00Z");
  const datedEvent = nextWebsiteEvents(catalogue, now).find(event => event.startsAt && Date.parse(event.startsAt) > now);
  const selectedDate = datedEvent?.startsAt?.slice(0, 10) ?? "2099-12-31";
  const slug = datedEvent?.slug ?? eventSlug;
  await date.fill(selectedDate);
  if (datedEvent) {
    await expect(page.locator(`.drop-card[data-event-slug="${slug}"]`)).toBeVisible();
    await page.locator(`.drop-card[data-event-slug="${slug}"] h3 a`).click();
  } else {
    await expect(page.getByRole("heading", { name: "Even Accra has a quiet corner." })).toBeVisible();
    await page.locator('.directory-header a[href="/"]').first().click();
  }
  await expect(page).toHaveURL(datedEvent ? new RegExp(`/event/${slug}$`) : /\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/events$/);
  await expect(date).toHaveValue(selectedDate);
  await date.fill("2099-12-31");
  await expect(page.getByRole("heading", { name: "Even Accra has a quiet corner." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(date).toHaveValue("");
  await expect(page.getByRole("button", { name: "Next up", exact: true })).toHaveAttribute("aria-pressed", "true");
  const upcoming = nextWebsiteEvents(catalogue, now);
  await expect(page.locator('.drop-card')).toHaveCount(Math.min(upcoming.length, 12));
  if (!upcoming.length) await expect(page.getByRole('heading', { name: 'Even Accra has a quiet corner.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("discovery-dates.png"), fullPage: true });
  await page.locator(".discovery-filters summary").click();
  await expect(page.getByLabel("Area", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Amapiano", exact: true }).click();
  await expect(page.locator(".discovery-filters summary")).toContainText("Filters (1)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("discovery-filters-expanded.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 850 });
  await date.fill(selectedDate);
  await expect(date).toHaveValue(selectedDate);
  await expect(page.getByLabel("Area", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator(".discovery-filters summary")).toBeVisible();
  await page.screenshot({ path: info.outputPath("discovery-narrow-date-expanded.png"), fullPage: true });
  // An explicit date legitimately clears the relative date-window selection.
  await page.getByRole("button", { name: "Next up", exact: true }).click();
  await expectSegmentedSelection(page.getByRole("group", { name: "When", exact: true }));
  await page.screenshot({ path: info.outputPath("discovery-narrow-expanded.png"), fullPage: true });
});

test("an active night leads with its pass and keeps the Room within reach", async ({ page, eventSlug }, info) => {
  const now = Date.now();
  await page.route("**/api/customer/registrations", route => route.fulfill({ json: { registrations: [] } }));
  await page.route("**/api/customer/my-nights", route => route.fulfill({ json: {
    attendee: { displayName: "Ama" }, nights: [{
      eventSlug: `${eventSlug}`, title: "Tonight in Accra", startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 3600000).toISOString(),
      venue: "The venue", area: "Osu", imageUrl: "/atmospheres/behind-the-night.webp", eventState: "on_sale", isTestEvent: false,
      ticketCount: 1, purchased: true, roomAccess: true, keepPosted: false, updateCount: 0,
    }],
  } }));
  await page.goto("/my-nights");
  const ticket = page.getByRole("link", { name: "Show my ticket", exact: true });
  await expect(ticket).toHaveAttribute("href", `/my-nights/${eventSlug}?view=passes`);
  await expect(page.locator('.night-listing__actions').getByRole("link", { name: "The Room", exact: true })).toHaveAttribute("href", `/room/${eventSlug}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("my-nights-pass-access.png"), fullPage: true });
});

test("a failed night load can retry without asking an authenticated guest to recover access", async ({ page, eventSlug }) => {
  let attempts = 0;
  await page.route(`**/api/customer/experience/${eventSlug}`, route => {
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: "Unavailable" } } : { json: {
      attendee: { displayName: "Ama" }, preference: { attendeeVisible: false, keepPosted: false }, questions: [], updates: [], memories: [], visibleAttendees: 1,
    } });
  });
  await page.route("**/api/customer/tickets", route => route.fulfill({ json: { attendee: { attendeeId: "test-guest" }, orders: [] } }));
  await page.route("**/api/customer/wallet/config", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(`/my-nights/${eventSlug}?view=passes`);
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByText("This night needs its ticket.")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Night views" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("RSVP approval refreshes an already-open Upcoming feed and survives reload", async ({ page, eventSlug }) => {
  let status = 'requested', feedReads = 0;
  const now = Date.now();
  await page.clock.install();
  await page.route('**/api/customer/notifications', route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route('**/api/customer/registrations', route => route.fulfill({ json: { registrations: [{ id: 'approval-fixture', eventSlug, title: 'Approval fixture', kind: 'rsvp', status, partySize: 1, maxPartySize: 1, mode: 'rsvp', roomAccess: 1 }] } }));
  await page.route('**/api/customer/my-nights', route => {
    feedReads++;
    return route.fulfill({ json: { attendee: { displayName: 'Guest' }, nights: status === 'confirmed' ? [{
      eventSlug, title: 'Approval fixture', startsAt: new Date(now + 3600000).toISOString(), endsAt: new Date(now + 7200000).toISOString(),
      venue: 'Fixture venue', area: 'Osu', imageUrl: '/atmospheres/behind-the-night.webp', eventState: 'on_sale', isTestEvent: false,
      ticketCount: 1, purchased: true, admissionActive: true, registrationMode: 'rsvp', roomAccess: true, keepPosted: false, updateCount: 0,
    }] : [] } });
  });
  await page.goto('/my-nights');
  await expect(page.getByRole('heading', { name: 'Your next night is out there.' })).toBeVisible();
  await expect(page.locator('.my-registrations [data-status="requested"]')).toHaveCount(1);
  expect(feedReads).toBe(1);
  status = 'confirmed';
  await page.clock.runFor(71_000);
  await expect(page.getByRole('link', { name: 'Show my RSVP pass', exact: true })).toHaveAttribute('href', `/my-nights/${eventSlug}?view=passes`);
  await expect(page.locator('.night-listing__actions').getByRole('link', { name: 'The Room', exact: true })).toHaveAttribute('href', `/room/${eventSlug}`);
  expect(feedReads).toBe(2);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Show my RSVP pass', exact: true })).toBeVisible();
  status = 'cancelled';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Show my RSVP pass', exact: true })).toHaveCount(0);
  await expect(page.locator('.night-listing__actions').getByRole('link', { name: 'The Room', exact: true })).toHaveCount(0);
});

test('explicit recovery can switch email-owner proof without signing out another valid session', async ({ page }) => {
  let recoveries = 0;
  await page.route('**/api/customer/my-nights', route => route.fulfill({ json: { attendee: { displayName: 'Another guest' }, nights: [] } }));
  await page.route('**/api/customer/registrations', route => route.fulfill({ json: { registrations: [] } }));
  await page.route('**/api/customer/recovery', route => { recoveries++; return route.fulfill({ json: { sent: true } }); });
  await page.goto('/my-nights?recover=1');
  await expect(page.getByLabel('Booking or registration email')).toBeVisible();
  expect(recoveries).toBe(0);
  await page.getByLabel('Booking or registration email').fill('approved-guest@example.com');
  await page.getByRole('button', { name: 'Bring back my Nights' }).click();
  await expect(page.getByRole('button', { name: 'Check your email' })).toBeDisabled();
  expect(recoveries).toBe(1);
});

test('recovery is unavailable before hydration and preserves early entry through initial reads', async ({ page }) => {
  let releaseScripts!: () => void, releaseReads!: () => void;
  const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
  const readsReady = new Promise<void>(resolve => { releaseReads = resolve; });
  const recoveryBodies: unknown[] = [];
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'script') await scriptsReady;
    await route.fallback();
  });
  await page.route('**/api/customer/my-nights', async route => {
    await readsReady;
    await route.fulfill({ json: { attendee: { displayName: 'Another guest' }, nights: [] } });
  });
  await page.route('**/api/customer/registrations', async route => {
    await readsReady;
    await route.fulfill({ json: { registrations: [] } });
  });
  await page.route('**/api/customer/recovery', route => {
    recoveryBodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { sent: true } });
  });
  try {
    await page.goto('/my-nights?recover=1', { waitUntil: 'commit' });
    const email = page.getByLabel('Booking or registration email');
    const submit = page.getByRole('button', { name: 'Bring back my Nights' });
    await expect(email).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Getting secure recovery ready' })).toBeVisible();
    expect(recoveryBodies).toEqual([]);
    releaseScripts();
    await email.fill('approved-guest@example.com');
    await expect(email).toHaveValue('approved-guest@example.com');
    releaseReads();
    await expect(page.getByText('For Another guest', { exact: true })).toBeVisible();
    await expect(email).toHaveValue('approved-guest@example.com');
    await submit.click();
    await expect(page.getByRole('button', { name: 'Check your email' })).toBeDisabled();
    expect(recoveryBodies).toEqual([{ email: 'approved-guest@example.com' }]);
  } finally {
    releaseScripts();
    releaseReads();
  }
});

function approvedOrder(eventSlug: string) {
  return {
    orderId: 'approval-order', reference: 'BCT-APPROVAL', eventSlug, faceAmountMinor: 0, bookingFeeMinor: 0, totalAmountMinor: 0,
    currency: 'GHS', quantity: 1, paidAt: new Date().toISOString(), bookedFor: null, canViewPurchase: true, roomAccess: true,
    tierName: 'RSVP', tierDescription: null, roomBadge: null,
    event: { title: 'Approved RSVP fixture', date: 'Tonight', venue: 'Fixture venue', state: 'on_sale' },
    tickets: [{ id: 'approval-pass', ticketType: 'rsvp', status: 'issued', checkedInAt: null, gateCode: 'RSVP-APPROVED', qrPayload: 'isolated-rsvp-pass' }],
  };
}

test('a denied Room rechecks access immediately on focus after approval', async ({ page, eventSlug }) => {
  let approved = false, accessReads = 0;
  const room = { eventSlug, eventTitle: 'Approved RSVP fixture', readOnly: false, readOnlyAt: new Date(Date.now() + 86400000).toISOString() };
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated fixture' } }));
  await page.route(`**/api/rooms/${eventSlug}/access`, route => {
    accessReads++;
    return route.fulfill(approved ? { json: { allowed: true, attendee: { id: 'approved-guest' }, room } } : { status: 403, json: { error: 'Your RSVP is awaiting approval.' } });
  });
  await page.route(`**/api/rooms/${eventSlug}/flashes`, route => route.fulfill({ json: { flashes: [], expiresAt: room.readOnlyAt } }));
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => socket.send(JSON.stringify({ type: 'snapshot', room, messages: [], online: 1 })));
  await page.goto(`/room/${eventSlug}`);
  await expect(page.getByRole('heading', { name: 'This Room is ticket-locked.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check access again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your passes securely' })).toHaveAttribute('href', '/my-nights?recover=1');
  approved = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('textbox', { name: 'Message The Room' })).toBeVisible();
  expect(accessReads).toBeGreaterThanOrEqual(2);
});

test('an already-open legacy wallet shows an approved pass immediately on focus', async ({ page, eventSlug }) => {
  let approved = false, roomAccess = true;
  await page.route('**/api/customer/tickets', route => route.fulfill({ json: {
    attendee: { attendeeId: 'approved-guest', displayName: 'Guest', emailVerified: true }, orders: approved ? [{ ...approvedOrder(eventSlug), roomAccess }] : [],
  } }));
  await page.route('**/api/customer/wallet/config', route => route.fulfill({ json: { apple: false, google: false } }));
  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'Good to see you, Guest.' })).toBeVisible();
  await expect(page.locator('.wallet-pass')).toHaveCount(0);
  approved = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('img', { name: 'Entry QR code for pass 1' })).toBeVisible();
  await expect(page.getByText('RSVP-APPROVED', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enter The Room', exact: true })).toBeVisible();
  roomAccess = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Enter The Room', exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Entry QR code for pass 1' })).toBeVisible();
});

test('a denied night hub rechecks the same event on focus after approval', async ({ page, eventSlug }) => {
  let approved = false;
  await page.route(`**/api/customer/experience/${eventSlug}`, route => route.fulfill(approved ? { json: {
    attendee: { displayName: 'Guest' }, preference: { attendeeVisible: false, keepPosted: false }, questions: [], updates: [], memories: [], visibleAttendees: 1,
  } } : { status: 403, json: { error: 'Your RSVP is awaiting approval.' } }));
  await page.route('**/api/customer/tickets', route => route.fulfill({ json: { attendee: { attendeeId: 'approved-guest' }, orders: approved ? [approvedOrder(eventSlug)] : [] } }));
  await page.route('**/api/customer/wallet/config', route => route.fulfill({ json: { apple: false, google: false } }));
  await page.goto(`/my-nights/${eventSlug}?view=passes`);
  await expect(page.getByRole('heading', { name: 'Open your passes securely.' })).toBeVisible();
  approved = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('img', { name: 'Entry QR code for ticket 1' })).toBeVisible();
  await expect(page.getByText('RSVP-APPROVED', { exact: true })).toBeVisible();
});
