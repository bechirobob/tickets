import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ video: "on" });

async function setRoomAnimation(page: Page, enabled: boolean, touch = false) {
  const animate = page.getByRole("checkbox", { name: "Motion for Room preview", exact: true });
  await positionRoomMotionInViewport(page);
  await expectRoomMotionReachable(page);
  if (touch) {
    await expect(animate).toBeChecked({ checked: !enabled });
    const target = await page.locator(".room-demo-motion").boundingBox();
    await page.touchscreen.tap(target!.x + target!.width / 2, target!.y + target!.height / 2);
  } else await animate.setChecked(enabled);
  await expect(animate).toBeChecked({ checked: enabled });
}

async function expectRoomMotionReachable(page: Page) {
  await expect.poll(async () => {
    const layout = await roomMotionGeometry(page);
    return { caption: layout.caption.inside && layout.caption.unobscured, label: layout.label.inside && layout.label.unobscured && layout.label.rect.width >= 44 && layout.label.rect.height >= 44, input: layout.input.inside && layout.input.unobscured };
  }).toEqual({ caption: true, label: true, input: true }).catch(async error => {
    console.info("ROOM_MOTION_LAYOUT", JSON.stringify({ phase: "control-placement", layout: await roomMotionGeometry(page) }));
    throw error;
  });
}

async function positionRoomMotionInViewport(page: Page) {
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
      caption: inspect(".room-demo-caption > span"),
      label: inspect(".room-demo-motion"),
      input: { ...inspect(".room-demo-motion > input"), checked: document.querySelector<HTMLInputElement>(".room-demo-motion > input")!.checked, disabled: document.querySelector<HTMLInputElement>(".room-demo-motion > input")!.disabled, colorScheme: getComputedStyle(document.querySelector(".room-demo-motion > input")!).colorScheme },
    };
  });
}

async function focusRoomTrackWithKeyboard(page: Page, motion: Locator, track: Locator) {
  // Begin a real keyboard interaction after touch, as in the public focus gate.
  // Programmatic focus alone does not establish the browser's input modality.
  await page.keyboard.press("Tab");
  await motion.focus();
  let phase = "motion-focus";
  try {
    await expect(motion).toBeFocused();
    phase = "reverse-tab-to-track";
    await motion.press("Shift+Tab");
    await expect(track).toBeFocused();
  } catch (error) {
    const focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const motion = document.querySelector<HTMLInputElement>(".room-demo-motion > input");
      const track = document.querySelector<HTMLElement>(".room-product-scene__phones");
      return {
        active: active && { tag: active.tagName, className: active.className, label: active.getAttribute("aria-label"), text: active.textContent?.trim().slice(0, 80), focusVisible: active.matches(":focus-visible") },
        motion: { focused: active === motion, tabIndex: motion?.tabIndex, checked: motion?.checked },
        track: { focused: active === track, tabIndex: track?.tabIndex },
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
  await expect(page.getByRole("checkbox", { name: "Motion for Room preview", exact: true })).toBeChecked();
  expect(await page.locator(".room-demo-motion").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
  const captionContrast = await page.locator(".room-demo-caption > span, .room-demo-motion").evaluateAll(elements => {
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
  expect(captionContrast).toHaveLength(2);
  for (const label of captionContrast) {
    expect(label.opaque, `${label.text} must not depend on the event artwork`).toBe(true);
    expect(label.ratio, `${label.text} text contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.getByRole("checkbox", { name: "Motion for Room preview", exact: true })).toHaveCSS("color-scheme", "light");
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
  // Keep the transport filenames stable; these now show the direct control on
  // and off, both enabled, with its actual viewport position verified.
  await positionRoomMotionInViewport(page);
  await expectRoomMotionReachable(page);
  const onLayout = await roomMotionGeometry(page);
  expect(onLayout.input.checked).toBe(true);
  expect(onLayout.input.disabled).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("room-static-section.png"), scale: "css" });
  expect(await roomMotionGeometry(page)).toEqual(onLayout);
  await setRoomAnimation(page, false);
  const offLayout = await roomMotionGeometry(page);
  expect(offLayout.input.checked).toBe(false);
  expect(offLayout.input.disabled).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("room-motion-settings.png"), scale: "css" });
  expect(await roomMotionGeometry(page)).toEqual(offLayout);
  console.info("ROOM_MOTION_LAYOUT", JSON.stringify({ capture: "Direct Motion checkbox enabled: on and off", on: onLayout, off: offLayout }));
  await setRoomAnimation(page, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "reduced-motion");
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  for (const item of await phone.locator(".scene-message").all()) {
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item).toHaveCSS("transform", "none");
  }
  const motion = page.getByRole("checkbox", { name: "Motion for Room preview", exact: true });
  await expect(motion).toBeDisabled();
  await expect(motion).not.toBeChecked();
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
  await setRoomAnimation(page, false, Boolean(testInfo.project.use.hasTouch));
  await track.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 3 });
  await track.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 3 });
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone).toHaveAttribute("data-demo-pause-reason", "paused");
  await setRoomAnimation(page, true, Boolean(testInfo.project.use.hasTouch));
  // Settings can scroll the phone offscreen. Restore visibility before resume.
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toBeInViewport({ ratio: .55 });
  await expect(phone).toHaveAttribute("data-demo-running", "true");

  const inside = page.locator(".room-product-phone--inside");
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");
  const secondStep = await inside.getAttribute("data-demo-step");
  await expect(inside).not.toHaveAttribute("data-demo-step", secondStep!, { timeout: 5000 });
  const motion = page.getByRole("checkbox", { name: "Motion for Room preview", exact: true });
  await focusRoomTrackWithKeyboard(page, motion, track);
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
  await focusRoomTrackWithKeyboard(page, motion, track);
  await expect(inside).toHaveAttribute("data-demo-running", "false");
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
  // Keyboard inspection is temporary; only the explicit motion setting persists.
  await track.press("Tab");
  await expect(motion).toBeFocused();
  await expect.poll(() => motion.evaluate(element => {
    const style = getComputedStyle(element);
    const channels = style.outlineColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
    return { visible: element.matches(":focus-visible"), wideEnough: Number.parseFloat(style.outlineWidth) >= 2,
      neutral: channels.length === 3 && Math.max(...channels) - Math.min(...channels) <= 3,
      shadow: style.boxShadow, text: style.textShadow, dropShadow: style.filter.includes("drop-shadow") };
  }), { message: "Room motion control keeps a neutral, visible keyboard outline" }).toEqual({
    visible: true, wideEnough: true, neutral: true, shadow: "none", text: "none", dropShadow: false,
  });
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-running", "true");

  // The direct checkbox works with Space and its explicit stop survives blur.
  await motion.press("Space");
  await expect(motion).not.toBeChecked();
  await motion.press("Tab");
  await expect(motion).not.toBeFocused();
  await inside.scrollIntoViewIfNeeded();
  await expect(inside).toHaveAttribute("data-demo-pause-reason", "paused");
  await setRoomAnimation(page, true, Boolean(testInfo.project.use.hasTouch));
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
