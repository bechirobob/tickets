import { test, expect } from "@playwright/test";

const reference = "BCT-RETURN-REGRESSION";
const claim = "browser-regression-claim-with-more-than-forty-characters";
const returnPath = `/payment/return?reference=${reference}&claim=${claim}`;

test("payment return keeps its claim through pending verification and refresh", async ({ page }) => {
  let requests = 0;
  let paid = false;
  await page.route("**/api/customer/session", async (route) => {
    // The shared navigation also reads the current session. Only the return
    // page's POST carries the one-time payment claim.
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 401, json: { signedIn: false } });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({ reference, claim, resumeCheckout: false });
    requests += 1;
    await route.fulfill({ status: paid ? 200 : 202, json: paid ? { signedIn: true, eventSlug: "after-dark-osu" } : { pending: true } });
  });
  await page.route("**/my-nights/after-dark-osu?welcome=1", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Your ticket</h1>" }));
  await page.goto(returnPath);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(new RegExp(`reference=${reference}&claim=${claim}$`));
  await expect(page.getByRole("heading", { name: "A small hold-up." })).toHaveCount(0);
  await page.reload();
  await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
  paid = true;
  await expect(page.getByText("You’re in. Your ticket is ready in My Nights.")).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/my-nights\/after-dark-osu\?welcome=1$/);
  expect(page.url()).not.toContain(claim);
});

test("a return whose URL was already cleared recovers the authenticated paid order", async ({ page }) => {
  await page.route("**/api/customer/session?paymentReturn=1", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { signedIn: true, eventSlug: "after-dark-osu" } });
  });
  await page.route("**/my-nights/after-dark-osu?welcome=1", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Your ticket</h1>" }));
  await page.goto("/payment/return");
  await expect(page).toHaveURL(/\/my-nights\/after-dark-osu\?welcome=1$/);
});

test("an incomplete return without ownership never claims payment success", async ({ page }) => {
  await page.route("**/api/customer/session?paymentReturn=1", (route) => route.fulfill({ status: 401, json: { error: "Open My Nights to recover your ticket. Don’t pay again." } }));
  await page.goto("/payment/return");
  await expect(page.getByText("Open My Nights to recover your ticket. Don’t pay again.")).toBeVisible();
  await expect(page.getByText("Payment confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open My Nights" })).toBeVisible();
});
