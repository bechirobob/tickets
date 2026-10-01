import { expect, test } from "./catalogue";

test.use({ video: "on" });

test("Room demo tells a conversation while the hardware stays still and can pause", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "true");
  const initial = await phone.boundingBox();
  const composer = await phone.locator(".chat-compose-field").boundingBox();
  await expect(phone.locator(".room-demo-typing")).toBeVisible({ timeout: 5000 });
  await phone.screenshot({ path: testInfo.outputPath("room-typing.png") });
  await expect(phone.locator('[data-room-item="arrival-2"]')).toBeVisible({ timeout: 5000 });
  await expect(phone.locator('[data-room-item="arrival-0"]')).toHaveCSS("animation-name", "none");
  await expect(phone).toHaveCSS("transform", "none");
  const later = await phone.boundingBox();
  expect(later).toEqual(initial);
  expect(await phone.locator(".chat-compose-field").boundingBox()).toEqual(composer);
  const pause = page.getByRole("button", { name: "Pause Room preview", exact: true });
  await pause.click();
  const step = await phone.getAttribute("data-demo-step");
  await page.waitForTimeout(3300);
  await expect(phone).toHaveAttribute("data-demo-step", step!);
  await expect(phone.locator(".room-product-phone__stream")).toHaveCSS("opacity", "1");
  await phone.screenshot({ path: testInfo.outputPath("room-paused.png") });
  await page.getByRole("button", { name: "Play Room preview", exact: true }).click();
  await expect(phone).not.toHaveAttribute("data-demo-step", step!, { timeout: 5000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(phone).toHaveAttribute("data-demo-step", "6");
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  for (const item of await phone.locator(".scene-message").all()) {
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item).toHaveCSS("transform", "none");
  }
  await page.locator("#the-room").screenshot({ path: testInfo.outputPath("room-static-section.png") });
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
});
