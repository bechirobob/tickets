import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectVisibleLettering } from "./text-visibility";
test.use({ serviceWorkers: "block" });

test("poster, event facts and pending sales fit both launch events", async ({ page }, testInfo) => {
  for (const slug of ["the-weekend-braai", "sun-chasers-labadi"]) {
    await page.goto(`/event/${slug}`);
    const poster = page.locator(".event-detail-poster img");
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(poster).toHaveCSS("object-fit", "contain");
    await expect(poster).toHaveCSS("filter", "none");
    await expect(page.getByRole("button", { name: "Copy Link", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get tickets", exact: true })).toHaveCount(0);
    await expect(page.locator(".event-state-notice")).toContainText("Ticket sales open soon");
    await expect(page.locator(".event-detail-preview")).toHaveCount(0);
    if (slug === "sun-chasers-labadi") {
      await expect(page.locator(".event-coming-soon")).toContainText("Coming soon");
      await expect(page.locator(".event-detail-facts time")).toHaveCount(0);
      await expect(page.getByRole("timer")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
      await expect(page.locator(".event-dress-code")).toContainText("Light pink & white");
      await expect(page.locator(".event-guest-perk .mimosa-glass")).toBeVisible();
      await expect(page.locator(".event-detail-layout")).not.toContainText(/4 October|13 September|10 PM|first Sunday/i);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
      expect((await page.request.get("/api/calendar/sun-chasers-labadi")).status()).toBe(404);
    } else {
      await expect(page.getByRole("heading", { name: "The Weekend Braai — Birthday Edition", exact: true })).toBeVisible();
      await expect(page.locator(".event-detail-facts time")).toHaveAttribute("datetime", "2026-09-20T14:00:00.000Z");
      await expect(page.locator(".event-hours")).toHaveAttribute("aria-label", /2\s?PM onwards, Accra time/);
      await expect(page.locator(".event-guest-perk")).toContainText("Unlimited grills & drinks");
      await expect(page.locator(".compact-ticket-panel")).toContainText("350");
      await expect(page.locator(".event-detail-facts")).toContainText("No. 19 Akosombo Street");
      await expect(page.locator(".event-detail-verified")).toHaveCount(0);
      await expect(page.getByRole("timer")).not.toHaveAttribute("aria-label", "Loading countdown");
      const ics = await (await page.request.get("/api/calendar/the-weekend-braai")).text();
      expect(ics).toContain("DTSTART:20260920T140000Z");
      expect(ics).not.toContain("DTEND");
    }
    await expectVisibleLettering(page, ".event-detail-layout, .event-detail-toolbar");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical")).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${slug}.png`), fullPage: true });
    await page.goto(`/checkout/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/event/${slug}$`));
  }
});

test("full flyers and event lettering stay visible on the two-event Drop", async ({ page }, testInfo) => {
  await page.goto("/");
  const cards = page.locator(".discovery-grid .drop-card");
  await expect(cards).toHaveCount(2);
  for (const slug of ["the-weekend-braai", "sun-chasers-labadi"]) {
    const card = cards.filter({ has: page.locator(`a[href="/event/${slug}"]`) });
    await expect(card).toBeVisible();
    const poster = card.locator(".drop-card__image img");
    await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(poster).toHaveCSS("object-fit", "contain");
    const bounds = await poster.evaluate((image) => {
      const rect = image.getBoundingClientRect(), container = image.closest(".drop-card__image")!.getBoundingClientRect();
      return [rect.top - container.top, rect.left - container.left, container.right - rect.right, container.bottom - rect.bottom];
    });
    expect(Math.min(...bounds)).toBeGreaterThanOrEqual(-1);
  }
  await expect(cards.filter({ hasText: "On The Guest List" })).toContainText("Coming soon");
  await expect(page.locator(".discovery-home .night-drop--compact")).toHaveCSS("background-color", "rgb(48, 32, 51)");
  await expectVisibleLettering(page, ".discovery-grid");
  await page.screenshot({ path: testInfo.outputPath("two-event-home.png"), fullPage: true });
});

test("event lettering and colours work on both events and narrow future details", async ({ page }) => {
  for (const [slug, palette] of [["the-weekend-braai", "sunset"], ["sun-chasers-labadi", "blush"]]) {
    await page.goto(`/event/${slug}`);
    await expect(page.locator(".poster-event-page")).toHaveAttribute("data-colour-scheme", palette);
    const wash = await page.locator(".poster-event-page").evaluate((main) => getComputedStyle(main).getPropertyValue("--event-wash").trim());
    await expect(page.locator("body")).toHaveCSS("--event-shell-wash", wash);
    await expectVisibleLettering(page, ".event-detail-layout");
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.querySelector("#event-title")!.textContent = "The Sunday Social: A Very Long Name for a Very Good Day Party with Friends from Across Accra";
    document.querySelector(".event-dress-code strong")!.textContent = "Light pink, white and whatever makes you feel like the best dressed person in the group chat";
  });
  await expectVisibleLettering(page, ".event-detail-layout");
});

test("retired preview events and calendars cannot be reached", async ({ page }) => {
  for (const slug of ["after-dark-osu", "noir-room-labone", "longitude-spintex"]) {
    await page.goto(`/event/${slug}`);
    await expect(page.locator(".event-detail-overview")).toHaveCount(0);
    expect((await page.request.get(`/api/calendar/${slug}`)).status()).toBe(404);
  }
});

test("countdown changes to doors opened without inventing a closing time", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-20T13:59:00Z") });
  await page.goto("/event/the-weekend-braai");
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.setSystemTime(new Date("2026-09-20T14:00:01Z"));
  await page.clock.runFor(1000);
  await expect(page.getByText("Doors have opened", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
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
