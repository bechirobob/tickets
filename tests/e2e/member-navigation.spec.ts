import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "Isolated member fixture" } }));
});

test("notification failures preserve unread items and retry recovers the inbox", async ({ page }) => {
  let loads = 0;
  let marks = 0;
  const item = { id: "fixture-update", eventSlug: "after-dark-osu", kind: "host_update", title: "A note from the Host", body: "We’re using Gate 2 tonight. Bring your ticket and the friends you promised you’d bring.", url: "/my-nights/after-dark-osu?view=details", createdAt: new Date().toISOString(), readAt: null };
  await page.route("**/api/customer/notifications", async (route) => {
    if (route.request().method() === "PATCH") {
      marks++;
      expect(route.request().postDataJSON()).toEqual({ all: true });
      return route.fulfill(marks === 1 ? { status: 503, json: { error: "Could not mark notifications. Try again." } } : { json: { updated: true } });
    }
    loads++;
    return route.fulfill(loads === 1 ? { status: 503, json: { error: "Notifications are temporarily unavailable." } } : { json: { notifications: [item], unread: 1 } });
  });
  await page.goto("/notifications");
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("heading", { name: "Quiet. Suspiciously quiet." })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".buzz-list > a.unread")).toContainText(item.body);
  await expect(page.locator(".buzz-list > a")).toHaveAttribute("href", item.url);
  const mark = page.getByRole("button", { name: "Mark all read" });
  await mark.click();
  await expect(page.getByRole("alert")).toContainText("Could not mark notifications");
  await expect(page.locator(".buzz-list > a.unread")).toHaveCount(1);
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(page.locator(".buzz-list > a.read")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(mark).toBeDisabled();
  expect(marks).toBe(2);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("My Nights recovers from a service failure and keeps member navigation consistent", async ({ page }) => {
  let loads = 0;
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 7_200_000).toISOString();
  await page.route("**/api/customer/my-nights", (route) => {
    loads++;
    return route.fulfill(loads === 1 ? { status: 503, json: { error: "My Nights is temporarily unavailable." } } : { json: { attendee: { displayName: "Ama" }, nights: [{ eventSlug: "after-dark-osu", title: "After Dark: Osu", startsAt, endsAt, venue: "The venue", area: "Osu", imageUrl: "/atmospheres/behind-the-night.webp", eventState: "scheduled", isTestEvent: true, ticketCount: 1, purchased: true, keepPosted: false, attendeeVisible: false, hostSlug: null, hostName: null, updateCount: 0, questionCount: 0 }] } });
  });
  await page.route("**/api/customer/notifications", (route) => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.goto("/my-nights");
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByLabel("Email used at checkout")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Ama’s nights." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Show my ticket" })).toHaveAttribute("href", "/my-nights/after-dark-osu?view=passes");
  const account = page.getByRole("navigation", { name: "Your account", exact: true });
  await expect(account.getByRole("link", { name: "My Nights" })).toHaveAttribute("aria-current", "page");
  await account.getByRole("link", { name: "The Buzz" }).click();
  await expect(account.getByRole("link", { name: "The Buzz" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const menu = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(menu.getByRole("link", { name: "My Nights", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Home", exact: true })).not.toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
});
