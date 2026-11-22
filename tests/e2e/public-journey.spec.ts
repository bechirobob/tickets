import { isWebsiteListedEvent } from "../../lib/website-event-listings";
import { expandEveryVisibleDisclosure } from './disclosures.mjs';
import AxeBuilder from "@axe-core/playwright";
import { expect, test, expectWebsiteDiscovery } from "./catalogue";

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
  const menu = page.locator(".night-mobile-menu__trigger");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName("Open navigation");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("navigation", { name: "Main navigation", exact: true });
  const menuHosts = panel.getByRole("link", { name: "Discover hosts", exact: true });
  if ((page.viewportSize()?.width ?? 1000) >= 701) {
    const explore = page.getByRole("navigation", { name: "Explore", exact: true });
    await expect(explore.getByRole("link", { name: "Hosts", exact: true })).toBeVisible();
    await expect(explore.getByRole("link", { name: "Hosts", exact: true })).toHaveAttribute("href", "/hosts");
    await expect(menuHosts).toBeHidden();
  } else {
    await expect(menuHosts).toBeVisible();
    await expect(menuHosts).toHaveAttribute("href", "/hosts");
  }
  await expect(panel.getByRole("link", { name: "List your event", exact: true })).toHaveAttribute("href", "/organizer/submit");
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(700);
  if ((page.viewportSize()?.width ?? 1000) <= 760) {
    await expect(menu).toBeInViewport();
    await expect(page.locator(".discovery-home > .night-header")).toHaveCSS("position", "sticky");
    await expect.poll(() => page.locator(".discovery-home > .night-header").evaluate(header => Math.round(header.getBoundingClientRect().top))).toBe(0);
  } else {
    await expect(menu).not.toBeInViewport();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("a single featured night stays synchronized with The Drop and The Room", async ({ page, catalogue }) => {
  const now = process.env.E2E_BASE_URL ? Date.now() : Date.parse("2026-09-19T12:00:00Z");
  if (!process.env.E2E_BASE_URL) await page.clock.install({ time: new Date(now) });
  const scenes = (catalogue.screens ?? []).map(({ event }) => event).filter(event => isWebsiteListedEvent(event) && event.eventState !== "cancelled" && event.eventState !== "postponed" && (!event.startsAt || Date.parse(event.endsAt ?? event.startsAt) > now));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expectWebsiteDiscovery(page, catalogue);

  const experience = page.locator(".active-night-experience");
  const hero = page.getByRole("region", { name: "Featured night", exact: true });
  const title = hero.getByRole("heading", { level: 1 });
  const activeSlug = await experience.getAttribute("data-active-night");
  await expect(hero.getByRole("button", { name: /(?:Pause|Resume|Previous|Next) featured night/i })).toHaveCount(0);
  await expect(hero.locator(".compact-hero__image")).toHaveCount(1);
  await expect(hero).not.toHaveAttribute("aria-roledescription", "carousel");

  const browse = page.locator("#drop").getByRole("link", { name: "Browse all events", exact: true });
  await expect(browse).toHaveCount(1);
  await expect(browse).toHaveAttribute("href", "/events");
  await expect(browse.locator(".lucide-arrow-up-right")).toHaveCount(0);
  const browseTarget = await browse.boundingBox();
  expect(browseTarget?.height).toBeGreaterThanOrEqual(44);
  const dropContent = page.locator("#drop :is(.event-empty, .discovery-explorer)").first();
  const contentBounds = await dropContent.boundingBox();
  expect(browseTarget!.y).toBeGreaterThanOrEqual(contentBounds!.y + contentBounds!.height - 1);

  if (!scenes.length) {
    expect(activeSlug).toBe("waiting");
    await expect(title).toHaveText("Plans, sorted.");
    await expect(hero.locator(".compact-hero__price")).toHaveCount(0);
    await expect(page.locator(".room-product-phone__header b").first()).toHaveText("After Dark");
  } else {
    const active = scenes.find(event => event.slug === activeSlug);
    expect(active, "Featured event comes from the eligible public catalogue").toBeTruthy();
    await expect(title).toHaveText(active!.title);
    await expect(title).toHaveCSS("text-transform", "none");
    await expect(page.locator(".room-product-phone__header b").first()).toHaveText(active!.title);
    const card = page.locator('.drop-card[data-featured="true"]');
    if (await card.count()) await expect(card).toHaveAttribute("data-event-slug", activeSlug!);
    const primary = hero.locator('.ticket-action[data-variant="primary"]');
    await expect(primary).toBeVisible();
    const box = await primary.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    if (active?.scheduleStatus === "coming_soon") {
      await expect(hero.locator(".compact-hero__price")).toHaveCount(0);
    } else if (active?.registrationMode === "rsvp" || active?.registrationMode === "interest") {
      const label = active.registrationMode === "rsvp" ? "RSVP" : "Keep me posted";
      await expect(hero.locator(".compact-hero__price")).toHaveText(label);
      await expect(primary).toHaveText(label);
      await expect(primary).toHaveAttribute("href", `/rsvp/${activeSlug}`);
    } else {
      await expect(hero.locator(".compact-hero__price")).not.toContainText(/fee/i);
    }
  }

  // Cross the former 4.5s interval twice without freezing the browser clock
  // on hosted runs. A change in hero event, image, or title is a regression.
  const currentTitle = await title.textContent();
  const currentImage = await hero.locator("img").first().getAttribute("src");
  if (process.env.E2E_BASE_URL) await page.waitForTimeout(9_250);
  else await page.clock.runFor(9_250);
  await expect(experience).toHaveAttribute("data-active-night", activeSlug!);
  await expect(title).toHaveText(currentTitle!);
  await expect(hero.locator("img").first()).toHaveAttribute("src", currentImage!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("The Room retains its two previews, manual rail and compact conversation", async ({ page }) => {
  await page.goto("/");
  const room = page.locator("#the-room");
  const preview = room.getByRole("region", { name: "The Room preview" });
  const track = preview.locator(".room-product-scene__phones");
  await room.scrollIntoViewIfNeeded();
  await expect(preview.getByRole("group", { name: "Before arrival, 1 of 2" })).toHaveCount(1);
  await expect(preview.getByRole("group", { name: "Inside the night, 2 of 2" })).toHaveCount(1);
  for (const side of ["arrival", "inside"]) {
    const frame = room.locator(`.room-product-phone--${side} .room-product-phone__render`);
    await expect(frame).toHaveAttribute("src", `/devices/box-office-${side}.webp`);
    await expect.poll(() => frame.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  if (await track.evaluate(element => element.scrollWidth > element.clientWidth + 2)) {
    await track.focus();
    await expect(track).toBeFocused();
    await track.evaluate(element => element.scrollTo({ left: element.scrollWidth, behavior: "instant" }));
    await expect.poll(() => track.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    const position = await track.evaluate(element => element.scrollLeft);
    await expect.poll(() => track.evaluate((element, settledPosition) => Math.abs(element.scrollLeft - settledPosition), position)).toBeLessThanOrEqual(2);
  }
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
  await expect(page.getByRole("heading", { name: "Find your tickets & RSVPs." })).toBeVisible();
  await expect(page.getByLabel("Booking or registration email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email my access link" })).toHaveAttribute("type", "submit");
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
    await expandEveryVisibleDisclosure(page, 'details:not([open]) > summary');
    if (path === '/help') await expect(page.locator('.help-guide[open]')).toHaveCount(28);
    await page.screenshot({path:info.outputPath(`${path.replaceAll('/','-')||'home'}-expanded.png`),fullPage:true,scale:'css'});
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
  });

  test(`${path} follows the flat, readable public design contract`, async ({ page, eventSlug }) => {
    await page.goto(path.replace("$published", eventSlug));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expandEveryVisibleDisclosure(page, 'details:not([open]) > summary');
    if (path === '/help') await expect(page.locator('.help-guide[open]')).toHaveCount(28);
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
    const back = page.locator('.poster-event-page .back-link');
    if (await back.count()) {
      await expect(back).toHaveAccessibleName('The Drop');
      await expect(back).toHaveAttribute('href', '/events');
      const target = await back.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      const headerBoxes = await page.locator('.poster-event-page .sub-header > *').evaluateAll(elements => elements.map(el => {
        const box = el.getBoundingClientRect(); return { left: box.left, right: box.right };
      }));
      for (let i = 1; i < headerBoxes.length; i++) expect(headerBoxes[i].left - headerBoxes[i - 1].right).toBeGreaterThanOrEqual(0);
    }
  });
}

test("customer controls use neutral keyboard focus without halos", async ({ page, catalogue }) => {
  for (const path of ["/", "/my-nights", "/notifications"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    if (path === "/") await expectWebsiteDiscovery(page, catalogue);
    const controls = path === "/" ? page.locator('#drop').getByRole('link', { name: 'Browse all events', exact: true }) : path === "/my-nights" ? page.locator('.nights-privacy') : page.locator('.account-navigation a[aria-current="page"]');
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
