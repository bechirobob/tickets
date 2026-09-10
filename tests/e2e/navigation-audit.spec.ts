import { expect, test } from "@playwright/test";
import { expectVisibleLettering } from "./text-visibility";
test.use({ serviceWorkers: "block" });

test("navigation exposes each destination once per menu and stays keyboard reachable", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { error: "Sign in" } }));
  for (const path of ["/", "/events", "/my-nights", "/notifications", "/account/privacy", "/organizer/submit"]) {
    await page.goto(path);
    const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Close navigation" })).toBeFocused();
    const destinations = await menu.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(new Set(destinations).size).toBe(destinations.length);
    if (path === "/" && page.viewportSize()!.width > 700) {
      const header = page.locator(".night-header");
      for (const name of ["The Drop", "Hosts", "My Nights"]) await expect(header.getByRole("link", { name, exact: true })).toHaveCount(1);
    }
    if (page.viewportSize()!.width <= 700 && path !== "/organizer/submit") {
      for (const name of ["Home", "The Drop", "My Nights"]) await expect(menu.getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    await expectVisibleLettering(page, ".night-mobile-menu__panel");
    if (path === "/my-nights") await page.screenshot({ path: testInfo.outputPath("streamlined-navigation.png") });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
  }
});

test('navigation waits for its handlers before accepting the first keypress', async ({ page }) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route('**/_next/static/*.js', async route => { await scriptsReady; await route.continue(); });
  try {
    await page.goto('/account/privacy', { waitUntil: 'commit' });
    const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeDisabled();
    releaseScripts();
    await expect(trigger).toBeEnabled({ timeout: 15000 });
    await trigger.press('Enter');
    const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  } finally { releaseScripts(); }
});
