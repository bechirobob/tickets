import { test, expect } from "@playwright/test";

// Block service workers so the retirement checks control all page requests.
test.use({ serviceWorkers: "block" });

// PR production audits still serve the previous release. Candidate CI and the
// explicit post-release job enforce the retired route contract on the new build.
test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === "pull_request", "Preview retirement is verified against the candidate, then the deployed release.");

test("retired preview is a direct 404 with no demo checkout or payment traffic", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("A checkout retirement base URL is required.");
  const origin = new URL(baseURL).origin;
  const paymentRequests: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const payment = /^\/api\/payments\/(?:initialize|quote|preview)(?:\/|$)/u.test(url.pathname)
      || /paystack|seevplus/iu.test(url.hostname);
    if (payment) paymentRequests.push(request.url());
    // No provider traffic, writes, or automatic prefetches of canceled probes.
    if (payment || url.origin !== origin || !["GET", "HEAD"].includes(request.method())
      || /^\/(?:scan|my-nights)(?:\/|$)/u.test(url.pathname)) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const response = await page.goto("/checkout-preview");
  expect(response?.status()).toBe(404);
  expect(response?.request().redirectedFrom()).toBeNull();
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.getByRole("heading", { name: "This link left early." })).toBeVisible();
  await expect(page.getByText("No-charge preview", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Demo total")).toHaveCount(0);
  await expect(page.getByLabel("Full name")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Mobile Money|Cards Visa|Crypto USDC/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Preview .* checkout/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/checkout-preview$/u);
  expect(paymentRequests).toEqual([]);
  await page.screenshot({ path: `test-results/checkout-preview-retired-${test.info().project.name}.png`, fullPage: true });
});

test("obsolete preview API rejects reads and submissions without a simulated result", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("A checkout retirement base URL is required.");
  // This is the removed, previously no-charge endpoint only. Never initialize
  // a live payment or create an event while checking the deployed release.
  for (const method of ["GET", "POST"] as const) {
    const response = await request.fetch("/api/payments/preview", {
      method,
      maxRedirects: 0,
      ...(method === "POST" ? {
        headers: { origin: new URL(baseURL).origin },
        data: { paymentMethod: "crypto" },
      } : {}),
    });
    expect(response.status()).toBe(404);
    expect(response.headers()["location"]).toBeUndefined();
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    const body = await response.text();
    expect(body).not.toContain('"simulated":true');
    expect(body).not.toContain("Preview complete");
  }
});
