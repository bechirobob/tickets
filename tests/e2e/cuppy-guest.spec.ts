import { expect, test } from "./catalogue";

test("Cuppy keeps the flyer and booking layout intact, with controllable motion", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === "pull_request", "The production PR audit still serves the previous release; candidate CI and the post-deploy audit cover this addition");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/event/sun-chasers-labadi");
  const guest = page.locator(".cuppy-guest");
  const art = guest.locator(".cuppy-guest__art");
  await expect(guest).toBeVisible();
  await expect(guest.getByText("Special Guest DJ", { exact: true })).toBeVisible();
  await expect(guest.locator("strong")).toHaveText("Cuppy");
  await expect(guest).toHaveAttribute("data-playing", "true");
  await expect(art).toHaveCSS("animation-play-state", "running");
  expect((await page.request.get("/events/dj-cuppy-decks.webp")).ok()).toBe(true);
  const poster = page.locator(".event-detail-poster > img");
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(poster).toHaveAttribute("src", /on-the-guest-list\.webp/);
  await expect(poster).toHaveCSS("mix-blend-mode", "multiply");

  const sizes = page.viewportSize()!.width > 760 ? [1280, 800] : [390, 320];
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 844 });
    const name = guest.locator("strong");
    await expect(name).toHaveCSS("white-space", "nowrap");
    const nameLayout = await name.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = Array.from(range.getClientRects());
      return { lines: rects.length, width: element.scrollWidth, available: element.parentElement!.clientWidth };
    });
    expect(nameLayout.lines).toBe(1);
    expect(nameLayout.width).toBeLessThanOrEqual(nameLayout.available);
    const initialFrame = await art.evaluate(element => getComputedStyle(element).backgroundPosition);
    await expect.poll(() => art.evaluate(element => getComputedStyle(element).backgroundPosition), { timeout: 4000 }).not.toBe(initialFrame);
    const result = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>(".cuppy-guest")!;
      const targets = [".event-detail-poster > img", ".event-detail-overview", "#register"];
      const bounds = () => targets.map(selector => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      });
      const before = bounds();
      const parent = overlay.parentElement!;
      overlay.remove();
      const without = bounds();
      parent.appendChild(overlay);
      const box = overlay.getBoundingClientRect();
      const image = document.querySelector<HTMLImageElement>(".event-detail-poster > img")!;
      const poster = image.getBoundingClientRect();
      const scale = Math.min(poster.width / image.naturalWidth, poster.height / image.naturalHeight);
      const artworkTop = poster.top + (poster.height - image.naturalHeight * scale) / 2;
      return { before, without, right: box.right, left: box.left, bottom: box.bottom, titleTop: artworkTop + 520 * scale, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(result.before).toEqual(result.without);
    expect(result.overflow).toBe(false);
    expect(result.left).toBeGreaterThanOrEqual(0);
    expect(result.right).toBeLessThanOrEqual(width);
    expect(result.bottom).toBeLessThan(result.titleTop);
    await page.screenshot({ path: testInfo.outputPath(`cuppy-${width}.png`), fullPage: true });
  }
  await guest.getByRole("button", { name: "Pause Cuppy animation" }).click();
  await expect(guest).toHaveAttribute("data-playing", "false");
  await expect(art).toHaveCSS("animation-play-state", "paused");
  await guest.getByRole("button", { name: "Play Cuppy animation" }).click();
  await expect(guest).toHaveAttribute("data-playing", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(guest).toHaveAttribute("data-playing", "false");
  await expect(art).toHaveCSS("animation-name", "none");
  // A phone's reduced-motion setting disables autoplay, but an explicit tap can play.
  await guest.getByRole("button", { name: "Play Cuppy animation" }).click();
  await expect(guest).toHaveAttribute("data-playing", "true");
  const reducedFrame = await art.evaluate(element => getComputedStyle(element).backgroundPosition);
  await expect.poll(() => art.evaluate(element => getComputedStyle(element).backgroundPosition), { timeout: 4000 }).not.toBe(reducedFrame);
  await guest.getByRole("button", { name: "Pause Cuppy animation" }).click();
  await expect(guest).toHaveAttribute("data-playing", "false");
  await expect(art).toHaveCSS("animation-name", "none");
});
