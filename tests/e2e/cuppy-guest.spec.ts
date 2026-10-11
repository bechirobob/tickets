import { expect, test } from "./catalogue";

test("confirmed Pink Edition shows the new flyer without the retired DJ overlay", async ({ page }) => {
  await page.goto("/event/sun-chasers-labadi");
  const poster = page.locator(".event-detail-poster > img");
  await expect(poster).toHaveAttribute("src", "/events/on-the-guest-list-20261025.webp");
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".cuppy-guest")).toHaveCount(0);
  await expect(page.locator(".event-host")).toContainText("Kofi Bills");
  await expect(page.locator(".event-story-intro")).toContainText("Club House Inc");
  await expect(page.locator(".event-credits section")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
