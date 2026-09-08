import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectVisibleLettering } from "./text-visibility";

test.use({ serviceWorkers: "block" });

async function memberPage(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "Isolated notification fixture" } }));
  await page.route("**/api/customer/my-nights", (route) => route.fulfill({ json: { attendee: { displayName: "Ama" }, nights: [] } }));
}

test("notification bell keeps a busy inbox compact and every update reachable", async ({ page }, testInfo) => {
  await memberPage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const longBody = "The guest list has a little update. We are using the garden entrance beside the restaurant this Sunday. Bring your ticket, arrive with your people and give yourself enough time to settle in before the music starts. If you need step-free access, the team at the garden entrance will help. Every part of this message should remain readable, including this final sentence.";
  const items = Array.from({ length: 14 }, (_, i) => ({ id: `notice-${i}`, eventSlug: "sun-chasers-labadi", eventTitle: "On The Guest List", kind: i % 3 ? "room_message" : "host_update", title: i === 1 ? "A longer note before your Night" : ["The Host has spoken", "Your people are moving", "Your ticket is ready"][i % 3], body: i === 1 ? longBody : "Gate 2 tonight. Bring the ticket. We’ll bring the good part.", url: "/my-nights/sun-chasers-labadi?view=details", createdAt: new Date(Date.now() - i * 60_000).toISOString(), readAt: i < 4 ? null : new Date().toISOString() as string | null }));
  const marks: unknown[] = [];
  let loads = 0;
  let finishRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { finishRefresh = resolve; });
  await page.route("**/api/customer/notifications", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON(); marks.push(payload);
      items.forEach((item) => { if (payload.all || item.id === payload.id) item.readAt = new Date().toISOString(); });
      return route.fulfill({ json: { updated: true } });
    }
    const snapshot = items.map((item) => ({ ...item }));
    if (++loads === 2) await refreshGate;
    return route.fulfill({ json: { notifications: snapshot, unread: snapshot.filter((item) => !item.readAt).length } });
  });
  await page.goto("/my-nights");
  const bell = page.getByRole("button", { name: "4 unread notifications" });
  await bell.click();
  await expect(page).toHaveURL(/\/my-nights$/);
  const dialog = page.getByRole("dialog", { name: "The Buzz", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".buzz-row")).toHaveCount(8);
  await expect(dialog.getByRole("button", { name: "All", exact: true })).toHaveCSS("border-radius", "0px");
  const bounds = await dialog.locator(".notification-panel").boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(410);
  expect(bounds!.height).toBeLessThanOrEqual(540);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 12);
  await expectVisibleLettering(page, ".notification-panel-header, .buzz-tools");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("notification-bell.png") });
  const long = dialog.locator(".buzz-row").filter({ hasText: "A longer note before your Night" });
  await long.locator("summary").click();
  await expect(long.locator(".buzz-update p")).toHaveText(longBody);
  await expect(long).toHaveClass("buzz-row read");
  expect(marks).toContainEqual({ id: "notice-1" });
  finishRefresh();
  await expect(dialog.locator(".notification-feed")).toHaveAttribute("aria-busy", "false");
  await expect(long).toHaveClass("buzz-row read");
  await page.setViewportSize({ width: 320, height: 740 });
  await long.scrollIntoViewIfNeeded();
  await expectVisibleLettering(page, ".buzz-update[open]");
  await long.locator("summary").click();
  await dialog.getByRole("button", { name: /Show more/ }).click();
  await expect(dialog.locator(".buzz-row")).toHaveCount(14);
  for (let i = 0; i < 14; i++) { await dialog.locator(".buzz-row").nth(i).scrollIntoViewIfNeeded(); await expectVisibleLettering(page, `.notification-panel .buzz-row:nth-child(${i + 1})`); }
  await dialog.getByRole("button", { name: /^Unread/ }).click();
  await expect(dialog.locator(".buzz-row")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Mark all read" }).click();
  await expect(dialog.getByRole("heading", { name: "Nothing missed." })).toBeVisible();
  expect(marks).toContainEqual({ all: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
});

test("notification panel has useful loading, failure and private states", async ({ page }, testInfo) => {
  await memberPage(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let status = 503;
  await page.route("**/api/customer/notifications", async (route) => {
    await gate;
    return route.fulfill(status === 503 ? { status: 503, json: { error: "The Buzz is taking a moment. Try again." } } : { status: 401, json: { error: "Sign in" } });
  });
  await page.goto("/my-nights");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "The Buzz", exact: true });
  await expect(dialog.getByRole("status", { name: "Loading notifications" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("notification-loading.png") });
  release();
  await expect(dialog.getByRole("alert")).toHaveText("The Buzz is taking a moment. Try again.");
  await expect(dialog.getByText("Quiet. Suspiciously quiet.")).toHaveCount(0);
  status = 401;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("heading", { name: "Your buzz is private." })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Bring back My Nights" })).toHaveAttribute("href", "/my-nights");
  await dialog.getByRole("button", { name: "Close notifications" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
});

test("notification panel contains keyboard focus and closes outside the bell", async ({ page }) => {
  await memberPage(page);
  await page.route("**/api/customer/notifications", (route) => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/my-nights");
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  await bell.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "The Buzz", exact: true });
  await expect(dialog.getByRole("button", { name: "Close notifications" })).toBeFocused();
  await expect(dialog.locator(".notification-panel")).toHaveCSS("animation-name", "none");
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true); }
  await page.mouse.click(3, 200);
  await expect(dialog).toHaveCount(0);
  await expect(bell).toBeFocused();
});
