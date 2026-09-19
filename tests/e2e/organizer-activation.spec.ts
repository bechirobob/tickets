import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectVisibleLettering } from "./text-visibility";

test.use({ serviceWorkers: "block" });
const fixtureToken = "T".repeat(43);

test("organiser activation keeps the token out of the URL and requires matching passwords", async ({ page }, testInfo) => {
  let claimed = false;
  await page.route("**/api/organizer/activate", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.token).toBe(fixtureToken);
    expect(route.request().url()).not.toContain(fixtureToken);
    if (body.action === "inspect") await route.fulfill({ json: { valid: true, expiresAt: new Date(Date.now() + 60000).toISOString() } });
    else {
      claimed = true;
      expect(body.passwordIterations).toBe(600000);
      expect(body.passwordProof).toHaveLength(43);
      await route.fulfill({ json: { changed: true } });
    }
  });
  await page.goto(`/organizer/activate#token=${fixtureToken}`);
  await expect(page.getByLabel("Choose a password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/organizer\/activate$/u);
  await expectVisibleLettering(page, ".admin-recovery");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("organiser-activation-ready.png"), fullPage: true });
  await page.getByLabel("Choose a password", { exact: true }).fill("FreshOwnerPassword9");
  await page.getByLabel("Confirm password").fill("DifferentPassword9");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByRole("alert")).toContainText("don’t match");
  expect(claimed).toBe(false);
  await page.getByLabel("Confirm password").fill("FreshOwnerPassword9");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByRole("status")).toContainText("You’re set.");
  await expect(page.getByRole("link", { name: "Open my dashboard" })).toHaveAttribute("href", "/admin/login?returnTo=/organizer/workspace");
  await expectVisibleLettering(page, ".admin-recovery");
  expect(claimed).toBe(true);
});

test("organiser activation explains missing and expired links without showing a password form", async ({ page }) => {
  await page.goto("/organizer/activate");
  await expect(page.getByRole("alert")).toContainText("invalid, expired or already used");
  await expect(page.getByLabel("Choose a password", { exact: true })).toHaveCount(0);
  await page.route("**/api/organizer/activate", (route) => route.fulfill({ status: 400, json: { error: "This setup link is invalid, expired or already used. Ask for a fresh link." } }));
  await page.goto(`/organizer/activate#token=${fixtureToken}`);
  await expect(page.getByRole("alert")).toContainText("invalid, expired or already used");
  await expect(page.getByLabel("Choose a password", { exact: true })).toHaveCount(0);
  await expectVisibleLettering(page, ".admin-recovery");
});

test("organiser activation preserves the form on a failed save", async ({ page }) => {
  await page.route("**/api/organizer/activate", (route) => {
    return route.request().postDataJSON().action === "inspect"
      ? route.fulfill({ json: { valid: true } })
      : route.fulfill({ status: 429, json: { error: "Too many attempts. Wait a minute and try again." } });
  });
  await page.goto(`/organizer/activate#token=${fixtureToken}`);
  await page.getByLabel("Choose a password", { exact: true }).fill("FreshOwnerPassword9");
  await page.getByLabel("Confirm password").fill("FreshOwnerPassword9");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByRole("alert")).toContainText("Too many attempts");
  await expect(page.getByRole("button", { name: "Set my password" })).toBeEnabled();
  await expect(page.getByLabel("Choose a password", { exact: true })).toHaveValue("FreshOwnerPassword9");
});
