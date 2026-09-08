import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("SeevPlus stays compact and sends the selected provider without exposing credentials", async ({ page }) => {
  test.skip(!test.info().config.configFile?.endsWith("playwright.seev.config.ts"), "Requires the isolated SeevPlus UI configuration.");
  await page.goto("/checkout/after-dark-osu");
  await page.getByRole("radio", { name: "Mobile Money", exact: false }).check();
  const chooser = page.getByRole("group", { name: "Pay through" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("radio", { name: "SeevPlus", exact: true }).check();
  await expect(page.getByRole("radiogroup", { name: "Choose mobile money service" })).toHaveCount(0);
  await expect(page.getByText("Choose your network and approve payment on SeevPlus.")).toBeVisible();
  await page.getByLabel("Full name").fill("Test Buyer");
  await page.getByLabel("Phone number").fill("0240000000");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByRole("checkbox").check();
  await page.route("**/api/payments/initialize", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ paymentProvider: "seevplus", paymentMethod: "mobile_money" });
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Test payment stopped before contacting SeevPlus." }) });
  });
  await page.getByRole("button", { name: /Pay with MoMo/ }).click();
  await expect(page.getByRole("status")).toHaveText("Test payment stopped before contacting SeevPlus.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.content()).not.toContain("ui-test-only");
  const a11y = await new AxeBuilder({ page }).include(".checkout-provider-choice").analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: `test-results/seevplus-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("radio", { name: "Card", exact: false }).first().check();
  await expect(chooser).toHaveCount(0);
  await expect(page.getByText("Paystack handles the money. We handle the night.")).toBeVisible();
});
