import { expect, test } from "./catalogue";

test("Room iPhone safe area keeps native status glyphs clear of the island", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  const frame = phone.locator(".room-product-phone__render");
  await expect(frame).toHaveAttribute("src", "/devices/iphone-15-pro-frame.png");
  await expect.poll(() => frame.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(391);
  const geometry = await phone.evaluate(element => {
    const rect = (selector: string) => {
      const { x, y, width, height, right, bottom } = element.querySelector(selector)!.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    return { display: rect(".room-product-phone__display"), island: rect(".room-product-phone__hardware > i"), clock: rect(".room-product-phone__hardware > span"), icons: rect(".room-product-phone__status"), header: rect(".room-product-phone__header") };
  });
  const { display, island, clock, icons, header } = geometry;
  expect(Math.abs(island.x + island.width / 2 - display.x - display.width / 2)).toBeLessThan(1);
  expect(island.width / display.width).toBeCloseTo(.3268, 2);
  expect(island.height / display.width).toBeCloseTo(.1014, 2);
  expect(island.y - display.y).toBeGreaterThan(5);
  expect(clock.right + 5).toBeLessThan(island.x);
  expect(icons.x - 5).toBeGreaterThan(island.right);
  expect(header.y - island.bottom).toBeGreaterThan(4);
  expect(clock.y).toBeGreaterThan(display.y + 5);
  expect(icons.right).toBeLessThan(display.right - 10);
  await phone.screenshot({ path: testInfo.outputPath("room-phone-hardware.png"), scale: "css" });
  await page.screenshot({ path: testInfo.outputPath("room-phone-context.png"), scale: "css" });
});
