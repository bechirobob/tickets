import { test, expect } from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';

test('boxed quantity preserves purchase limits, totals and tier changes', async ({ page, baseURL }) => {
  test.skip(!test.info().config.configFile?.endsWith('playwright.seev.config.ts'), 'Requires the isolated checkout fixture.');
  test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Synthetic local inventory only.');
  await page.route('**/api/config/booking-fee?*', route => route.fulfill({ json: { percentage: 5 } }));
  await page.route('**/api/payments/initialize', route => route.abort());
  await page.goto('/checkout/after-dark-osu');
  const quantity = page.getByRole('combobox', { name: 'General admission quantity' });
  await expect(quantity).toBeEnabled();
  await expect(page.locator('.checkout-step > span')).toHaveCount(0);
  if (process.env.BECORE_CHECKOUT_PREVIEW === 'ordinary') await expect(page.locator('.preview-checkout-note')).toHaveCount(0);
  else await expect(page.getByText('Test checkout', { exact: true })).toBeVisible();
  await expect(quantity).toHaveValue('1');
  await expect(quantity.locator('option')).toHaveText(['1', '2', '3', '4', '5', '6']);
  const box = (await quantity.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await quantity.focus();
  await expect(quantity).toBeFocused();
  expect(await quantity.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await quantity.selectOption('3');
  await expect(page.locator('.summary-lines')).toContainText('3 × General admission');
  await expect(page.locator('.summary-lines')).toContainText('GH₵360');
  await expect(page.locator('.summary-lines')).toContainText('GH₵18');
  await expect(page.locator('.summary-lines > strong')).toHaveText('Total GH₵378');
  await page.getByRole('radio', { name: /Table for 5/ }).click();
  const tableQuantity = page.getByRole('combobox', { name: 'Table for 5 quantity' });
  await expect(tableQuantity).toHaveValue('1');
  await expect(tableQuantity.locator('option')).toHaveText(['1', '2']);
  await tableQuantity.selectOption('2');
  await expect(page.locator('.summary-lines')).toContainText('Admissions included 10');
  await expect(page.locator('.summary-lines > strong')).toHaveText('Total GH₵1,785');
  await page.getByRole('radio', { name: /General admission/ }).click();
  await expect(quantity).toHaveValue('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await quantity.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  const accessibility = await new AxeBuilder({ page }).include('.ticket-tier-list').analyze();
  expect(accessibility.violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath('boxed-ticket-quantity.png'), fullPage: true });
});


test('checkout header keeps the logo clear and back navigation reachable', async ({ page, baseURL }) => {
  test.skip(!test.info().config.configFile?.endsWith('playwright.seev.config.ts'), 'Requires the isolated checkout fixture.');
  test.skip(!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Synthetic local inventory only.');
  await page.goto('/checkout/after-dark-osu');
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const header = page.locator('.checkout-header');
    const back = header.getByRole('link', { name: 'Back to event' });
    const home = header.getByRole('link', { name: 'BeCore Tickets' });
    await expect(back).toHaveAttribute('href', '/event/after-dark-osu');
    await expect(home).toHaveAttribute('href', '/');
    await expect(home).toBeVisible();
    const backBox = (await back.boundingBox())!;
    const logoBox = (await home.boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    expect(logoBox.height).toBeGreaterThanOrEqual(44);
    expect(backBox.x + backBox.width + 8).toBeLessThanOrEqual(logoBox.x);
    expect(Math.abs(logoBox.x + logoBox.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width < 640) {
      await expect(back).toHaveText('Back to event');
      await expect(page.locator('.checkout-back__detail')).toBeHidden();
      await expect(header.locator(':scope > span')).toBeHidden();
    } else {
      await expect(header.getByText('Good plans. Safe payment.')).toBeVisible();
    }
    await back.focus();
    await expect(back).toBeFocused();
    const accessibility = await new AxeBuilder({ page }).include('.checkout-header').analyze();
    expect(accessibility.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.checkout-header').getByRole('link', { name: 'Back to event' }).click();
  await expect(page).toHaveURL(/\/event\/after-dark-osu$/);
});
