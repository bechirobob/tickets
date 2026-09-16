import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "Isolated member fixture" } }));
  await page.route("**/api/customer/notifications", route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route("**/api/customer/registrations", route => route.fulfill({ json: { registrations: [] } }));
});

test("plans filter, search and restore without duplicated navigation", async ({ page }, info) => {
  const now = Date.now();
  const night = { startsAt: new Date(now + 86_400_000).toISOString(), endsAt: new Date(now + 100_000_000).toISOString(), venue: "Palm House", area: "Osu", imageUrl: "/atmospheres/behind-the-night.webp", eventState: "on_sale", isTestEvent: false, ticketCount: 2, purchased: true, roomAccess: true, keepPosted: false, attendeeVisible: false, hostSlug: null, hostName: null, updateCount: 2, questionCount: 0 };
  await page.route("**/api/customer/my-nights", route => route.fulfill({ json: { attendee: { displayName: "Ama" }, nights: [
    { ...night, eventSlug: "the-weekend-braai", title: "The Weekend Braai" },
    { ...night, eventSlug: "late-checkout", title: "Late Checkout", startsAt: new Date(now + 172_800_000).toISOString() },
    { ...night, eventSlug: "last-summer", title: "Last Summer", startsAt: new Date(now - 172_800_000).toISOString(), endsAt: new Date(now - 86_400_000).toISOString() },
    { ...night, eventSlug: "sunday-social", title: "Sunday Social", purchased: false, keepPosted: true },
  ] } }));
  await page.goto("/my-nights");
  await expect(page.getByRole("heading", { name: "My Nights", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Your account", exact: true })).toHaveCount(0);
  await expect(page.locator(".night-listing")).toHaveCount(2);
  await expect(page.locator(".night-listing--next")).toContainText("The Weekend Braai");
  await expect(page.getByRole("link", { name: "The Room", exact: true })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "2 host updates" }).first()).toHaveAttribute("href", /view=details#host-updates$/);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("my-nights-overview.png"), fullPage: true });
  await page.getByRole("searchbox", { name: "Find a night" }).fill("checkout");
  await expect(page.locator(".night-listing")).toHaveCount(1);
  await expect(page.locator(".night-listing")).toContainText("Late Checkout");
  await page.getByRole("searchbox").fill("unmatched");
  await expect(page.getByRole("heading", { name: "No matching nights." })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  const nav = page.getByRole("navigation", { name: "My Nights views" });
  await nav.getByRole("button", { name: /^Past/ }).click();
  await expect(page.locator(".night-listing")).toContainText("Last Summer");
  await page.reload();
  await expect(nav.getByRole("button", { name: /^Past/ })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: /^Following/ }).click();
  await expect(page.locator(".night-listing")).toContainText("Sunday Social");
  await expect(page.getByRole("link", { name: "The Room", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: /^RSVPs/ }).click();
  await expect(page.getByRole("heading", { name: "No RSVPs yet." })).toBeVisible();
});

test("registration-only guests keep access and cancellation is deliberate", async ({ page }, info) => {
  let status = "confirmed";
  let cancellations = 0;
  await page.route("**/api/customer/registrations", route => {
    if (route.request().method() === "POST") { cancellations++; status = "cancelled"; return route.fulfill({ json: { registration: { status } } }); }
    return route.fulfill({ json: { registrations: [{ id: "rsvp", eventSlug: "the-weekend-braai", title: "The Weekend Braai", kind: "rsvp", status, partySize: 2, maxPartySize: 3, mode: "rsvp", roomAccess: 0 }] } });
  });
  await page.goto("/my-nights");
  await expect(page.getByRole("link", { name: "Show my QR passes" })).toBeVisible();
  await expect(page.getByLabel("Booking or registration email")).toHaveCount(0);
  await page.locator(".registration-manage summary").click();
  await page.getByRole("button", { name: "Cancel RSVP", exact: true }).click();
  expect(cancellations).toBe(0);
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  expect(cancellations).toBe(0);
  await page.getByRole("button", { name: "Cancel RSVP", exact: true }).click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-rsvp.png"), fullPage: true });
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(cancellations).toBe(1);
});

test("recovery remains usable with reduced motion and without transparency", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/my-nights");
  await expect(page.getByRole("heading", { name: "Your plans are still here." })).toBeVisible();
  await page.route("**/api/customer/recovery", route => route.fulfill({ json: { sent: true } }));
  await page.getByLabel("Booking or registration email").fill("isolated@example.com");
  await page.getByRole("button", { name: "Bring back my Nights" }).click();
  await expect(page.getByRole("button", { name: "Check your email" })).toBeDisabled();
  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByRole("button", { name: "Bring back my Nights" })).toBeEnabled();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "The Buzz" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-notifications.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
});
