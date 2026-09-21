import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./catalogue";
import { expectVisibleLettering } from "./text-visibility";
import { matchesEventWindow } from "../../lib/event-discovery";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

test("published event details agree with the catalogue and remain readable", async ({ page, catalogue }, info) => {
  for (const event of catalogue.events) {
    await page.goto(`/event/${event.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: event.title, exact: true })).toBeVisible();
    const poster = page.locator(".event-detail-poster img");
    await expect(poster).toBeVisible();
    await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(poster).toHaveCSS("object-fit", "contain");
    await expect(poster).toHaveCSS("filter", "none");
    const bounds = await page.locator(".event-detail-poster").boundingBox();
    if (page.viewportSize()!.width > 760) {
      expect(bounds!.width).toBeLessThanOrEqual(401);
      expect(bounds!.height).toBeLessThanOrEqual(481);
    }
    await expect(page.locator(".event-detail-preview")).toHaveCount(0);
    if (event.isVerified) await expect(page.locator(".event-detail-verified")).toContainText("Verified event");
    if (event.colourScheme) await expect(page.locator(".poster-event-page")).toHaveAttribute("data-colour-scheme", event.colourScheme);
    const wash = await page.locator(".poster-event-page").evaluate(el => getComputedStyle(el).getPropertyValue("--event-wash").trim());
    await expect(page.locator("body")).toHaveCSS("--event-shell-wash", wash);
    if (event.dressCode) await expect(page.locator(".event-dress-code")).toContainText(event.dressCode);
    if (event.guestPerk) await expect(page.locator(".event-guest-perk")).toContainText(event.guestPerk);
    if (event.scheduleStatus === "coming_soon") {
      await expect(page.locator(".event-coming-soon")).toContainText(event.fullDate);
      await expect(page.locator(".event-detail-facts time")).toHaveCount(0);
      await expect(page.getByRole("timer")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
      expect((await page.request.get(`/api/calendar/${event.slug}`)).status()).toBe(404);
    } else {
      await expect(page.locator(".event-detail-facts time")).toHaveAttribute("datetime", event.startsAt!);
      const calendar = await page.request.get(`/api/calendar/${event.slug}`);
      expect(calendar.ok()).toBe(true);
      expect(await calendar.text()).toContain(`DTSTART:${event.startsAt!.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    }
    await expectVisibleLettering(page, ".event-detail-layout, .event-detail-toolbar");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${event.slug}.png`), fullPage: true });
  }
});

test("discovery shows the available catalogue with full flyers and aligned rows", async ({ page, catalogue }, info) => {
  const visible = catalogue.screens!.filter(({ event }) => matchesEventWindow(event, "next", Date.now())).map(({ event }) => event);
  for (const path of ["/", "/events"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Next up", exact: true })).toBeEnabled();
    const expected = visible.slice(0, path === "/" ? 6 : 12);
    const cards = page.locator(".discovery-grid .drop-card");
    await expect(cards).toHaveCount(expected.length);
    for (const event of expected) {
      const card = cards.filter({ has: page.locator(`h3 a[href="/event/${event.slug}"]`) });
      await expect(card).toBeVisible();
      await expect(card.locator("h3")).toHaveText(event.title);
      await expect(card.locator(".drop-card__quip")).toHaveText(event.quip);
      const poster = card.locator(".drop-card__image img");
      await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(poster).toHaveCSS("object-fit", "contain");
      if (!event.startsAt) await expect(card.locator("time")).toHaveCount(0);
    }
    const rows = await cards.evaluateAll(elements => elements.map(card => ({
      top: card.getBoundingClientRect().top,
      width: card.getBoundingClientRect().width,
      poster: card.querySelector(".drop-card__image")!.getBoundingClientRect().height,
      cells: Array.from(card.querySelector(".drop-card__body")!.children).map(child => child.getBoundingClientRect().top),
    })));
    for (const row of rows) {
      if (page.viewportSize()!.width > 700) {
        expect(row.width).toBeLessThanOrEqual(281);
        expect(row.poster).toBeLessThanOrEqual(337);
      }
      for (const peer of rows.filter(peer => Math.abs(peer.top - row.top) <= 1)) {
        expect(Math.abs(row.width - peer.width)).toBeLessThanOrEqual(1);
        row.cells.forEach((top, index) => expect(Math.abs(top - peer.cells[index])).toBeLessThanOrEqual(1));
      }
    }
    await expectVisibleLettering(page, ".discovery-grid");
    await page.screenshot({ path: info.outputPath(path === "/" ? "published-home.png" : "published-directory.png"), fullPage: true });
  }
});

test("removed events stay absent from listings, calendars and private page shells", async ({ page, catalogue }) => {
  test.setTimeout(60_000);
  const removed = ["after-dark-osu", "noir-room-labone", "longitude-spintex", ...(process.env.E2E_BASE_URL ? ["the-weekend-braai"] : [])];
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const slug of removed) {
    expect(catalogue.events.some(event => event.slug === slug)).toBe(false);
    expect(sitemap).not.toContain(`/event/${slug}`);
    expect((await page.request.get(`/api/calendar/${slug}`)).status()).toBe(404);
    for (const path of ["event", "checkout", "rsvp", "room", "my-nights"]) {
      await page.goto(`/${path}/${slug}`);
      await expect(page.getByRole("heading", { name: "This link left early.", exact: true })).toBeVisible();
      await expect(page.locator(".event-detail-overview, .registration-form, .room-page, .night-hub")).toHaveCount(0);
    }
  }
});
