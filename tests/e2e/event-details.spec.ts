import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("poster, event facts and ticket access fit the event page", async ({ page }, testInfo) => {
  await page.goto("/event/sun-chasers-labadi");
  await expect(page.getByRole("heading", { name: "On The Guest List", exact: true })).toBeVisible();
  const poster = page.getByRole("img", { name: "Event poster for On The Guest List" });
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(poster).toHaveCSS("object-fit", "contain");
  await expect(poster).toHaveCSS("filter", "none");
  await expect(page.locator(".event-detail-facts")).toContainText("Asana Restaurant");
  await expect(page.locator(".event-detail-facts")).toContainText("Kempinski Gold Coast Hotel, Accra");
  await expect(page.locator(".event-detail-facts")).toContainText(/2:00 pm – 10:00 pm/i);
  await expect(page.getByRole("button", { name: "Copy Link", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", "/api/calendar/sun-chasers-labadi");
  await expect(page.locator(".event-detail-preview")).toHaveCount(0);
  await expect(page.locator(".event-detail-verified")).toHaveText("Verified event");
  await expect(page.locator(".event-detail-facts time")).toHaveAttribute("datetime", "2026-09-13T14:00:00.000Z");
  await expect(page.locator(".event-detail-story")).toContainText("Dress code: white with a touch of golden brown.");
  await expect(page.getByRole("link", { name: "Get tickets", exact: true })).toBeVisible();
  const calendar = await page.request.get("/api/calendar/sun-chasers-labadi");
  expect(calendar.ok()).toBe(true);
  expect(await calendar.text()).toContain("DTSTART:20260913T140000Z");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const layout = await page.evaluate(() => {
    const posterBounds = document.querySelector(".event-detail-poster")!.getBoundingClientRect();
    const details = document.querySelector(".event-detail-overview")!.getBoundingClientRect();
    return { narrow: innerWidth <= 760, posterBottom: posterBounds.bottom, posterRight: posterBounds.right, detailsTop: details.top, detailsLeft: details.left };
  });
  if (layout.narrow) expect(layout.detailsTop).toBeGreaterThanOrEqual(layout.posterBottom);
  else expect(layout.detailsLeft).toBeGreaterThan(layout.posterRight);
  const issues = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical");
  expect(issues).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("event-poster.png"), fullPage: true });
});

test("copying a promoter link does not open native sharing and restores focus", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { document.documentElement.dataset.nativeShareCalled = "true"; } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (url: string) => { document.documentElement.dataset.copiedUrl = url; } } });
  });
  await page.goto("/event/sun-chasers-labadi?ref=HOST123");
  const copy = page.getByRole("button", { name: "Copy Link", exact: true });
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Link copied");
  await expect(page.locator("html")).toHaveAttribute("data-copied-url", /\/event\/sun-chasers-labadi\?ref=HOST123$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-native-share-called", "true");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(copy).toBeFocused();
});

test("countdown changes to event ended instead of negative time", async ({ page }) => {
  await page.clock.install();
  await page.goto("/event/sun-chasers-labadi");
  const startsAt = await page.locator(".event-detail-facts time").getAttribute("datetime");
  const start = Date.parse(startsAt!);
  await page.clock.setSystemTime(start - 60_000);
  await page.clock.runFor(1_000);
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.setSystemTime(start + 1_000);
  await page.clock.runFor(1_000);
  await expect(page.getByText("Happening now", { exact: true })).toBeVisible();
  await page.clock.setSystemTime(start + 9 * 3600_000);
  await page.clock.runFor(1_000);
  await expect(page.getByText("Event ended", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
});
