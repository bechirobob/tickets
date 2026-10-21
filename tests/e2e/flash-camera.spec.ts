import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ serviceWorkers: "block" });

async function cameraFixture(page: Page, eventSlug: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Synthetic sensor pixels exercise real canvas, JPEG, crop and upload without camera permission or personal photos.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { get: () => 720 });
    HTMLMediaElement.prototype.play = async () => {};
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...coordinates: number[]) {
      if (image instanceof HTMLVideoElement) {
        const sensor = document.createElement("canvas"); sensor.width = 1280; sensor.height = 720;
        const context = sensor.getContext("2d")!; const data = context.createImageData(1280, 720);
        for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
          const i = (y * 1280 + x) * 4;
          data.data[i] = Math.round(x / 1279 * 255); data.data[i + 1] = Math.round(y / 719 * 255); data.data[i + 2] = 100; data.data[i + 3] = 255;
        }
        context.putImageData(data, 0, 0); image = sensor;
      }
      return Reflect.apply(draw, this, [image, ...coordinates]);
    };
  });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const room = { eventSlug, eventTitle: "Camera fixture", readOnly: false, readOnlyAt: future };
  const uploads: Buffer[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/access")) return route.fulfill({ json: { allowed: true, attendee: { id: "self" }, room } });
    if (path.endsWith("/flashes")) {
      if (route.request().method() === "POST") {
        uploads.push(route.request().postDataBuffer()!);
        return route.fulfill({ json: { flash: { id: "camera-fixture", attendeeId: "self", mine: true, displayName: "You", width: 500, height: 1000, createdAt: new Date().toISOString(), expiresAt: future, openedAt: null } } });
      }
      return route.fulfill({ json: { flashes: [], expiresAt: future } });
    }
    return route.fulfill({ status: 401, json: { error: "Isolated camera fixture" } });
  });
  await page.routeWebSocket(/\/api\/room\/socket/u, socket => socket.send(JSON.stringify({ type: "snapshot", messages: [], room, online: 1 })));
  await page.goto(`/room/${eventSlug}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Open Flashes/u }).click();
  await page.getByRole("button", { name: /Send a Flash/u }).click();
  await expect(page.getByRole("button", { name: "Take Flash photo" })).toBeEnabled();
  return uploads;
}

async function previewBytes(page: Page) {
  return page.locator(".flash-capture__preview img").evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    return Array.from(new Uint8Array(await (await fetch(element.currentSrc)).arrayBuffer()));
  });
}

async function previewPixels(page: Page) {
  return page.locator(".flash-capture__preview img").evaluate(async (element: HTMLImageElement) => {
    await element.decode(); const canvas = document.createElement("canvas"); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d")!; context.drawImage(element, 0, 0);
    const pixel = (x: number) => Array.from(context.getImageData(x, Math.floor(canvas.height / 2), 1, 1).data);
    return { width: canvas.width, height: canvas.height, left: pixel(4), right: pixel(canvas.width - 5) };
  });
}

test("all cinematic looks preview the exact outgoing blob and preserve consent", async ({ page, eventSlug }, info) => {
  const uploads = await cameraFixture(page, eventSlug);
  const bounds = await page.locator("video").boundingBox();
  await page.getByRole("button", { name: "Take Flash photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Share this Flash" });
  await expect(dialog.locator(".flash-capture__preview img")).toHaveCSS("object-fit", "contain");
  const original = await previewBytes(page); const frame = await previewPixels(page);
  expect(frame.width / frame.height).toBeCloseTo(bounds!.width / bounds!.height, 2);
  expect(frame.left[0]).toBeLessThan(frame.right[0]);
  await expect(dialog.getByRole("button", { name: "Send Flash", exact: true })).toBeDisabled();
  for (const name of ["Noir", "35mm", "After Hours", "Chrome"]) {
    await dialog.getByRole("button", { name: new RegExp(`^${name}:`, "u") }).click();
    await expect(dialog.locator(".flash-capture__look-label")).toHaveText(name);
    await expect(dialog.getByRole("slider", { name: /Strength/u })).toHaveValue("100");
    expect(await previewBytes(page)).not.toEqual(original);
  }
  await page.screenshot({ path: info.outputPath("flash-chrome-editor.png") });
  await dialog.getByRole("button", { name: "Show original" }).click(); expect(await previewBytes(page)).toEqual(original);
  await dialog.getByRole("button", { name: "Back to look" }).click();
  const selected = Buffer.from(await previewBytes(page));
  const accessibility = await new AxeBuilder({ page }).include(".flash-capture").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Send Flash", exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(uploads).toHaveLength(1);
  expect(uploads[0].includes(selected)).toBe(true);
});

test("rapid look changes, strength zero, comparison and retake remain safe", async ({ page, eventSlug, browserName }, info) => {
  const uploads = await cameraFixture(page, eventSlug);
  await page.getByRole("button", { name: "Switch camera" }).click();
  await page.getByRole("button", { name: "Take Flash photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Share this Flash" });
  const frame = await previewPixels(page); expect(frame.left[0]).toBeGreaterThan(frame.right[0]);
  const original = await previewBytes(page);
  await dialog.getByRole("button", { name: /^Noir:/u }).click();
  await dialog.getByRole("button", { name: /^35mm:/u }).click();
  await dialog.getByRole("button", { name: /^After Hours:/u }).click();
  const slider = dialog.getByRole("slider", { name: /Strength/u }); await slider.fill("37");
  await expect(dialog.locator(".flash-capture__look-label")).toHaveText("After Hours");
  await dialog.getByRole("checkbox").check();
  const preview = dialog.locator(".flash-capture__preview");
  const bounds = (await preview.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  if (info.project.use.hasTouch) await page.touchscreen.tap(x, y);
  // Playwright exposes held real touch through Chromium CDP only. WebKit's tap
  // plus mouse hold covers pointer state, not native iPhone held-touch capture.
  const touch = browserName === "chromium" && info.project.use.hasTouch ? await page.context().newCDPSession(page) : null;
  if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  else { await page.mouse.move(x, y); await page.mouse.down(); }
  await expect(dialog.locator(".flash-capture__look-label")).toHaveText("Original");
  await expect(dialog.getByRole("button", { name: "Send Flash", exact: true })).toBeDisabled();
  if (touch) { await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await touch.detach(); }
  else { await preview.dispatchEvent("pointercancel", { pointerType: "mouse", pointerId: 1 }); await page.mouse.up(); }
  await expect(dialog.locator(".flash-capture__look-label")).toHaveText("After Hours");
  await slider.fill("0"); expect(await previewBytes(page)).toEqual(original);
  await dialog.getByRole("button", { name: "Retake" }).click();
  await page.getByRole("button", { name: "Take Flash photo" }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: /^Original:/u })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("flash-original-retake.png") });
  expect(uploads).toHaveLength(0);
});

test("narrow portrait and rotated landscape keep the saved frame and controls visible", async ({ page, eventSlug }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await cameraFixture(page, eventSlug);
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const bounds = (await page.locator("video").boundingBox())!;
    await page.getByRole("button", { name: "Take Flash photo" }).click();
    await expect(page.locator(".flash-capture__preview img")).toHaveCSS("object-fit", "contain");
    const frame = await previewPixels(page); expect(frame.width / frame.height).toBeCloseTo(bounds.width / bounds.height, 2);
    await page.getByRole("button", { name: /^Chrome:/u }).click();
    await expect(page.locator(".flash-capture__look-label")).toHaveText("Chrome");
    await expect(page.getByRole("slider", { name: /Strength/u })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send Flash", exact: true })).toBeInViewport();
    const overflow = await page.locator(".flash-capture").evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`flash-editor-${size.width}x${size.height}.png`) });
    await page.getByRole("button", { name: "Retake" }).click();
  }
});
