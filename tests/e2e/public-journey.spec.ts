import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  "/tickets",
  "/account/privacy",
  "/event/after-dark-osu",
  "/checkout/after-dark-osu",
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

test("featured nights keep the hero, Drop and Room synchronized", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const experience = page.locator(".active-night-experience");
  const hero = page.getByRole("region", { name: "Featured nights" });
  const firstSlug = await experience.getAttribute("data-active-night");

  await expect(hero.locator(".active-night-controls")).toHaveCount(0);
  await expect(experience).not.toHaveAttribute("data-active-night", firstSlug ?? "waiting", { timeout: 6_500 });

  // Freeze the scene before comparing separate elements; another 4.5-second
  // transition must not race these reads on a slower browser runner.
  await hero.getByRole("button", { name: "Motion on: pause featured nights slideshow", exact: true }).click();
  await expect(hero.getByRole("button", { name: "Motion off: play featured nights slideshow", exact: true })).toHaveAttribute("aria-pressed", "true");

  const activeSlug = await experience.getAttribute("data-active-night");
  expect(activeSlug).toBeTruthy();
  await expect(page.locator('.drop-card[data-featured="true"]')).toHaveAttribute("data-event-slug", activeSlug!);

  // CSS uppercases the poster heading; compare its actual event text.
  const heroTitle = (await hero.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
  expect(heroTitle).toBeTruthy();
  await expect(page.locator(".room-product-phone__header b").first()).toHaveText(heroTitle);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("My Nights exposes secure recovery to a signed-out customer", async ({ page }) => {
  await page.goto("/my-nights");
  await expect(page.getByRole("heading", { name: /Use the email you paid with/u })).toBeVisible();
  await expect(page.getByLabel("Email used at checkout")).toBeVisible();
});

test("preview events remain excluded from search while sharing metadata stays complete", async ({ page }) => {
  await page.goto("/event/after-dark-osu");
  await expect(page.getByRole("heading", { name: "After Dark: Osu" })).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /After Dark: Osu/u);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\//u);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
});

test("checkout groups mobile money providers separately from secure card payment", async ({ page }) => {
  await page.goto("/events");
  await page.locator(".drop-card").filter({ hasText: /From GH₵/u }).first().getByRole("link", { name: /^See /u }).click();
  await page.getByRole("link", { name: "Get tickets", exact: true }).click();
  const mobileMoney = page.getByRole("radio", { name: /Mobile Money/u });
  const card = page.getByRole("radio", { name: /^Card/u });
  await expect(mobileMoney).not.toBeChecked();
  await expect(card).not.toBeChecked();
  await expect(page.getByRole("radiogroup", { name: "Choose mobile money service" })).toHaveCount(0);
  await mobileMoney.click();
  await expect(mobileMoney).toBeChecked();
  await expect(page.getByRole("radiogroup", { name: "Choose mobile money service" })).toBeVisible();
  await card.click();
  await expect(card).toBeChecked();
  await expect(page.getByText("BeCore never receives or stores your card number.")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Choose mobile money service" })).toHaveCount(0);
  const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze())
    .violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
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
  test(`${path} has no automatically detectable serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
  });

  test(`${path} follows the flat, readable public design contract`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
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
        const style = getComputedStyle(element);
        return style.boxShadow !== "none" || style.textShadow !== "none";
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

test("the public shell stays inside a lean transfer budget", async ({ page }) => {
  await page.goto("/");
  const bytes = await page.evaluate(() => performance.getEntriesByType("resource").reduce((total, entry) => {
    const resource = entry as PerformanceResourceTiming;
    return total + (resource.transferSize || 0);
  }, 0));
  expect(bytes).toBeLessThan(2_500_000);
});
