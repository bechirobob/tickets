import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("date selection survives an event visit and clearing restores the catalogue", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/events");
  const date = page.getByLabel("Pick a date");
  await expect(date).toBeEnabled();
  const dated = page.locator('.drop-card:has(time[datetime])').first();
  const start = await dated.locator('time').getAttribute('datetime');
  const slug = await dated.getAttribute('data-event-slug');
  await date.fill(new Date(start!).toISOString().slice(0, 10));
  await expect(page.locator(`.drop-card[data-event-slug="${slug}"]`)).toBeVisible();
  await page.locator(`.drop-card[data-event-slug="${slug}"] h3 a`).click();
  await page.goBack();
  await expect(date).toHaveValue(new Date(start!).toISOString().slice(0, 10));
  await date.fill("2099-12-31");
  await expect(page.getByRole("heading", { name: "Even Accra has a quiet corner." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(date).toHaveValue("");
  await expect(page.getByRole("button", { name: "Next up", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.drop-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("discovery-dates.png"), fullPage: true });
});

test("an active night leads with its pass and keeps the Room within reach", async ({ page }, info) => {
  const now = Date.now();
  await page.route("**/api/customer/registrations", route => route.fulfill({ json: { registrations: [] } }));
  await page.route("**/api/customer/my-nights", route => route.fulfill({ json: {
    attendee: { displayName: "Ama" }, nights: [{
      eventSlug: "the-weekend-braai", title: "Tonight in Accra", startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 3600000).toISOString(),
      venue: "The venue", area: "Osu", imageUrl: "/icons/icon-192.png", eventState: "on_sale", isTestEvent: false,
      ticketCount: 1, purchased: true, roomAccess: true, keepPosted: false, updateCount: 0,
    }],
  } }));
  await page.goto("/my-nights");
  const ticket = page.getByRole("link", { name: "Show my ticket", exact: true });
  await expect(ticket).toHaveAttribute("href", "/my-nights/the-weekend-braai?view=passes");
  await expect(page.locator('.my-nights-actions').getByRole("link", { name: "The Room", exact: true })).toHaveAttribute("href", "/room/the-weekend-braai");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("my-nights-pass-access.png"), fullPage: true });
});

test("a failed night load can retry without asking an authenticated guest to recover access", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/customer/experience/the-weekend-braai", route => {
    attempts++;
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: "Unavailable" } } : { json: {
      attendee: { displayName: "Ama" }, preference: { attendeeVisible: false, keepPosted: false }, questions: [], updates: [], memories: [], visibleAttendees: 1,
    } });
  });
  await page.route("**/api/customer/tickets", route => route.fulfill({ json: { attendee: { attendeeId: "test-guest" }, orders: [] } }));
  await page.route("**/api/customer/wallet/config", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/my-nights/the-weekend-braai?view=passes");
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByText("This night needs its ticket.")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Night views" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});
