import type { Page } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ video: "on" });

async function setRoomAnimation(page: Page, enabled: boolean) {
  const settings = page.locator(".room-demo-motion");
  const animate = page.getByRole("checkbox", { name: "Animate preview", exact: true });
  await expect(animate).not.toBeVisible();
  await settings.locator("summary").click();
  await animate.setChecked(enabled);
  await expect(animate).toBeChecked({ checked: enabled });
  await settings.locator("summary").click();
  await expect(animate).not.toBeVisible();
}

test("Room demo autoplays with still hardware and a discreet motion setting", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(page.getByRole("button", { name: /(?:Play|Pause) Room preview/ })).toHaveCount(0);
  await expect(page.locator(".room-demo-motion")).not.toHaveAttribute("open", "");
  const initial = await phone.boundingBox();
  const composer = await phone.locator(".chat-compose-field").boundingBox();
  await expect(phone.locator(".room-demo-typing")).toBeVisible({ timeout: 5000 });
  await phone.screenshot({ path: testInfo.outputPath("room-typing.png") });
  await expect(phone.locator('[data-room-item="arrival-2"]')).toBeVisible({ timeout: 9000 });
  await expect(phone.locator('[data-room-item="arrival-0"]')).toHaveCSS("animation-name", "none");
  await expect(phone).toHaveCSS("transform", "none");
  const later = await phone.boundingBox();
  expect(later).toEqual(initial);
  expect(await phone.locator(".chat-compose-field").boundingBox()).toEqual(composer);
  await setRoomAnimation(page, false);
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "paused");
  const step = await phone.getAttribute("data-demo-step");
  await page.waitForTimeout(3300);
  await expect(phone).toHaveAttribute("data-demo-step", step!);
  await expect(phone.locator(".room-product-phone__stream")).toHaveCSS("opacity", "1");
  await phone.screenshot({ path: testInfo.outputPath("room-paused.png") });
  await setRoomAnimation(page, true);
  // Settings live below the phones. Return to the conversation before checking
  // playback; an offscreen preview must stay paused even with animation enabled.
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toBeInViewport({ ratio: .55 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(phone).not.toHaveAttribute("data-demo-step", step!, { timeout: 5000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "reduced-motion");
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  for (const item of await phone.locator(".scene-message").all()) {
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item).toHaveCSS("transform", "none");
  }
  await page.locator("#the-room").screenshot({ path: testInfo.outputPath("room-static-section.png"), scale: "css" });
  const settings = page.locator(".room-demo-motion");
  await settings.locator("summary").click();
  await expect(page.getByRole("checkbox", { name: "Animate preview", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Animate preview", exact: true })).not.toBeChecked();
  await page.locator(".room-product-preview").screenshot({ path: testInfo.outputPath("room-motion-settings.png"), scale: "css" });
  await settings.locator("summary").click();
});

test("Room preview pauses offscreen, preserves swipe position, and replays inside the screen", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--inside");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(phone.locator('[data-room-item="inside-1"]')).toBeVisible({ timeout: 6500 });
  await phone.screenshot({ path: testInfo.outputPath("room-flash.png") });
  await expect(phone.locator('[data-room-item="inside-2"]')).toBeVisible({ timeout: 6500 });
  await expect(phone.locator('[data-room-item="host"]')).toBeVisible({ timeout: 6500 });
  await phone.screenshot({ path: testInfo.outputPath("room-host-update.png") });
  const bounds = await phone.boundingBox();
  await expect(phone).toHaveAttribute("data-demo-step", "0", { timeout: 6500 });
  expect(await phone.boundingBox()).toEqual(bounds);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  const step = await phone.getAttribute("data-demo-step");
  await page.waitForTimeout(2000);
  await expect(phone).toHaveAttribute("data-demo-step", step!);
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(phone).not.toHaveAttribute("data-demo-step", step!, { timeout: 5000 });
});

test("Room preview resumes after touch, scroll cancellation and pointer release", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  const track = page.locator(".room-product-scene__phones");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  const bounds = await phone.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  const step = await phone.getAttribute("data-demo-step");
  await expect(phone).not.toHaveAttribute("data-demo-step", step!, { timeout: 5000 });

  if (testInfo.project.name === "mobile-chromium") {
    // A real browser touch gesture, not just a synthetic DOM cancellation.
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let delta = 12; delta <= 72; delta += 12) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - delta }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    await phone.scrollIntoViewIfNeeded();
    await expect(phone).toHaveAttribute("data-demo-running", "true");
  }

  // Browsers cancel the pointer when native touch scrolling takes ownership.
  // Exercise that transition, including release outside the phone, on all engines.
  await track.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1 });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await track.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 1 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await track.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 2 });
  await track.dispatchEvent("pointerout", { pointerType: "touch", pointerId: 2 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");

  // Touch interaction must never erase an explicit pause.
  await setRoomAnimation(page, false);
  await track.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 3 });
  await track.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 3 });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "paused");
  await setRoomAnimation(page, true);
  // Settings can scroll the phone offscreen. Restore visibility before resume.
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toBeInViewport({ ratio: .55 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");

  const inside = page.locator(".room-product-phone--inside");
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");
  const secondStep = await inside.getAttribute("data-demo-step");
  await expect(inside).not.toHaveAttribute("data-demo-step", secondStep!, { timeout: 5000 });
  const settings = page.locator(".room-demo-motion > summary");
  await settings.focus();
  await settings.press("Shift+Tab");
  await expect(track).toBeFocused();
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  // Touching a keyboard-focused track must clear its temporary focus pause,
  // including when the browser does not dispatch a second focus event.
  await inside.scrollIntoViewIfNeeded();
  const insideBounds = await inside.boundingBox();
  const insideX = insideBounds!.x + insideBounds!.width / 2;
  const insideY = insideBounds!.y + insideBounds!.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(insideX, insideY);
  else await page.mouse.click(insideX, insideY);
  await expect(inside).toHaveAttribute("data-demo-running", "true");
  await settings.focus();
  await settings.press("Shift+Tab");
  await expect(track).toBeFocused();
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  // Keyboard inspection is temporary; only the explicit motion setting persists.
  await track.press("Tab");
  await expect(settings).toBeFocused();
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");

  // The discreet setting is usable without a pointer and its stop survives blur.
  await settings.press("Enter");
  await settings.press("Tab");
  const animate = page.getByRole("checkbox", { name: "Animate preview", exact: true });
  await expect(animate).toBeFocused();
  await animate.press("Space");
  await expect(animate).not.toBeChecked();
  await animate.press("Shift+Tab");
  await settings.press("Enter");
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
  await setRoomAnimation(page, true);
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");
});

