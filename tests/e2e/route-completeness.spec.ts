import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const [query, heading] of [
  ['', 'Stop these announcements?'],
  ['?token=isolated-read-only-audit-token', 'Stop these announcements?'],
  ['?done=1', 'You’re unsubscribed'],
]) {
  test(`announcement preferences render the ${query || 'missing-link'} state without submitting`, async ({ page }, info) => {
    let mutations = 0;
    await page.route('**/api/announcements/unsubscribe', route => { mutations++; return route.abort(); });
    await page.goto(`/announcements/unsubscribe${query}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const action = page.getByRole('button', { name: 'Unsubscribe', exact: true });
    if (query.startsWith('?token=')) {
      await expect(action).toBeVisible();
      await expect(page.locator('form')).toHaveAttribute('method', 'post');
      await expect(page.locator('form')).toHaveAttribute('action', '/api/announcements/unsubscribe');
      await expect(page.locator('input[name="token"]')).toHaveValue('isolated-read-only-audit-token');
    } else {
      await expect(action).toHaveCount(0);
      await expect(page.getByText(query ? 'No more announcement emails for this event. Your spot is still yours.' : 'Open the unsubscribe link in your announcement email.', { exact: true })).toBeVisible();
    }
    expect(mutations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('announcement-preferences.png'), fullPage: true });
  });
}

test('first-owner setup remains readable in the empty isolated database without creating an account', async ({ page }, info) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'The existing production owner must never be removed for a first-owner test.');
  let mutations = 0;
  await page.route('**/api/admin/bootstrap', route => { mutations++; return route.abort(); });
  await page.goto('/admin/bootstrap');
  await expect(page.getByRole('heading', { name: 'Create the first owner.', exact: true })).toBeVisible();
  for (const label of ['One-time setup key', 'Your name', 'Owner email', 'New owner password']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await page.getByText('Where do I get this?', { exact: true }).click();
  await expect(page.locator('.admin-bootstrap__key-help')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Create owner account', exact: true })).toBeVisible();
  expect(mutations).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('bootstrap-expanded-read-only.png'), fullPage: true });
});

for (const route of ['event', 'checkout', 'rsvp', 'my-nights', 'room', 'hosts']) {
  test(`unknown ${route} links provide readable recovery instead of an incomplete workflow`, async ({ page }, info) => {
    const response = await page.goto(`/${route}/isolated-audit-no-such-event-20261001`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'This link left early.', exact: true })).toBeVisible();
    const recovery = page.getByRole('navigation', { name: 'Find your way back' });
    await expect(recovery.getByRole('link', { name: 'Find a night' })).toHaveAttribute('href', '/events');
    await expect(recovery.getByRole('link', { name: 'My Nights' })).toHaveAttribute('href', '/my-nights');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${route}-missing.png`), fullPage: true });
  });
}
