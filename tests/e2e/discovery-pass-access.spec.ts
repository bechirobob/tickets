import { expect, test } from "./catalogue";

test.use({ serviceWorkers: "block" });

test("date selection survives an event visit and clearing restores the catalogue", async ({ page, eventSlug, catalogue }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/events");
  const date = page.getByLabel("Pick a date");
  await expect(date).toBeEnabled();
  const datedEvent = catalogue.events.find(event => event.startsAt && Date.parse(event.startsAt) > Date.now());
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
  await expect(page.locator('.drop-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("discovery-dates.png"), fullPage: true });
  await page.locator(".discovery-filters summary").click();
  await expect(page.getByLabel("Area", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Amapiano", exact: true }).click();
  await expect(page.locator(".discovery-filters summary")).toContainText("Filters (1)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("discovery-filters-expanded.png"), fullPage: true });
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
