import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Route stubs must own requests; WebKit service workers can bypass page routing.
test.use({ serviceWorkers: "block" });

// PR production audits still serve the previous release; candidate CI tests this route.
test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === "pull_request", "Preview is verified against the candidate, then the deployed release.");

test("no-charge preview shows every method and submits only a simulated method", async ({ page }) => {
  // This walkthrough is temporary; API/unit tests exercise expiry independently.
  test.skip(Date.now() >= Date.parse("2026-10-07T23:59:59Z"), "The temporary checkout preview has expired.");
  const forbidden: string[] = [];
  const previewBodies: unknown[] = [];
  const externalRequests: string[] = [];
  // Exercise the real analytics boundary instead of the general webdriver skip.
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  page.on("request", request => {
    const url = new URL(request.url());
    if (/\/(?:api\/payments\/(?:initialize|quote)|api\/config\/booking-fee|api\/analytics)(?:[/?]|$)/u.test(url.pathname)) forbidden.push(request.url());
    if (/paystack|seevplus/iu.test(url.hostname)) externalRequests.push(request.url());
    if (url.pathname === "/api/payments/preview") previewBodies.push(request.postDataJSON());
  });
  // Abort forbidden traffic too, so a regression cannot contact a provider.
  await page.route(/\/api\/(?:payments\/(?:initialize|quote)|config\/booking-fee|analytics)(?:[/?]|$)/u, route => route.abort());
  await page.route(/^https:\/\/[^/]*(?:paystack|seevplus)[^/]*\//iu, route => route.abort());
  const response = await page.goto("/checkout-preview");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("No-charge preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On The Guest List", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to event" })).toHaveAttribute("href", "/event/sun-chasers-labadi");
  const poster = page.getByRole("img", { name: "On The Guest List event poster" });
  await expect(poster).toBeVisible();
  // Safari loads this below-the-fold poster only once it approaches the viewport.
  await poster.scrollIntoViewIfNeeded();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Demo total")).toContainText("GH₵100");
  await expect(page.getByText("Booking fee (0%)")).toContainText("GH₵0");
  await expect(page.getByLabel("Full name")).toHaveValue("Preview Guest");
  await expect(page.getByLabel("Full name")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Email address")).toHaveValue("guest@example.invalid");
  await expect(page.getByLabel("Discount code")).toHaveCount(0);
  await page.getByRole("radio", { name: /Mobile Money/ }).check();
  const networks = page.getByRole("list", { name: "Available mobile money networks" });
  for (const label of ["MTN MoMo", "Telecel Cash", "AT Money"]) await expect(networks).toContainText(label);
  await page.getByRole("radio", { name: "Paystack", exact: true }).check();
  for (const label of ["MTN MoMo", "Telecel Cash", "AT Money"]) await expect(page.getByRole("radio", { name: new RegExp(label) }).last()).toBeVisible();
  await page.getByRole("radio", { name: /Telecel Cash Your phone/ }).check();
  const continueButton = page.getByRole("button", { name: /Preview MoMo checkout/ });
  await continueButton.click();
  await expect(page.locator("#checkout-payment-message")).toContainText("Confirm this is a no-charge preview");
  expect(previewBodies).toEqual([]);
  await page.getByRole("checkbox", { name: /I understand this is a no-charge preview/ }).check();
  await continueButton.click();
  await expect(page.locator("#checkout-payment-message")).toContainText("Preview complete");
  await expect(page.locator("#checkout-payment-message")).toContainText("No phone prompt was sent");
  await page.getByRole("radio", { name: /Cards Visa/ }).check();
  await expect(page.getByRole("img", { name: "Accepted cards: Visa and Mastercard" })).toBeVisible();
  await page.getByRole("button", { name: /Preview card checkout/ }).click();
  await expect(page.locator("#checkout-payment-message")).toContainText("No card details were requested");
  await page.getByRole("radio", { name: /Crypto USDC/ }).check();
  await expect(page.getByText(/Use only the asset and network shown there/)).toBeVisible();
  await page.getByRole("button", { name: /Preview USDC checkout/ }).click();
  await expect(page.locator("#checkout-payment-message")).toContainText("No wallet was connected");
  await page.getByRole("button", { name: /Preview USDC checkout/ }).click();
  await expect(page.locator("#checkout-payment-message")).toContainText("Preview complete");
  expect(previewBodies).toEqual([{ paymentMethod: "mobile_money" }, { paymentMethod: "card" }, { paymentMethod: "crypto" }, { paymentMethod: "crypto" }]);
  expect(forbidden).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("bct:payment-attempt:")))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page }).include(".checkout-preview").analyze()).violations).toEqual([]);
  await expect(page).toHaveURL(/\/checkout-preview$/);
  await page.screenshot({ path: `test-results/checkout-preview-${test.info().project.name}.png`, fullPage: true });
});

test("no-charge preview recovers from failure without sending buyer details or duplicate clicks", async ({ page }) => {
  test.skip(Date.now() >= Date.parse("2026-10-07T23:59:59Z"), "The temporary checkout preview has expired.");
  const bodies: unknown[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/payments/preview", async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await pending;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Preview temporarily unavailable. Try again." }) });
    } else await route.continue();
  });
  await page.goto("/checkout-preview");
  await page.getByRole("radio", { name: /Crypto USDC/ }).check();
  await page.getByRole("checkbox", { name: /I understand this is a no-charge preview/ }).check();
  await page.getByRole("button", { name: /Preview USDC checkout/ }).click();
  await expect(page.getByRole("button", { name: "Preparing preview…" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Cards Visa/ })).toBeDisabled();
  expect(bodies).toEqual([{ paymentMethod: "crypto" }]);
  release();
  await expect(page.locator("#checkout-payment-message")).toHaveText("Preview temporarily unavailable. Try again.");
  await page.getByRole("button", { name: /Preview USDC checkout/ }).click();
  await expect(page.locator("#checkout-payment-message")).toContainText("Preview complete");
  expect(bodies).toEqual([{ paymentMethod: "crypto" }, { paymentMethod: "crypto" }]);
});