test("Room hardware and independent tapbacks retain a clear mobile silhouette", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  const message = phone.locator('[data-room-item="arrival-3"]');
  const reaction = message.locator(".room-demo-reaction");
  await expect(message).toBeVisible({ timeout: 12000 });
  // The new message appears first. Its reaction has a separate delayed arrival.
  await expect(reaction).toHaveAttribute("data-reaction-visible", "true");
  expect(Number(await reaction.evaluate(node => getComputedStyle(node).opacity))).toBeLessThan(.1);
  await phone.screenshot({ path: testInfo.outputPath("room-before-reaction.png") });
  await expect(reaction).toHaveCSS("opacity", "1", { timeout: 2000 });
  await phone.screenshot({ path: testInfo.outputPath("room-after-reaction.png") });
  await setRoomAnimation(page, false);
  await expect(reaction).toHaveCSS("animation-play-state", "paused");
  await setRoomAnimation(page, true);
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toBeInViewport({ ratio: .55 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(reaction).toHaveCSS("animation-play-state", "running");
  // A settled tapback must not rewind its finished arrival when playback resumes.
  expect(Number(await reaction.evaluate(node => getComputedStyle(node).opacity))).toBe(1);
  await page.waitForTimeout(200);
  await expect(reaction).toHaveCSS("opacity", "1");
  const bubble = await message.locator(".scene-message__bubble").boundingBox();
  const badge = await reaction.boundingBox();
  expect(bubble).not.toBeNull();
  expect(badge).not.toBeNull();
  expect(badge!.height).toBeLessThanOrEqual(20);
  expect(badge!.y).toBeLessThan(bubble!.y);
  expect(badge!.y + badge!.height).toBeLessThan(bubble!.y + bubble!.height);
  const frame = phone.locator(".room-product-phone__render");
  await expect(frame).toHaveAttribute("src", /iphone-titanium-front\.svg/);
  // Read both rectangles in one frame so an in-flight viewport scroll cannot
  // create a false hardware offset between separate browser round trips.
  const hardware = await phone.evaluate(element => ({
    phone: element.getBoundingClientRect().toJSON(),
    frame: element.querySelector(".room-product-phone__render")!.getBoundingClientRect().toJSON(),
  }));
  expect(hardware.frame).toEqual(hardware.phone);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(reaction).toHaveCSS("animation-name", "none");
  await expect(reaction).toHaveCSS("opacity", "1");
  await phone.screenshot({ path: testInfo.outputPath("room-hardware-tapbacks-static.png") });
  await page.locator("#the-room").screenshot({ path: testInfo.outputPath("room-hardware-tapbacks-section.png") });
});
