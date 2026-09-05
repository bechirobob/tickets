import { expect, test } from "@playwright/test";

// A controlling service worker can bypass Playwright routes in WebKit.
// These request-failure tests must always use their mocks, never a live write.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("a failed recovery preserves the email and allows a successful retry", async ({ page }) => {
  await page.route("**/api/customer/my-nights", (route) => route.fulfill({ status: 401, json: { error: "Sign in" } }));
  let attempts = 0;
  await page.route("**/api/customer/recovery", async (route) => {
    attempts += 1;
    expect(route.request().postDataJSON()).toEqual({ email: "recovery@example.com" });
    await route.fulfill(attempts === 1
      ? { status: 503, json: { error: "Email recovery is temporarily unavailable. Please try again." } }
      : { status: 202, json: { message: "If that email has tickets, a link is on its way." } });
  });
  await page.goto("/my-nights");
  const email = page.getByLabel("Email used at checkout");
  await email.fill("recovery@example.com");
  const submit = page.getByRole("button", { name: "Bring back my Nights" });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  expect(attempts).toBe(1);
  await expect(email).toHaveValue("recovery@example.com");
  await expect(submit).toBeEnabled();
  await expect(page.getByText("Check your email", { exact: true })).toHaveCount(0);
  await submit.click();
  await expect(page.getByRole("button", { name: "Check your email" })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("sharing has a usable manual fallback when browser capabilities fail", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Unavailable", "NotAllowedError"); } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Unavailable", "NotAllowedError"); } } });
  });
  await page.goto("/event/after-dark-osu");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  await expect(page.getByRole("status")).toContainText("Select the link below");
  const link = page.getByLabel("Event link", { exact: true });
  await expect(link).toHaveValue(/\/event\/after-dark-osu$/u);
  await link.focus();
  const selection = await link.evaluate((element: HTMLInputElement) => ({ start: element.selectionStart, end: element.selectionEnd, length: element.value.length }));
  expect(selection).toEqual({ start: 0, end: selection.length, length: selection.length });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await link.press("Escape");
  await expect(page.locator(".event-share__feedback")).toHaveCount(0);
  await expect(share).toBeFocused();
});

test("a cancelled native share stays quiet and clipboard success is accurately labelled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => { throw new DOMException("Cancelled", "AbortError"); } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });
  });
  await page.goto("/event/after-dark-osu");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.click();
  await expect(share).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".event-share__feedback")).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined }));
  await share.click();
  await expect(page.getByRole("status")).toHaveText("Link copied. Send it to the usual suspects.");
  await expect(page.getByLabel("Event link", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(share).toBeFocused();
});

test("filtering keeps search focus and reduced motion leaves posters still", async ({ page }) => {
  await page.goto("/events");
  const search = page.getByRole("searchbox", { name: "Search events, artists or venues" });
  const firstCard = page.locator(".drop-card").first();
  const title = await firstCard.locator("h3").innerText();
  const quip = await firstCard.locator(".drop-card__quip").innerText();
  await search.fill(title);
  await expect(search).toBeFocused();
  await expect(page.locator(".drop-card")).toHaveCount(1);
  await expect(page.locator(".drop-card__quip")).toHaveText(quip);
  await expect(page.locator(".discovery-grid")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".poster-link")).toHaveCSS("transform", "none");
  await search.fill("No matching night 987654");
  await expect(page.getByRole("heading", { name: "Even Accra has a quiet corner." })).toBeVisible();
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator(".drop-card").first()).toBeVisible();
});
