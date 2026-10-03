import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ video: "on" });

async function focusRoomTrackWithKeyboard(page: Page, track: Locator) {
  // Establish keyboard modality even after touch, then inspect the focusable track.
  await page.keyboard.press("Tab");
  await track.focus();
  await expect(track).toBeFocused();
  await expect.poll(() => track.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  }), { message: "Keyboard inspection keeps a visible focus indicator" }).toBe(true);
}

test("Room demo autoplays with still hardware and no playback controls", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(page.getByRole("button", { name: /(?:Play|Pause) Room preview/ })).toHaveCount(0);
  await expect(page.locator(".room-product-preview input, .room-product-preview button, .room-demo-motion")).toHaveCount(0);
  const captionContrast = await page.locator(".room-demo-caption > span").evaluateAll(elements => {
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return elements.map(element => {
      const style = getComputedStyle(element);
      const foreground = style.color.match(/[\d.]+/g)!.map(Number);
      const background = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
      const alpha = foreground[3] ?? 1;
      const paintedText = foreground.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
      const levels = [luminance(paintedText), luminance(background)].sort((a, b) => a - b);
      return { text: element.textContent, opaque: (background[3] ?? 1) === 1 && style.opacity === "1" && style.backgroundImage === "none",
        ratio: (levels[1] + .05) / (levels[0] + .05) };
    });
  });
  expect(captionContrast).toHaveLength(1);
  for (const label of captionContrast) {
    expect(label.opaque, `${label.text} must not depend on the event artwork`).toBe(true);
    expect(label.ratio, `${label.text} text contrast`).toBeGreaterThanOrEqual(4.5);
  }
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
  const track = page.locator(".room-product-scene__phones");
  await focusRoomTrackWithKeyboard(page, track);
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "paused");
  const step = await phone.getAttribute("data-demo-step");
  await page.waitForTimeout(3300);
  await expect(phone).toHaveAttribute("data-demo-step", step!);
  await expect(phone.locator(".room-product-phone__stream")).toHaveCSS("opacity", "1");
  await phone.screenshot({ path: testInfo.outputPath("room-paused.png") });
  await track.press("Tab");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  await expect(phone).not.toHaveAttribute("data-demo-step", step!, { timeout: 5000 });
  await page.locator(".room-demo-caption").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("room-automatic-section.png"), scale: "css" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "reduced-motion");
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  for (const item of await phone.locator(".scene-message").all()) {
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item).toHaveCSS("transform", "none");
  }
  await expect(page.locator(".room-product-preview input, .room-product-preview button")).toHaveCount(0);
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

  const inside = page.locator(".room-product-phone--inside");
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");
  const secondStep = await inside.getAttribute("data-demo-step");
  await expect(inside).not.toHaveAttribute("data-demo-step", secondStep!, { timeout: 5000 });
  await focusRoomTrackWithKeyboard(page, track);
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
  // Touching a keyboard-focused track must clear its temporary focus pause,
  // including when the browser does not dispatch a second focus event.
  await inside.scrollIntoViewIfNeeded();
  const insideBounds = await inside.boundingBox();
  const insideX = insideBounds!.x + insideBounds!.width / 2;
  const insideY = insideBounds!.y + insideBounds!.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(insideX, insideY);
  else await page.mouse.click(insideX, insideY);
  await expect(inside).toHaveAttribute("data-demo-running", "true");
  await focusRoomTrackWithKeyboard(page, track);
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
  // Leaving keyboard inspection resumes automatically without a playback control.
  await track.press("Tab");
  await expect(track).not.toBeFocused();
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
  const track = page.locator(".room-product-scene__phones");
  await focusRoomTrackWithKeyboard(page, track);
  await expect(reaction).toHaveCSS("animation-play-state", "paused");
  await track.press("Tab");
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
  await expect(frame).toHaveAttribute("src", /iphone-15-pro-frame\.png/);
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
