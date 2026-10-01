import { expect, test } from './catalogue';

test('shared payment footer names USDC without an upcoming label', async ({ page }, info) => {
  await page.goto('/');
  const payments = page.getByRole('region', { name: 'Payments', exact: true });
  await expect(payments.locator('.payment-footer__crypto')).toHaveText('CryptoUSDC through SeevPlus');
  await expect(payments).not.toContainText('Coming soon');
  await expect(payments.getByRole('img', { name: 'Seev', exact: true })).toBeVisible();
  await expect(payments.getByRole('img', { name: 'Paystack', exact: true })).toBeVisible();
  await expect(page.locator('.backstage-bridge')).toContainText('MoMo, cards, USDC and ticket tiers');
  await payments.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('payment-labels.png') });
});

test('payment help explains USDC using the provider-specific checkout labels', async ({ page }) => {
  await page.goto('/help#payment-methods');
  const guide = page.locator('#payment-methods');
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide.locator('summary')).toContainText('Pay with Mobile Money, cards or USDC');
  await expect(guide).toContainText('Crypto for USDC through SeevPlus');
  await expect(guide).toContainText('only the asset and network shown');
  await expect(guide).toContainText('once payment is confirmed');
});

test('payment copy leaves pending event dates unchanged', async ({ page, catalogue }) => {
  const pending = catalogue.events.find(event => event.scheduleStatus === 'coming_soon');
  test.skip(!pending, 'No coming-soon event in this catalogue');
  await page.goto(`/event/${pending!.slug}`);
  await expect(page.locator('.event-coming-soon')).toContainText(pending!.fullDate);
  await expect(page.locator('.event-coming-soon')).toContainText('The exact date is still under wraps.');
});
