import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { renderCustomerEmailPreviews } from '../../scripts/customer-email-previews.mjs';
import { expectVisibleLettering } from '../e2e/text-visibility';

const names = ['purchase-confirmation', 'rsvp-confirmed', 'email-verification', 'ticket-recovery', 'ticket-transfer', 'waitlist-offer', 'abandoned-checkout', 'support-update'];
let previews: Awaited<ReturnType<typeof renderCustomerEmailPreviews>>;

test.beforeAll(async () => { previews = await renderCustomerEmailPreviews(); });

async function expectReadableEmail(page: Page) {
  await expectVisibleLettering(page, 'body');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const lowContrast = await page.evaluate(() => {
    const issues: string[] = [];
    const rgb = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element || element.closest('script,style')) continue;
      let background = [255, 255, 255], visible = true, foundBackground = false;
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') visible = false;
        const color = rgb(style.backgroundColor);
        if (!foundBackground && color.length >= 3 && (color.length < 4 || color[3] === 1)) { background = color; foundBackground = true; }
      }
      if (!visible) continue;
      const foreground = luminance(rgb(getComputedStyle(element).color));
      const behind = luminance(background);
      const contrast = (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
      if (contrast < 4.5) issues.push(`${contrast.toFixed(2)}: ${text.slice(0, 100)}`);
    }
    return issues;
  });
  expect(lowContrast, 'All visible customer email text should meet normal-text AA contrast.').toEqual([]);
}

for (const name of names) {
  test(`customer email ${name} is readable in light and dark hosts`, async ({ page }, info) => {
    const preview = previews.find(item => item.name === name)!;
    const unexpectedRequests: string[] = [];
    const logo = await readFile(new URL('../../public/brand/becore-ticket.png', import.meta.url));
    // Keep the exact production HTML. Fulfil its existing hosted PNG locally;
    // every other request is blocked, including any accidental provider call.
    await page.route('**/*', route => {
      if (route.request().url() === 'https://tickets.becoreops.com/brand/becore-ticket.png?v=5') return route.fulfill({ body: logo, contentType: 'image/png' });
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    let lightDigest: string | undefined;
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setContent(preview.html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const action = page.getByRole('link', { name: preview.actionLabel, exact: true });
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute('href', /^https:\/\/tickets\.example\.invalid\//);
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await expectReadableEmail(page);
      const pixels = await page.screenshot({ fullPage: true, ...(colorScheme === 'light' ? { path: info.outputPath(`${name}.png`) } : {}) });
      const digest = createHash('sha256').update(pixels).digest('hex');
      if (colorScheme === 'light') lightDigest = digest;
      else expect(digest, 'The complete email must preserve its explicit colors in a dark host.').toBe(lightDigest);
    }
    expect(unexpectedRequests).toEqual([]);
    await writeFile(info.outputPath(`${name}.html`), preview.html);
  });
}

test('long customer and event fields wrap without hiding the primary action', async ({ page }) => {
  const longValue = `AccraAfterHours${'VeryLongUnbrokenReference'.repeat(8)}`;
  const [preview] = await renderCustomerEmailPreviews({ event: { title: longValue, venue: longValue }, order: { customerName: longValue, reference: longValue } });
  await page.route('**/*', route => route.abort());
  await page.setContent(preview.html);
  await expectReadableEmail(page);
  await expect(page.getByRole('link', { name: 'Open My Nights', exact: true })).toBeVisible();
});
