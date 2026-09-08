import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectVisibleLettering } from "./text-visibility";

test.use({ serviceWorkers: "block" });

test("poster, event facts and ticket access fit the event page", async ({ page }, testInfo) => {
  await page.goto("/event/sun-chasers-labadi");
  await expect(page.getByRole("heading", { name: "On The Guest List", exact: true })).toBeVisible();
  const poster = page.getByRole("img", { name: "Event poster for On The Guest List" });
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(poster).toHaveCSS("object-fit", "contain");
  await expect(poster).toHaveCSS("filter", "none");
  await expect(page.locator(".event-detail-facts")).toContainText("Asana Restaurant");
  await expect(page.locator(".event-detail-facts")).toContainText("Kempinski Gold Coast Hotel, Accra");
  await expect(page.locator(".event-hours")).toHaveAttribute("aria-label", /2\s?PM to 10\s?PM, Accra time/);
  await expect(page.locator(".event-hours")).toContainText("Doors open");
  await expect(page.locator(".event-hours")).toContainText("Last dance");
  await expect(page.getByRole("button", { name: "Copy Link", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", "/api/calendar/sun-chasers-labadi");
  await expect(page.locator(".event-detail-preview")).toHaveCount(0);
  await expect(page.locator(".event-detail-verified")).toHaveText("Verified event");
  await expect(page.locator(".event-detail-facts time")).toHaveAttribute("datetime", "2026-10-04T14:00:00.000Z");
  await expect(page.locator(".event-detail-facts time")).toContainText("October");
  await expect(page.locator(".event-dress-code")).toContainText("Light pink & white");
  await expect(page.locator(".event-guest-perk")).toHaveText("Clink early. Free mimosas till 5 PM.");
  await expect(page.locator(".event-guest-perk .mimosa-glass")).toBeVisible();
  await expect(page.locator(".event-awareness-note")).toHaveText("In support of Breast Cancer Awareness Month");
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveAttribute("data-colour-scheme", "blush");
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveCSS("background-image", /linear-gradient.*rgb\(232, 189, 204\)/);
  await expect(page.locator(".event-detail-poster")).toHaveCSS("padding", "0px");
  await expect(page.locator(".event-detail-poster")).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".event-colour-preview-note")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Get tickets", exact: true })).toBeVisible();
  const calendar = await page.request.get("/api/calendar/sun-chasers-labadi");
  expect(calendar.ok()).toBe(true);
  const calendarText = (await calendar.text()).replace(/\r\n /g, "");
  expect(calendarText).toContain("DTSTART:20261004T140000Z");
  expect(calendarText).toContain("Dress code: Light pink & white");
  expect(calendarText).toContain("Free mimosas till 5 PM.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const layout = await page.evaluate(() => {
    const posterBounds = document.querySelector(".event-detail-poster")!.getBoundingClientRect();
    const details = document.querySelector(".event-detail-overview")!.getBoundingClientRect();
    return { narrow: innerWidth <= 760, posterBottom: posterBounds.bottom, posterRight: posterBounds.right, detailsTop: details.top, detailsLeft: details.left };
  });
  if (layout.narrow) expect(layout.detailsTop).toBeGreaterThanOrEqual(layout.posterBottom);
  else expect(layout.detailsLeft).toBeGreaterThan(layout.posterRight);
  const issues = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical");
  expect(issues).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("event-poster.png"), fullPage: true });
});

test("approved event colours also work through old preview links", async ({ page }, testInfo) => {
  await page.goto("/event/sun-chasers-labadi?look=immersive");
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).not.toHaveClass(/event-palette-preview/);
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tickets.becoreops.com/event/sun-chasers-labadi");
  await expect(page).not.toHaveTitle(/Colour preview/);
  await expect(page.locator(".event-colour-preview-note")).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toContainText('"@type":"Event"');
  await expect(page.getByRole("link", { name: "Get tickets", exact: true })).toHaveAttribute("href", "/checkout/sun-chasers-labadi");
  await expect(page.getByRole("timer")).not.toHaveAttribute("aria-label", "Loading countdown");
  await expect(page.locator(".event-detail-poster")).toHaveCSS("padding", "0px");
  await expect(page.locator(".event-guest-perk .mimosa-glass")).toBeVisible();
  await expectVisibleLettering(page, ".event-detail-layout, .event-detail-toolbar");
  const issues = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical");
  expect(issues).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("event-approved-colours.png"), fullPage: true });
});

