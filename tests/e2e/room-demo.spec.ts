import type { Locator, Page } from "@playwright/test";
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

async function positionRoomMotionForCapture(page: Page) {
  await page.locator(".room-demo-caption").evaluate(element => {
    const caption = element.getBoundingClientRect();
    const header = document.querySelector(".discovery-home > .night-header")?.getBoundingClientRect();
    const dock = document.querySelector(".customer-dock")?.getBoundingClientRect();
    const top = Math.max(0, header?.bottom ?? 0);
    const bottom = dock && dock.height > 0 ? Math.min(innerHeight, dock.top) : innerHeight;
    // Capture the motion controls with surrounding Room context. The complete
    // phone is taller than some usable viewports; natural-entry tests cover it.
    window.scrollBy({ top: caption.top - (top + (bottom - top - caption.height) / 2), behavior: "instant" });
  });
}

async function roomMotionGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector(".discovery-home > .night-header")?.getBoundingClientRect();
    const dock = document.querySelector(".customer-dock")?.getBoundingClientRect();
    const top = Math.max(0, header?.bottom ?? 0);
    const bottom = dock && dock.height > 0 ? Math.min(innerHeight, dock.top) : innerHeight;
    const preview = document.querySelector(".room-product-preview")!.getBoundingClientRect();
    const inspect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { rect: box.toJSON(), inside: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= top && box.bottom <= bottom, unobscured: Boolean(hit && element.contains(hit)) };
    };
    return {
      scrollY, viewport: { width: innerWidth, height: innerHeight }, usableTop: top, usableBottom: bottom,
      preview: preview.toJSON(),
      summary: inspect(".room-demo-motion > summary"),
      setting: document.querySelector(".room-demo-motion")!.hasAttribute("open") ? inspect(".room-demo-motion > label") : null,
    };
  });
}

async function focusRoomTrackWithKeyboard(page: Page, settings: Locator, track: Locator) {
  // Begin a real keyboard interaction after touch, as in the public focus gate.
  // Programmatic focus alone does not establish the browser's input modality.
  await page.keyboard.press("Tab");
  await settings.focus();
  let phase = "summary-focus";
  try {
    await expect(settings).toBeFocused();
    phase = "reverse-tab-to-track";
    await settings.press("Shift+Tab");
    await expect(track).toBeFocused();
  } catch (error) {
    const focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const summary = document.querySelector<HTMLElement>(".room-demo-motion > summary");
      const track = document.querySelector<HTMLElement>(".room-product-scene__phones");
      return {
        active: active && { tag: active.tagName, className: active.className, label: active.getAttribute("aria-label"), text: active.textContent?.trim().slice(0, 80), focusVisible: active.matches(":focus-visible") },
        summary: { focused: active === summary, tabIndex: summary?.tabIndex },
        track: { focused: active === track, tabIndex: track?.tabIndex },
        motionSettingsOpen: document.querySelector(".room-demo-motion")?.hasAttribute("open"),
      };
    });
    console.info("ROOM_KEYBOARD_FOCUS", JSON.stringify({ phase, ...focus }));
    throw error;
  }
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
  await positionRoomMotionForCapture(page);
  await expect.poll(async () => {
    const layout = await roomMotionGeometry(page);
    return { summary: layout.summary.inside && layout.summary.unobscured };
  }).toEqual({ summary: true }).catch(async error => {
    console.info("ROOM_MOTION_LAYOUT", JSON.stringify({ phase: "closed-placement", layout: await roomMotionGeometry(page) }));
    throw error;
  });
  const closedLayout = await roomMotionGeometry(page);
  await page.screenshot({ path: testInfo.outputPath("room-static-section.png"), scale: "css" });
  expect(await roomMotionGeometry(page)).toEqual(closedLayout);
  const settings = page.locator(".room-demo-motion");
  await settings.locator("summary").click();
  await expect(page.getByRole("checkbox", { name: "Animate preview", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Animate preview", exact: true })).not.toBeChecked();
  await expect.poll(async () => {
    const layout = await roomMotionGeometry(page);
    return { summary: layout.summary.inside && layout.summary.unobscured, setting: layout.setting?.inside && layout.setting.unobscured };
  }).toEqual({ summary: true, setting: true }).catch(async error => {
    console.info("ROOM_MOTION_LAYOUT", JSON.stringify({ phase: "expanded-placement", layout: await roomMotionGeometry(page) }));
    throw error;
  });
  const openLayout = await roomMotionGeometry(page);
  console.info("ROOM_MOTION_LAYOUT", JSON.stringify({ capture: "Room motion controls in viewport, closed and expanded", closed: closedLayout, open: openLayout }));
  await page.screenshot({ path: testInfo.outputPath("room-motion-settings.png"), scale: "css" });
  expect(await roomMotionGeometry(page)).toEqual(openLayout);
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
  await focusRoomTrackWithKeyboard(page, settings, track);
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
  await focusRoomTrackWithKeyboard(page, settings, track);
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
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
