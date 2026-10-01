import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./catalogue";
import { expectSegmentedSelection } from "./segmented-control";

test.use({ serviceWorkers: "block" });

test("discovery keeps dates, count and filters coherent across selection and narrow screens", async ({ page }, info) => {
  await page.goto("/");
  const control = page.getByRole("group", { name: "When", exact: true });
  const next = control.getByRole("button", { name: "Next up", exact: true });
  await expect(next).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  await expectSegmentedSelection(control);
  for (const name of ["Tonight", "Tomorrow", "This weekend", "Next up"]) {
    const button = control.getByRole("button", { name, exact: true });
    await button.focus();
    await button.press("Enter");
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expectSegmentedSelection(control);
  }
  const count = page.locator(".discovery-result-count");
  const summary = page.locator(".discovery-filters summary");
  const countBox = await count.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(countBox && summaryBox && Math.abs(countBox.y + countBox.height / 2 - summaryBox.y - summaryBox.height / 2)).toBeLessThan(2);
  await page.locator("#drop").screenshot({ path: info.outputPath("discovery-refined.png") });
  await summary.click();
  await expect(page.getByLabel("Area", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Amapiano", exact: true }).click();
  await expect(summary).toContainText("Filters (1)");
  await page.getByRole("button", { name: "All music & moods", exact: true }).click();
  await expect(summary).toHaveText("Filters");
  await summary.click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectSegmentedSelection(control);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await control.getByRole("button", { name: "Tonight", exact: true }).click();
  await expectSegmentedSelection(control);
  await expect(control.locator(".segmented-control__selection")).toHaveCSS("transition-duration", "0s");
  await next.click();
  await count.click();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(next).toHaveCSS("outline-style", "solid");
  await expect(next).toHaveCSS("outline-width", "2px");
  await page.emulateMedia({ forcedColors: "none" });
  const accessibility = await new AxeBuilder({ page }).include("#drop").analyze();
  expect(accessibility.violations).toEqual([]);
});
