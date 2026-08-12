import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const publicPages = ["/", "/events", "/help", "/privacy"];

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
  await page.goto("/checkout/after-dark-osu");
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
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
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
