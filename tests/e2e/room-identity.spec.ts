import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The signed-in Room fixture never contacts live attendee APIs or a live socket.
test.use({ serviceWorkers: "block" });

test("the rendered identity stays legible and Hosts connect to the guest journey", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/", "/events", "/hosts", "/organizer/submit", "/checkout/after-dark-osu"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
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

test("the Room keeps reactions on their messages and matches the homepage conversation", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const preview = page.locator(".room-product-phone").first();
  // The homepage defers offscreen sections with content-visibility. Measure the
  // actual phone only after scrolling it into the rendered viewport.
  await preview.scrollIntoViewIfNeeded();
  await expect(preview.locator(".chat-compose-field")).toBeVisible();
  const previewMaterial = await preview.locator(".chat-compose-field").evaluate((element) => getComputedStyle(element).backgroundColor);
  const previewBubble = await preview.locator(".scene-message__bubble").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  const phoneFit = await preview.evaluate((phone) => {
    const screen = phone.querySelector(".room-product-phone__screen")!.getBoundingClientRect();
    const composer = phone.querySelector(".chat-compose-field")!.getBoundingClientRect();
    return { left: composer.left - screen.left, right: screen.right - composer.right, bottom: screen.bottom - composer.bottom };
  });
  expect(phoneFit.left).toBeGreaterThan(0);
  expect(phoneFit.right).toBeGreaterThan(0);
  expect(phoneFit.bottom).toBeGreaterThanOrEqual(0);
  expect(phoneFit.bottom).toBeLessThan(10);
  await preview.screenshot({ path: testInfo.outputPath("homepage-room-phone.png") });
  const room = { eventSlug: "after-dark-osu", eventTitle: "After Dark: Osu", readOnlyAt: new Date(Date.now() + 86_400_000).toISOString(), readOnly: false };
  const base = { sequence: 1, roomBadge: null, kind: "message", parentId: null, pinned: false, deletedAt: null, reactions: [], createdAt: new Date().toISOString() };
  const messages = [
    { ...base, id: "host-update", attendeeId: "fixture-host", displayName: "The Host", role: "organizer", kind: "announcement", pinned: true, content: "Gate 2 tonight. Have your ticket ready and we’ll see you inside." },
    { ...base, id: "hello", sequence: 2, attendeeId: "fixture-kofi", displayName: "Kofi", role: "attendee", content: "Front left. You know the drill." },
  ];
  const sent: Record<string, unknown>[] = [];
  let reactionActive = false;
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
      if (payload.type === "reaction") {
        reactionActive = !reactionActive;
        socket.send(JSON.stringify({ type: "reaction", messageId: payload.messageId, emoji: payload.emoji, count: reactionActive ? 1 : 0, attendeeId: "fixture-self", active: reactionActive }));
      }
    });
  });
  await page.goto("/room/after-dark-osu");
  const setting = page.locator(".room-page");
  await expect(setting).toBeVisible();
  await expect(setting).toHaveCSS("background-image", /the-room\.webp/u);
  await expect(page.locator(".room-pinned")).toContainText("Gate 2 tonight");
  await page.locator(".room-pinned summary").click();
  await expect(page.locator(".room-pinned > p")).toBeVisible();
  await page.locator(".room-pinned summary").click();

  const kofi = page.locator(".room-message").filter({ hasText: "Front left. You know the drill." }).first();
  const trigger = kofi.getByRole("button", { name: "Actions for Kofi's message" });
  await trigger.click();
  const actions = page.getByRole("toolbar", { name: "Actions for Kofi's message" });
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(actions).toHaveCSS("border-top-width", "0px");
  await expect(actions.getByRole("button", { name: "React 🔥", exact: true })).toHaveCSS("font-size", "19px");
  expect(await page.locator("dialog[open]").count()).toBe(0);
  const anchored = await actions.evaluate((tray) => {
    const shelf = tray.getBoundingClientRect();
    const bubble = tray.closest(".chat-message-anchor")!.getBoundingClientRect();
    return { left: shelf.left, right: shelf.right, top: shelf.top, bottom: shelf.bottom, width: innerWidth, height: innerHeight, gap: Math.min(Math.abs(shelf.bottom - bubble.top), Math.abs(shelf.top - bubble.bottom)) };
  });
  expect(anchored.left).toBeGreaterThanOrEqual(0);
  expect(anchored.right).toBeLessThanOrEqual(anchored.width);
  expect(anchored.top).toBeGreaterThanOrEqual(0);
  expect(anchored.bottom).toBeLessThanOrEqual(anchored.height);
  expect(anchored.gap).toBeLessThanOrEqual(12);
  await actions.getByRole("button", { name: "React 🔥", exact: true }).click();
  await expect(actions).not.toBeVisible();
  const reaction = kofi.getByRole("button", { name: "🔥, 1 reactions" });
  await expect(reaction).toHaveAttribute("aria-pressed", "true");
  expect(sent).toContainEqual({ type: "reaction", messageId: "hello", emoji: "🔥" });
  await expect(reaction.locator(".chat-reaction")).toBeVisible();
  await reaction.click();
  await expect(reaction).toHaveCount(0);

  // Touch-and-hold opens the same anchored tray; a short tap does not.
  await kofi.locator(".room-bubble").dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  await expect(actions).toBeVisible();
  await kofi.locator(".room-bubble").dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  const activeAccessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(activeAccessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("room-reaction-tray.png") });
  await actions.getByRole("button", { name: "Reply", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message The Room" });
  await expect(composer).toBeFocused();
  await expect(page.locator(".chat-compose-reply")).toContainText("Front left. You know the drill.");
  await expect(page.locator(".chat-compose-field")).toHaveCSS("background-color", previewMaterial);
  await expect(kofi.locator(".room-bubble")).toHaveCSS("background-color", previewBubble);
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
  await page.screenshot({ path: testInfo.outputPath("room-conversation.png") });

  const notifications = page.getByRole("button", { name: "Room notification settings" });
  await notifications.click();
  await expect(page.getByRole("dialog", { name: "Room notifications" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Host updates and Room messages" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(notifications).toBeFocused();
});
