import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./catalogue";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const publicPages = [
  "/",
  "/events",
  "/about",
  "/help",
  "/privacy",
  "/terms",
  "/hosts",
  "/organizer/submit",
  "/my-nights",
  "/notifications",
  "/tickets",
  "/account/privacy",
  "/event/$published",
  "/checkout/$published",
  "/admin/login",
];

test("public navigation is usable without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("link", { name: "My Nights", exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(menu).not.toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("featured nights keep the hero, Drop and Room synchronized", async ({ page, catalogue }) => {
  const now = process.env.E2E_BASE_URL ? Date.now() : Date.parse("2026-09-19T12:00:00Z");
  if (!process.env.E2E_BASE_URL) await page.clock.setFixedTime(new Date(now));
  const scenes = catalogue.screens!.filter(({ event }) => event.eventState !== "cancelled" && event.eventState !== "postponed" && (!event.startsAt || Date.parse(event.endsAt ?? event.startsAt) > now));
  const multiple = scenes.length > 1;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Next up", exact: true })).toBeEnabled();
  const experience = page.locator(".active-night-experience");
  const hero = page.getByRole("region", { name: "Featured nights" });
  const firstSlug = await experience.getAttribute("data-active-night");

  await expect(hero.locator(".active-night-controls")).toHaveCount(0);
  const pause = hero.getByRole("button", { name: "Pause featured nights", exact: true });
  if (multiple) {
    await expect(experience).not.toHaveAttribute("data-active-night", firstSlug ?? "waiting", { timeout: 6_500 });
    await expect(pause).toHaveCSS("clip-path", "inset(50%)");
    await pause.focus();
    await expect(pause).toHaveCSS("clip-path", "none");
    await pause.click();
    await expect(hero.getByRole("button", { name: "Resume featured nights", exact: true })).toHaveAttribute("aria-pressed", "true");
  } else {
    await expect(pause).toHaveCount(0);
    await expect(experience).toHaveAttribute("data-active-night", scenes[0]?.event.slug ?? "waiting");
  }
  await expect(hero).not.toContainText(/Motion on|Motion off/);
  // Animated images may extend beyond the frame, but focusing the motion
  // control must never scroll the hero's own content away from its shade.
  expect(await hero.evaluate((element) => element.scrollTop)).toBe(0);

  const activeSlug = await experience.getAttribute("data-active-night");
  expect(activeSlug).toBeTruthy();
  const activeEvent = catalogue.events.find(event => event.slug === activeSlug);
  expect(activeEvent).toBeTruthy();
  await expect(page.locator('.drop-card[data-featured="true"]')).toHaveAttribute("data-event-slug", activeSlug!);

  // CSS uppercases the poster heading; compare its actual event text.
  const heroTitle = (await hero.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  expect(heroTitle).toBeTruthy();
  await expect(hero.getByRole("heading", { level: 1 })).toHaveCSS("text-transform", "none");
  await expect(hero.getByRole("heading", { level: 1 })).toHaveCSS("opacity", "1");
  await expect(hero.locator(".compact-hero__shade")).toHaveCSS("opacity", "1");
  const primaryAction = hero.locator('.ticket-action[data-variant="primary"]');
  await expect(primaryAction).toBeVisible();
  const actionBounds = await primaryAction.boundingBox();
  expect(actionBounds?.height).toBeGreaterThanOrEqual(44);
  expect(actionBounds?.width).toBeGreaterThanOrEqual(44);
  if (activeEvent?.scheduleStatus === 'coming_soon') {
    await expect(hero.locator('.compact-hero__price')).toHaveCount(0);
    await expect(hero).toContainText("Coming soon");
  } else if (activeEvent?.registrationMode === 'rsvp' || activeEvent?.registrationMode === 'interest') {
    const label = activeEvent.registrationMode === 'rsvp' ? 'RSVP' : 'Keep me posted';
    await expect(hero.locator('.compact-hero__price')).toHaveText(label);
    await expect(primaryAction).toHaveText(label);
    await expect(primaryAction).toHaveAttribute('href', `/rsvp/${activeSlug}`);
    await expect(hero.locator('.compact-hero__price')).not.toContainText('GH₵');
  } else {
    await expect(hero.locator('.compact-hero__price')).toContainText("GH₵350");
    await expect(hero.locator('.compact-hero__price')).not.toContainText(/fee/i);
  }
  await expect(page.locator(".room-product-phone__header b").first()).toHaveText(heroTitle);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("featured motion continues in the Room and resumes after returning to the hero", async ({ page, catalogue }) => {
  const now = process.env.E2E_BASE_URL ? Date.now() : Date.parse("2026-09-19T12:00:00Z");
  if (!process.env.E2E_BASE_URL) await page.clock.setFixedTime(new Date(now));
  const scenes = catalogue.screens!.filter(({ event }) => event.eventState !== "cancelled" && event.eventState !== "postponed" && (!event.startsAt || Date.parse(event.endsAt ?? event.startsAt) > now));
  const multiple = scenes.length > 1;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Next up", exact: true })).toBeEnabled();
  const experience = page.locator(".active-night-experience");
  const room = page.locator("#the-room");
  const track = room.locator(".room-product-scene__phones");
  await room.scrollIntoViewIfNeeded();
  // Retain the selected phone when its event changes on narrow screens.
  await track.evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
  const offset = await track.evaluate((element) => element.scrollLeft);
  const roomSlug = await experience.getAttribute("data-active-night");
  if (multiple) await expect(experience).not.toHaveAttribute("data-active-night", roomSlug ?? "waiting", { timeout: 6_500 });
  else { await page.waitForTimeout(5_000); await expect(experience).toHaveAttribute("data-active-night", roomSlug!); }
  expect(Math.abs(await track.evaluate((element) => element.scrollLeft) - offset)).toBeLessThanOrEqual(2);

  const hero = page.getByRole("region", { name: "Featured nights" });
  await hero.scrollIntoViewIfNeeded();
  await hero.hover();
  const heroSlug = await experience.getAttribute("data-active-night");
  if (multiple) await expect(experience).not.toHaveAttribute("data-active-night", heroSlug ?? "waiting", { timeout: 6_500 });
  else await expect(experience).toHaveAttribute("data-active-night", heroSlug!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (multiple) await expect(hero.getByRole("button", { name: "Pause featured nights", exact: true })).toBeDisabled();
  else await expect(hero.locator(".active-night-autoplay-toggle")).toHaveCount(0);
  // Host notices must remain inside the phone's visible conversation area.
  const hostNotices = await room.locator(".scene-host").evaluateAll((notices) => notices.map((notice) => {
    const noticeBounds = notice.getBoundingClientRect();
    const streamBounds = notice.closest(".room-product-phone__stream")!.getBoundingClientRect();
    return { top: noticeBounds.top - streamBounds.top, bottom: streamBounds.bottom - noticeBounds.bottom };
  }));
  expect(hostNotices).toHaveLength(1);
  await expect(room.locator(".room-product-phone--arrival .scene-host")).toHaveCount(0);
  await expect(room.locator(".room-product-phone--arrival .scene-message")).toHaveCount(5);
  const arrivalMessages = await room.locator(".room-product-phone--arrival .scene-message").evaluateAll((messages) => messages.map((message) => {
    const bounds = message.getBoundingClientRect();
    const stream = message.closest(".room-product-phone__stream")!.getBoundingClientRect();
    return { top: bounds.top - stream.top, bottom: stream.bottom - bounds.bottom };
  }));
  for (const message of arrivalMessages) {
    expect(message.top).toBeGreaterThanOrEqual(0);
    expect(message.bottom).toBeGreaterThanOrEqual(0);
  }
  for (const notice of hostNotices) {
    expect(notice.top).toBeGreaterThanOrEqual(0);
    expect(notice.bottom).toBeGreaterThanOrEqual(0);
  }
});

test("My Nights exposes secure recovery to a signed-out customer", async ({ page }) => {
  await page.goto("/my-nights");
  await expect(page.getByRole("heading", { name: "Your plans are still here." })).toBeVisible();
  await expect(page.getByLabel("Booking or registration email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bring back my Nights" })).toHaveAttribute("type", "submit");
});

test("published event sharing metadata stays complete", async ({ page, catalogue, eventSlug }) => {
  await page.goto(`/event/${eventSlug}`);
  await expect(page.getByRole("heading", { name: catalogue.events[0].title, exact: true })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", expect.stringContaining(catalogue.events[0].title));
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\//u);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/u);
});

test("checkout follows published availability", async ({ page, catalogue }) => {
  for (const event of catalogue.events) {
    await page.goto(`/checkout/${event.slug}`);
    if (event.ticketsAvailable) {
      await expect(page).toHaveURL(new RegExp(`/checkout/${event.slug}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    } else {
      await expect(page).toHaveURL(new RegExp(`/event/${event.slug}$`));
      await expect(page.getByRole("link", { name: "Get tickets", exact: true })).toHaveCount(0);
      if (event.registrationOpen && event.registrationMode === "interest") await expect(page.getByRole("button", { name: "Keep me posted", exact: true })).toBeVisible();
      else if (event.registrationOpen && event.registrationMode === "rsvp") await expect(page.getByRole("button", { name: /^(Request an RSVP|RSVP)$/ })).toBeVisible();
    }
  }
});

test("the install manifest has complete app identity and adaptive icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json() as { id?: string; scope?: string; display?: string; icons?: Array<{ sizes?: string; purpose?: string }> };
  expect(manifest.id).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons?.some((icon) => icon.sizes === "192x192")).toBeTruthy();
  expect(manifest.icons?.some((icon) => icon.sizes === "512x512")).toBeTruthy();
  expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBeTruthy();
});

for (const path of publicPages) {
  test(`${path} has no automatically detectable serious accessibility violations`, async ({ page, eventSlug },info) => {
    await page.goto(path.replace("$published", eventSlug));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    for(const summary of await page.locator('details:not([open]) > summary').all())if(await summary.isVisible())await summary.click();
    await page.screenshot({path:info.outputPath(`${path.replaceAll('/','-')||'home'}-expanded.png`),fullPage:true,scale:'css'});
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
  });

  test(`${path} follows the flat, readable public design contract`, async ({ page, eventSlug }) => {
    await page.goto(path.replace("$published", eventSlug));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    for(const summary of await page.locator('details:not([open]) > summary').all())if(await summary.isVisible())await summary.click();
    const findings = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const directText = (element: Element) => Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      const elements = Array.from(document.querySelectorAll("body *")).filter(visible);
      const shadows = elements.filter((element) => {
        return [null, "::before", "::after"].some((pseudo) => {
          const surface = getComputedStyle(element, pseudo);
          return surface.boxShadow !== "none" || surface.textShadow !== "none" || surface.filter.includes("drop-shadow");
        });
      }).map((element) => element.className || element.tagName).slice(0, 10);
      const curvedPartialBorders = elements.filter((element) => {
        const style = getComputedStyle(element);
        const borders = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
          .map((value) => Number.parseFloat(value));
        const hasPartialBorder = borders.some((width) => width > 0) && borders.some((width) => width === 0);
        const radius = Math.max(...[
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].map((value) => Number.parseFloat(value)));
        return hasPartialBorder && radius > 0;
      }).map((element) => element.className || element.tagName).slice(0, 10);
      const tinyText = elements.filter((element) => {
        if (!directText(element) || element.closest(".room-product-phone, .notification-bell, [aria-hidden='true']")) return false;
        return Number.parseFloat(getComputedStyle(element).fontSize) < 12;
      }).map((element) => `${element.className || element.tagName}: ${directText(element)}`).slice(0, 10);
      const oversizedHeadings = Array.from(document.querySelectorAll("h1, h2"))
        .filter(visible)
        .filter((element) => element.getBoundingClientRect().height > window.innerHeight * .35)
        .map((element) => `${element.tagName}: ${element.textContent?.trim()}`).slice(0, 10);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shadows,
        curvedPartialBorders,
        tinyText,
        oversizedHeadings,
      };
    });
    expect(findings.overflow).toBeLessThanOrEqual(1);
    expect(findings.shadows).toEqual([]);
    expect(findings.curvedPartialBorders).toEqual([]);
    expect(findings.tinyText).toEqual([]);
    expect(findings.oversizedHeadings).toEqual([]);
  });
}

test("customer controls use neutral keyboard focus without halos", async ({ page }) => {
  for (const path of ["/", "/my-nights", "/notifications"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    if (path === "/") {
      // The single-event hero has no playback control. Use the shared
      // interactive readiness signal rather than focusing server markup.
      await expect(page.getByRole("button", { name: "Next up", exact: true })).toBeEnabled();
    }
    const controls = path === "/" ? page.locator('.compact-hero .ticket-action[data-variant="primary"]') : path === "/my-nights" ? page.locator('.nights-privacy') : page.locator('.account-navigation a[aria-current="page"]');
    await page.keyboard.press("Tab");
    await controls.focus();
    await expect(controls).toBeFocused();
    await expect.poll(() => controls.evaluate((element) => {
      const style = getComputedStyle(element);
      const channels = style.outlineColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
      return { visible: element.matches(":focus-visible"), wideEnough: parseFloat(style.outlineWidth) >= 2, neutral: channels.length === 3 && Math.max(...channels) - Math.min(...channels) <= 3, shadow: style.boxShadow, text: style.textShadow };
    }), { message: `Keyboard focus on ${path}` }).toEqual({ visible: true, wideEnough: true, neutral: true, shadow: "none", text: "none" });
  }
});

test("the public shell stays inside a lean transfer budget", async ({ page }) => {
  await page.goto("/");
  const bytes = await page.evaluate(() => performance.getEntriesByType("resource").reduce((total, entry) => {
    const resource = entry as PerformanceResourceTiming;
    return total + (resource.transferSize || 0);
  }, 0));
  expect(bytes).toBeLessThan(2_500_000);
});

test("the saved door pass displays the rendered identity", async ({ page }, testInfo) => {
  await page.goto("/offline-ticket.html");
  const mark = page.locator(".offline-brand img");
  await expect(mark).toBeVisible();
  await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Offline door pass", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("brand-saved-pass.png"), fullPage: true });
});

test("the offline door pass keeps the rendered identity without a network", async ({ page, context, browserName }, testInfo) => {
  // Playwright supports service-worker network instrumentation in Chromium only:
  // https://playwright.dev/docs/service-workers
  // The rendered pass above is still verified in every browser project.
  test.skip(browserName !== "chromium", "Offline service-worker emulation requires Chromium");
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // A guest opens the saved pass before losing connectivity, then reopens it
  // at the door. Keep the real document under service-worker control first.
  await page.goto("/offline-ticket.html");
  await expect(page.locator(".offline-brand img")).toBeVisible();
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const mark = page.locator(".offline-brand img");
    await expect(mark).toBeVisible();
    await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.getByText("Offline door pass", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("brand-offline-pass.png"), fullPage: true });
  } finally {
    await context.setOffline(false);
  }
});
