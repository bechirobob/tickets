import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The signed-in Room fixture never contacts live attendee APIs or a live socket.
test.use({ serviceWorkers: "block" });

test("the rendered identity stays legible and Hosts connect to the guest journey", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/", "/events", "/hosts", "/organizer/submit", "/checkout/after-dark-osu"]) {
    await page.goto(path);
    const logo = page.locator("header .brand-logo").first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAccessibleName("BeCore Tickets");
    await expect(logo.locator("b")).toBeVisible();
    await expect.poll(() => logo.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const bounds = await logo.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(38);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.goto("/");
  const bridge = page.locator(".backstage-bridge");
  await bridge.scrollIntoViewIfNeeded();
  await expect(bridge.getByRole("link", { name: "Meet the Hosts" })).toHaveAttribute("href", "/hosts");
  await expect(bridge.getByRole("link", { name: "List your event" })).toHaveAttribute("href", "/organizer/submit");
});

test("the Room keeps announcements, replies and notifications usable in its own setting", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const room = { eventSlug: "after-dark-osu", eventTitle: "After Dark: Osu", readOnlyAt: new Date(Date.now() + 86_400_000).toISOString(), readOnly: false };
  const base = { sequence: 1, roomBadge: null, kind: "message", parentId: null, pinned: false, deletedAt: null, reactions: [], createdAt: new Date().toISOString() };
  const messages = [
    { ...base, id: "host-update", attendeeId: "fixture-host", displayName: "The Host", role: "organizer", kind: "announcement", pinned: true, content: "Gate 2 tonight. Have your ticket ready and we’ll see you inside." },
    { ...base, id: "hello", sequence: 2, attendeeId: "fixture-kofi", displayName: "Kofi", role: "attendee", content: "Front left. You know the drill." },
  ];
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/access")) return route.fulfill({ json: { allowed: true, attendee: { id: "fixture-self" }, room } });
    if (path.endsWith("/flashes")) return route.fulfill({ json: { flashes: [] } });
    if (path.includes("/notifications/preferences/")) return route.fulfill({ json: { roomMessages: true, hostUpdates: true } });
    if (path.endsWith("/notifications/subscription")) return route.fulfill({ json: { available: false } });
    return route.fulfill({ status: 401, json: { error: "Isolated Room fixture" } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, (socket) => {
    socket.send(JSON.stringify({ type: "snapshot", messages, room, online: 3 }));
    socket.onMessage((raw) => {
      const payload = JSON.parse(String(raw));
      sent.push(payload);
      if (payload.type === "message") socket.send(JSON.stringify({ type: "message", message: { ...base, id: "reply", sequence: 3, attendeeId: "fixture-self", displayName: "You", role: "attendee", content: payload.content, parentId: payload.parentId } }));
    });
  });
  await page.goto("/room/after-dark-osu");
  const setting = page.locator(".room-page");
  await expect(setting).toBeVisible();
  await expect(setting).toHaveCSS("background-image", /the-room\.webp/u);
  await expect(page.locator(".room-message.announcement")).toContainText("Gate 2 tonight");
  await page.locator(".room-pinned summary").click();
  await expect(page.locator(".room-pinned > p")).toBeVisible();
  await page.locator(".room-pinned summary").click();

  await page.getByRole("button", { name: "Actions for Kofi's message" }).click();
  const actions = page.getByRole("dialog", { name: "Message actions" });
  await expect(actions).toBeVisible();
  await actions.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message The Room" });
  await expect(composer).toBeFocused();
  await composer.fill("On my way. Save me a spot.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".room-message.own .room-bubble")).toContainText("Save me a spot.");
  expect(sent).toContainEqual({ type: "message", content: "On my way. Save me a spot.", parentId: "hello" });
  await expect(composer).toHaveValue("");

  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    composerBottom: document.querySelector(".room-composer")!.getBoundingClientRect().bottom,
    streamHeight: document.querySelector(".room-stream")!.getBoundingClientRect().height,
    height: window.innerHeight,
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.composerBottom).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.streamHeight).toBeGreaterThan(150);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);

  const notifications = page.getByRole("button", { name: "Room notification settings" });
  await notifications.click();
  await expect(page.getByRole("dialog", { name: "Room notifications" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Host updates and Room messages" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(notifications).toBeFocused();
});
