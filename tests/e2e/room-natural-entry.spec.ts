import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./catalogue";

test.use({ video: "on" });

async function geometry(page: Page) {
  return page.evaluate(() => {
    const phone = document.querySelector<HTMLElement>(".room-product-phone--arrival")!;
    const r = phone.getBoundingClientRect();
    const header = document.querySelector(".discovery-home > .night-header")?.getBoundingClientRect();
    const dock = document.querySelector(".customer-dock")?.getBoundingClientRect();
    const items = [...phone.querySelectorAll<HTMLElement>(".scene-message")].filter(item => !item.hidden);
    const anchor = phone.querySelector(".room-demo-typing") ?? items.at(-1);
    const a = anchor?.getBoundingClientRect();
    const top = Math.max(0, header?.bottom ?? 0);
    const bottom = Math.min(innerHeight, dock?.top ?? innerHeight);
    return { time: performance.now(), scrollY, viewport: { width: innerWidth, height: innerHeight },
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      visibleHeight: Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(0, r.top)),
      ready: phone.dataset.demoReady, running: phone.dataset.demoRunning,
      pauseReason: phone.dataset.demoPauseReason ?? null, step: phone.dataset.demoStep,
      visibleCount: items.length, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      documentHidden: document.hidden, usableTop: top, usableBottom: bottom,
      anchorVisible: Boolean(a && a.top >= top && a.bottom <= bottom) };
  });
}

for (const short of [false, true]) {
  test(`Room messages arrive after natural mobile entry${short ? " in a short viewport" : ""}`, async ({ page, browserName }, testInfo) => {
    test.skip((page.viewportSize()?.width ?? 1000) > 700, "Mobile entry evidence");
    test.setTimeout(45000);
    if (short) await page.setViewportSize({ width: page.viewportSize()!.width, height: 280 });
    // No reduced-motion override, programmatic centering, or synthetic demo state.
    await page.goto("/");
    const phone = page.locator(".room-product-phone--arrival");
    await expect(phone).toHaveAttribute("data-demo-ready", "true");
    const prepared = await geometry(page);
    expect(prepared.reducedMotion).toBe(false);
    expect(prepared.visibleCount).toBe(0);
    expect(prepared.running).toBe("false");
    await page.evaluate(() => {
      const phone = document.querySelector<HTMLElement>(".room-product-phone--arrival")!;
      const target = window as typeof window & { roomEntryTrace: Array<{ time: number; count: number; step: string | undefined; running: string | undefined; newMessageAnimating: boolean; newMessageOnscreen: boolean }> };
      target.roomEntryTrace = [];
      const record = () => {
        const shown = [...phone.querySelectorAll<HTMLElement>(".scene-message")].filter(item => !item.hidden);
        const box = shown.at(-1)?.getBoundingClientRect();
        const headerBottom = document.querySelector(".night-header")?.getBoundingClientRect().bottom ?? 0;
        const dockTop = document.querySelector(".customer-dock")?.getBoundingClientRect().top ?? innerHeight;
        target.roomEntryTrace.push({ time: performance.now(), count: shown.length,
          step: phone.dataset.demoStep, running: phone.dataset.demoRunning,
          newMessageAnimating: Boolean(shown.at(-1)?.getAnimations().some(animation => animation.playState === "running")),
          newMessageOnscreen: Boolean(box && box.bottom > Math.max(0, headerBottom) && box.top < Math.min(innerHeight, dockTop)) });
      };
      new MutationObserver(record).observe(phone, { subtree: true, childList: true, attributes: true,
        attributeFilter: ["hidden", "data-demo-step", "data-demo-ready", "data-demo-running"] });
      record();
    });
    const samples = [prepared];
    const session = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
    let entered = false;
    let insertions: Array<{ time: number; count: number; step: string | undefined; running: string | undefined; newMessageAnimating: boolean; newMessageOnscreen: boolean }> = [];
    try {
      for (let gesture = 0; gesture < 32; gesture++) {
        const current = await geometry(page);
        samples.push(current);
        if (current.anchorVisible && current.running === "true") { entered = true; break; }
        const viewport = page.viewportSize()!;
        const x = Math.round(viewport.width * .55);
        const y = Math.min(viewport.height - 100, Math.round(viewport.height * .72));
        const distance = Math.min(180, y - 75);
        if (session) {
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
          for (let part = 1; part <= 6; part++) {
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - distance * part / 6 }] });
            // Input pacing models a controlled finger drag, not an application readiness sleep.
            await page.waitForTimeout(16);
          }
          await page.waitForTimeout(80);
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          // Mobile WebKit has no wheel or drag input API. Incremental viewport
          // scrolling is explicitly not physical iPhone touch evidence.
          await page.evaluate(amount => window.scrollBy({ top: amount, behavior: "instant" }), distance);
        }
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(current.scrollY);
      }
      expect(entered, "Natural scrolling should expose an active message area above the dock").toBe(true);
      await page.screenshot({ path: testInfo.outputPath("room-natural-entry.png") });
      await expect(phone.locator(".scene-message:visible")).toHaveCount(5, { timeout: 18000 });
      insertions = await page.evaluate(() => (window as typeof window & { roomEntryTrace: Array<{ time: number; count: number; step: string | undefined; running: string | undefined; newMessageAnimating: boolean; newMessageOnscreen: boolean }> }).roomEntryTrace);
      for (const count of [1, 2, 3, 4, 5]) {
        const arrival = insertions.find(sample => sample.count === count);
        expect(arrival, `Message ${count} must arrive as its own state`).toBeDefined();
        expect(arrival!.newMessageAnimating, `Message ${count} must animate instead of being prefilled`).toBe(true);
        expect(arrival!.newMessageOnscreen, `Message ${count} must arrive in the visible conversation area`).toBe(true);
      }
      const sizes = await phone.evaluate(element => ({
        emoji: parseFloat(getComputedStyle(element.querySelector(".chat-reaction > i")!).fontSize),
        message: parseFloat(getComputedStyle(element.querySelector(".scene-message p")!).fontSize),
      }));
      expect(sizes.emoji).toBeLessThanOrEqual(sizes.message);
      samples.push(await geometry(page));
      await page.screenshot({ path: testInfo.outputPath("room-natural-complete.png") });
    } finally {
      // Preserve geometry evidence even when an entry assertion fails.
      await writeFile(testInfo.outputPath("room-natural-entry.json"), JSON.stringify({
        project: testInfo.project.name, input: session ? "Chromium touch input in an emulated mobile viewport" : "WebKit mobile viewport with incremental programmatic scrolling",
        shortViewport: short, samples, insertions,
      }, null, 2));
      await session?.detach();
    }
  });
}

// The application shell requires JavaScript; hook-level tests cover the
// unhydrated component fallback. Verify the supported browser accessibility path.
test("Room stays complete and readable with reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const phone = page.locator(".room-product-phone--arrival");
  await phone.scrollIntoViewIfNeeded();
  await expect(phone).toHaveAttribute("data-demo-running", "false");
  await expect(phone.locator(".scene-message:visible")).toHaveCount(5);
  await expect(phone.locator(".room-demo-typing")).toHaveCount(0);
  await expect.poll(() => phone.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await phone.screenshot({ path: testInfo.outputPath("room-reduced-motion.png") });
});
