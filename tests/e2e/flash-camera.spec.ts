import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { Buffer as NodeBuffer } from "node:buffer";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ serviceWorkers: "block" });

async function cameraFixture(page: Page, eventSlug: string) {
  if (test.info().project.use.baseURL !== "http://127.0.0.1:8788") throw new Error("Synthetic camera fixture refuses non-local origins");
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Synthetic sensor pixels exercise real canvas, JPEG, crop and upload without camera permission or personal photos.
  await page.addInitScript(() => {
    // Observe the exact local objects without fetch(blob:), which production CSP
    // correctly excludes from connect-src. Native URL creation/revocation stays intact.
    const previews = new Map<string, Blob>();
    const issued = new Set<string>(); // URL strings only; never retains revoked Blob bytes.
    (window as typeof window & { __flashFixtureIssuedUrls: Set<string> }).__flashFixtureIssuedUrls = issued;
    (window as typeof window & { __flashFixtureBlobs: Map<string, Blob> }).__flashFixtureBlobs = previews;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = object => { const url = create(object); if (object instanceof Blob) { previews.set(url, object); issued.add(url); } return url; };
    URL.revokeObjectURL = url => { previews.delete(url); revoke(url); };
    const sensorState = { captures: 0, streams: [] as MediaStream[] };
    (window as typeof window & { __flashSyntheticSensor: typeof sensorState }).__flashSyntheticSensor = sensorState;
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { get: () => 1280 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { get: () => 720 });
    HTMLMediaElement.prototype.play = async () => {};
    const mediaDevices = { getUserMedia: async () => { const stream = new MediaStream(); sensorState.streams.push(stream); return stream; } };
    // Match the established Room/gate fixtures: WebKit may omit or replace its
    // native mediaDevices wrapper. Own the whole synthetic sensor boundary.
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, get: () => mediaDevices });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...coordinates: number[]) {
      if (image instanceof HTMLVideoElement) {
        sensorState.captures++;
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
  let refusedTraffic = false;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    // WebKit routes Blob image loads too. These are not HTTP and cannot redirect.
    // Only URLs created by this synthetic fixture may use native Blob handling;
    // a revoked one may finish as a normal cancelled load, without retaining it.
    if (url.protocol === "blob:") {
      const known = url.origin === "http://127.0.0.1:8788" && request.method() === "GET"
        && await page.evaluate(value => (window as typeof window & { __flashFixtureIssuedUrls?: Set<string> }).__flashFixtureIssuedUrls?.has(value) === true, request.url());
      if (!known) { refusedTraffic = true; return route.abort(); }
      return route.continue();
    }
    if (url.origin !== "http://127.0.0.1:8788" || !["GET", "HEAD"].includes(request.method())) { refusedTraffic = true; return route.abort(); }
    // A route normally sees only the first URL in a redirect chain. Do not let
    // a local fixture response redirect the browser to an unreviewed origin.
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) { refusedTraffic = true; return route.abort(); }
    return route.fulfill({ response });
  });
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:8788") { refusedTraffic = true; return route.abort(); }
    const path = url.pathname;
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
  await page.routeWebSocket(/.*/u, socket => {
    const url = new URL(socket.url());
    if (url.origin !== "ws://127.0.0.1:8788" || url.pathname !== "/api/room/socket") { refusedTraffic = true; socket.close(); return; }
    socket.send(JSON.stringify({ type: "snapshot", messages: [], room, online: 1 }));
  });
  await page.goto(`/room/${eventSlug}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Open Flashes/u }).click();
  await page.getByRole("button", { name: /Send a Flash/u }).click();
  await expect(page.getByRole("button", { name: "Take Flash photo" })).toBeEnabled();
  let evidenceBytes = 0;
  // Visual-only, synthetic-fixture evidence. Never reads arbitrary files, changes
  // production CSP, or substitutes for the workflow's release-admission evidence.
  async function screenshot(info: TestInfo, name: "chrome-editor" | "original-retake" | "editor-320x568" | "editor-844x390") {
    if (refusedTraffic || new URL(page.url()).origin !== "http://127.0.0.1:8788") throw new Error("Camera evidence refuses unexpected network traffic or non-local origins");
    const synthetic = await page.evaluate(() => {
      const state = (window as typeof window & { __flashSyntheticSensor?: { captures: number; streams: MediaStream[] } }).__flashSyntheticSensor;
      return Boolean(state && state.captures > 0 && state.streams.length > 0 && state.streams.every(stream => stream.getTracks().length === 0)
        && Array.from(document.querySelectorAll("video")).every(video => !video.srcObject || video.srcObject instanceof MediaStream && video.srcObject.getTracks().length === 0));
    });
    if (!synthetic) throw new Error("Camera evidence requires the track-free synthetic sensor");
    if (!["desktop-chromium", "mobile-chromium", "mobile-webkit"].includes(info.project.name)) throw new Error("Unexpected camera evidence project");
    const expected = { "chrome-editor": "all cinematic looks preview the exact outgoing blob and preserve consent", "original-retake": "rapid look changes, strength zero, comparison and retake remain safe", "editor-320x568": "narrow portrait and rotated landscape keep the saved frame and controls visible", "editor-844x390": "narrow portrait and rotated landscape keep the saved frame and controls visible" };
    if (expected[name] !== info.title) throw new Error("Unexpected camera evidence fixture");
    if (uploads.length !== 0) throw new Error("Camera evidence must precede the mocked fixture upload");
    await expect(page.locator(".flash-capture__look-label")).toHaveText(name === "original-retake" ? "Original" : "Chrome");
    await previewBytes(page); // The displayed image must be this fixture's local observed Blob.
    // Capture only this fixture's editor, excluding any surrounding page content.
    const png = NodeBuffer.from(await page.locator(".flash-capture--editing").screenshot({ path: info.outputPath(`flash-${name}.png`), scale: "css" }));
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    evidenceBytes += png.length;
    if (!png.subarray(0, 8).equals(NodeBuffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length > 512 * 1024 || evidenceBytes > 1024 * 1024 || width > 1600 || height > 1600 || width * height > 1_500_000) throw new Error("Camera evidence exceeds PNG bounds");
    if (refusedTraffic) throw new Error("Camera evidence refuses unexpected network traffic");
    const source = process.env.BECORE_RELEASE_SHA;
    if (!source && !process.env.CI) return; // Normal local tests save their usual PNG without log export.
    if (!process.env.CI || !source || !/^[a-f0-9]{40}$/u.test(source)) throw new Error("Camera evidence requires an exact CI source identity");
    const sha256 = createHash("sha256").update(png).digest("hex");
    const identity = { source, project: info.project.name, fixture: "flashes-synthetic-camera-v1", name, sha256 };
    const emit = (record: object) => console.log(`BECORE_FLASH_FIXTURE_EVIDENCE_V1 ${JSON.stringify({ ...identity, ...record })}`);
    const chunks = Math.ceil(png.length / 3072);
    emit({ type: "begin", bytes: png.length, chunks, width, height });
    for (let index = 0; index < chunks; index++) emit({ type: "chunk", index, data: png.subarray(index * 3072, (index + 1) * 3072).toString("base64") });
    emit({ type: "end", bytes: png.length, chunks });
  }
  return { uploads, screenshot };
}

async function previewBytes(page: Page) {
  return page.locator(".flash-capture__preview img").evaluate(async (element: HTMLImageElement) => {
    await element.decode();
    const blob = (window as typeof window & { __flashFixtureBlobs: Map<string, Blob> }).__flashFixtureBlobs.get(element.currentSrc);
    if (!blob) throw new Error("Expected the displayed, unreleased preview Blob");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
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
  const { uploads, screenshot } = await cameraFixture(page, eventSlug);
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
  await screenshot(info, "chrome-editor");
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
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __flashFixtureBlobs: Map<string, Blob> }).__flashFixtureBlobs.size)).toBe(0);
});

test("rapid look changes, strength zero, comparison and retake remain safe", async ({ page, eventSlug, browserName }, info) => {
  const { uploads, screenshot } = await cameraFixture(page, eventSlug);
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
  const oldUrls = await page.evaluate(() => Array.from((window as typeof window & { __flashFixtureBlobs: Map<string, Blob> }).__flashFixtureBlobs.keys()));
  await dialog.getByRole("button", { name: "Retake" }).click();
  await expect.poll(() => page.evaluate(urls => urls.every(url => !(window as typeof window & { __flashFixtureBlobs: Map<string, Blob> }).__flashFixtureBlobs.has(url)), oldUrls)).toBe(true);
  await page.getByRole("button", { name: "Take Flash photo" }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: /^Original:/u })).toHaveAttribute("aria-pressed", "true");
  await screenshot(info, "original-retake");
  expect(uploads).toHaveLength(0);
});

test("narrow portrait and rotated landscape keep the saved frame and controls visible", async ({ page, eventSlug }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { screenshot } = await cameraFixture(page, eventSlug);
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
    await screenshot(info, size.width === 320 ? "editor-320x568" : "editor-844x390");
    await page.getByRole("button", { name: "Retake" }).click();
  }
});