test("event lettering stays visible across all events and long future details", async ({ page }) => {
  test.setTimeout(60_000);
  for (const slug of ["after-dark-osu", "longitude-spintex", "noir-room-labone", "sun-chasers-labadi"]) {
    await page.goto(`/event/${slug}`);
    await expect(page.locator(".event-detail-overview h1")).toBeVisible();
    await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveCSS("background-image", /linear-gradient/);
    await expectVisibleLettering(page, ".event-detail-layout");
    const issues = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical");
    expect(issues, `${slug} contrast and accessibility`).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    const set = (selector: string, text: string) => { const element = document.querySelector(selector); if (element) element.textContent = text; };
    set("#event-title", "The Sunday Social: A Very Long Name for a Very Good Day Party with Friends from Across Accra");
    set(".event-detail-venue", "The Garden Terrace and Rooftop at the Grand Accra Riverside Restaurant");
    set(".event-dress-code strong", "Light pink, white and whatever makes you feel like the best dressed person in the group chat");
    set(".event-guest-perk span", "Clink early. Free mimosas till 5 PM. Bring the group chat, arrive together and leave plenty of time for a very long overdue catch-up.");
    set(".compact-ticket-panel section b", "Priority admission with reserved rooftop access for you and your friends");
    set(".compact-ticket-panel section span", "A longer ticket description that explains exactly what is included, where to arrive and how to make the most of the afternoon without losing any of the important details.");
  });
  await expectVisibleLettering(page, ".event-detail-layout");
});

test("event lettering on every Drop tile is complete", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-08-13T12:00:00Z") });
  await page.goto("/events");
  await expect(page.getByRole("button", { name: "Next up", exact: true })).toBeEnabled();
  await expect(page.locator(".discovery-grid")).toBeVisible();
  expect(await page.locator(".discovery-grid .drop-card").count()).toBeGreaterThan(0);
  await expectVisibleLettering(page, ".discovery-grid");
  for (const card of await page.locator(".discovery-grid .drop-card").all()) await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("all-event-tiles.png"), fullPage: true });
});

test("full flyers blend into the Drop while the homepage keeps its colours", async ({ page }, testInfo) => {
  await page.goto("/");
  const card = page.locator(".discovery-grid .drop-card").filter({ hasText: "On The Guest List" });
  await expect(card).toBeVisible();
  const poster = card.locator(".drop-card__image img");
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(poster).toHaveCSS("object-fit", "contain");
  await expect(card.locator(".drop-card__image .drop-card__verified")).toHaveCount(0);
  await expect(card.locator(".drop-card__verified")).toContainText("Verified event");
  await expect(page.locator(".discovery-home .night-drop--compact")).toHaveCSS("background-color", "rgb(48, 32, 51)");
  const bounds = await poster.evaluate((image) => {
    const rect = image.getBoundingClientRect();
    const container = image.closest(".drop-card__image")!.getBoundingClientRect();
    return { top: rect.top - container.top, left: rect.left - container.left, right: container.right - rect.right, bottom: container.bottom - rect.bottom };
  });
  expect(Math.min(...Object.values(bounds))).toBeGreaterThanOrEqual(-1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("homepage-full-flyer.png"), fullPage: true });
});

test("event colours belong to each opened event", async ({ page }, testInfo) => {
  await page.goto("/event/after-dark-osu");
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveAttribute("data-colour-scheme", "midnight");
  await expect(page.locator(".poster-event-page[data-colour-scheme]")).toHaveCSS("background-image", /linear-gradient.*rgb\(221, 228, 198\)/);
  await expect(page.locator(".poster-event-page > .sub-header")).toHaveCSS("color", "rgb(36, 44, 32)");
  await expect(page.locator(".customer-dock")).toHaveCSS("background-color", "rgb(221, 228, 198)");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator(".event-guest-perk")).toHaveCount(0);
  await expect(page.locator(".event-dress-code")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("event-midnight-colours.png"), fullPage: true });
  await page.locator(".sub-header .brand-mark").click();
  await expect(page.locator(".discovery-home .night-drop--compact")).toHaveCSS("background-color", "rgb(48, 32, 51)");
  await expect(page.locator(".customer-dock")).toHaveCSS("background-color", "rgb(40, 27, 43)");
});

test("copying a promoter link does not open native sharing and restores focus", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { document.documentElement.dataset.nativeShareCalled = "true"; } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (url: string) => { document.documentElement.dataset.copiedUrl = url; } } });
  });
  await page.goto("/event/sun-chasers-labadi?ref=HOST123");
  const copy = page.getByRole("button", { name: "Copy Link", exact: true });
  await copy.click();
  await expect(page.getByRole("status")).toContainText("Link copied");
  await expect(page.locator("html")).toHaveAttribute("data-copied-url", /\/event\/sun-chasers-labadi\?ref=HOST123$/);
  await expect(page.locator("html")).not.toHaveAttribute("data-native-share-called", "true");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(copy).toBeFocused();
});

test("countdown changes to event ended instead of negative time", async ({ page }) => {
  await page.clock.install();
  await page.goto("/event/sun-chasers-labadi");
  const startsAt = await page.locator(".event-detail-facts time").getAttribute("datetime");
  const start = Date.parse(startsAt!);
  await page.clock.setSystemTime(start - 60_000);
  await page.clock.runFor(1_000);
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.setSystemTime(start + 1_000);
  await page.clock.runFor(1_000);
  await expect(page.getByText("Happening now", { exact: true })).toBeVisible();
  await page.clock.setSystemTime(start + 9 * 3600_000);
  await page.clock.runFor(1_000);
  await expect(page.getByText("Event ended", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
});
