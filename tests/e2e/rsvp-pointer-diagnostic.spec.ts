import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './analytics-fixture';

async function recordGeometry(page: Page) {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    Object.assign(window, { rsvpPointerGeometry: log });
    for (const type of ['pointerdown', 'mousedown', 'focusin', 'pointerup', 'mouseup', 'click', 'toggle', 'scroll']) {
      document.addEventListener(type, event => {
        if (log.length >= 500) return;
        const summary = document.querySelector('.registration-manage summary');
        const box = summary?.getBoundingClientRect();
        const target = event.target instanceof Element ? event.target : null;
        const pointer = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : null;
        log.push({ type, time: performance.now(), scrollX, scrollY, pointer,
          target: target ? { tag: target.tagName, class: target.getAttribute('class') } : null,
          summary: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
          open: document.querySelector('.registration-manage')?.hasAttribute('open'),
          arrivalHidden: document.querySelector('[data-testid="brand-arrival"]')?.hasAttribute('hidden'),
          focused: document.activeElement?.tagName });
      }, true);
    }
  });
}

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  // Final safety net: no unexpected write, including a non-API endpoint, leaves this page.
  // Later page API routes take precedence and fulfill the synthetic cancellation.
  await page.route("**/*", route => ['GET', 'HEAD'].includes(route.request().method()) ? route.fallback() : route.abort('blockedbyclient'));
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "Isolated member fixture" } }));
  await page.route("**/api/customer/notifications", route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route("**/api/customer/registrations", route => route.fulfill({ json: { registrations: [] } }));
});

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const geometry = await page.evaluate(() =>
    (window as Window & { rsvpPointerGeometry?: unknown[] }).rsvpPointerGeometry ?? []);
  await info.attach('rsvp-pointer-geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
});

for (const variant of ['baseline', 'intro-settled', 'settled-focus'] as const) {
test(`registration-only cancellation pointer diagnostic: ${variant}`, async ({ page }, info) => {
  let status = "confirmed";
  let cancellations = 0;
  await page.route("**/api/customer/registrations", route => {
    if (route.request().method() === "POST") { cancellations++; status = "cancelled"; return route.fulfill({ json: { registration: { status } } }); }
    return route.fulfill({ json: { registrations: [{ id: "rsvp", eventSlug: "the-weekend-braai", title: "The Weekend Braai", kind: "rsvp", status, partySize: 2, maxPartySize: 3, mode: "rsvp", roomAccess: 0 }] } });
  });
  await recordGeometry(page);
  await page.goto("/my-nights");
  await expect(page.getByRole("link", { name: "Show my QR passes" })).toBeVisible();
  await expect(page.getByLabel("Booking or registration email")).toHaveCount(0);
  if (variant !== 'baseline') await expect(page.getByTestId('brand-arrival')).toBeHidden();
  const summary = page.locator('.registration-manage summary');
  if (variant === 'settled-focus') {
    await summary.focus();
    let previous = '', stable = 0;
    await expect.poll(async () => {
      const position = await summary.evaluate(element => {
        const box = element.getBoundingClientRect();
        return JSON.stringify([scrollX, scrollY, box.x, box.y, box.width, box.height]);
      });
      stable = position === previous ? stable + 1 : 0;
      previous = position;
      return stable;
    }).toBeGreaterThanOrEqual(2);
  }
  await summary.click();
  if (variant !== 'baseline') await expect(page.locator('.registration-manage')).toHaveAttribute('open', '');
  await page.getByRole("button", { name: "Cancel RSVP", exact: true }).click();
  expect(cancellations).toBe(0);
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  expect(cancellations).toBe(0);
  await page.getByRole("button", { name: "Cancel RSVP", exact: true }).click();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("my-nights-rsvp.png"), fullPage: true });
  await page.getByRole("button", { name: "Yes, cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(cancellations).toBe(1);

});
}
