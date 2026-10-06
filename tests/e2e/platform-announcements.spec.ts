import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './analytics-fixture';

test.use({ serviceWorkers: 'block' });
// All customer reads, writes and verification requests are isolated fixtures.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated fixture only' } }));
  await page.route('**/api/customer/privacy', route => route.fulfill({ json: { defaultAttendeeVisible: false, allowHostUpdates: true } }));
});

test('verified email choices preserve pending consent and reject stale or unreadable saves', async ({ page }, info) => {
  let reads = 0, saves = 0;
  await page.route('**/api/customer/platform-announcements', route => {
    if (route.request().method() === 'PUT') {
      saves++;
      expect(route.request().postDataJSON()).toEqual({ platformAnnouncementsOptIn: true, revision: saves === 1 ? 1 : 2 });
      if (saves === 1) return route.fulfill({ status: 409, json: { error: 'Your choice changed in another session.' } });
      if (saves === 2) return route.fulfill({ json: {} });
      return route.fulfill({ json: { saved: true, platformAnnouncementsOptIn: true, status: 'subscribed', revision: 3, emailVerified: true } });
    }
    reads++;
    return route.fulfill({ json: reads === 1
      ? { platformAnnouncementsOptIn: true, status: 'pending', revision: 1, emailVerified: true }
      : { platformAnnouncementsOptIn: false, status: 'unsubscribed', revision: 2, emailVerified: true } });
  });
  await page.goto('/account/privacy');
  const settings = page.getByRole('region', { name: 'New nights by email' });
  const choice = settings.getByRole('checkbox', { name: /Keep me posted on new nights from BeCore Tickets/ });
  await expect(choice).toBeChecked();
  await expect(settings.getByText('Your earlier choice is waiting for confirmation.')).toBeVisible();
  expect(saves).toBe(0);
  await settings.getByRole('button', { name: 'Confirm email updates' }).click();
  await expect(settings.getByRole('status')).toContainText('Your choice changed in another session.');
  await expect(choice).toBeChecked();
  await expect(settings.getByText('Email choice saved.', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Reload email choice' }).click();
  await expect(choice).not.toBeChecked();
  await choice.check();
  await settings.getByRole('button', { name: 'Save email choice' }).click();
  await expect(settings.getByRole('status')).toContainText('Reload your choice before trying again.');
  await expect(settings.getByText('Email choice saved.', { exact: true })).toHaveCount(0);
  await expect(choice).toBeChecked();
  await settings.getByRole('button', { name: 'Save email choice' }).click();
  await expect(settings.getByRole('status')).toHaveText('Email choice saved.');
  expect(saves).toBe(3);
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="platform-announcements-title"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await settings.screenshot({ path: info.outputPath('verified-email-choice.png') });
});

test('unverified email choices require explicit recovery without sending automatically', async ({ page }, info) => {
  let recoveries = 0, saves = 0;
  await page.route('**/api/customer/platform-announcements', route => {
    if (route.request().method() === 'PUT') saves++;
    return route.fulfill({ json: { platformAnnouncementsOptIn: false, status: 'verification_required', revision: 0, emailVerified: false } });
  });
  await page.route('**/api/customer/recovery', route => {
    recoveries++;
    expect(route.request().postDataJSON()).toEqual({ email: 'unverified@example.com', confirmPlatformAnnouncements: true });
    return route.fulfill({ json: { message: 'Check your inbox.' } });
  });
  await page.goto('/account/privacy');
  const settings = page.getByRole('region', { name: 'New nights by email' });
  const choice = settings.getByRole('checkbox', { name: /Keep me posted on new nights from BeCore Tickets/ });
  await expect(choice).toBeDisabled();
  await expect(choice).not.toBeChecked();
  await expect(settings.getByRole('button', { name: 'Save email choice' })).toHaveCount(0);
  expect(recoveries).toBe(0);
  await settings.getByLabel('Booking or RSVP email').fill('unverified@example.com');
  await settings.getByRole('button', { name: 'Verify email' }).click();
  await expect(settings.getByRole('status')).toContainText('If you previously chose BeCore email updates, confirming that link also confirms them.');
  await expect(settings.getByRole('button', { name: 'Check your email' })).toBeDisabled();
  expect(recoveries).toBe(1);
  expect(saves).toBe(0);
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="platform-announcements-title"]').analyze()).violations).toEqual([]);
  await settings.screenshot({ path: info.outputPath('unverified-email-choice.png') });
});

test('unreadable email preferences can be reloaded without implying a saved choice', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/customer/platform-announcements', route => route.fulfill({ json: ++reads === 1 ? {} : { platformAnnouncementsOptIn: false, status: 'not_subscribed', revision: 0, emailVerified: true } }));
  await page.goto('/account/privacy');
  const settings = page.getByRole('region', { name: 'New nights by email' });
  await expect(settings.getByRole('checkbox')).toHaveCount(0);
  await expect(settings.getByRole('status')).toBeVisible();
  await settings.getByRole('button', { name: 'Reload email choice' }).click();
  await expect(settings.getByRole('checkbox')).not.toBeChecked();
  await expect(settings.getByRole('status')).toHaveCount(0);
});

test('platform unsubscribe requires a deliberate confirmation and preserves booking context', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/platform-announcements/unsubscribe', route => {
    writes++;
    expect(route.request().method()).toBe('POST');
    expect(new URLSearchParams(route.request().postData() ?? '').get('token')).toBe('isolated-preference-token');
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Isolated unsubscribe accepted.' });
  });
  await page.goto('/platform-announcements/unsubscribe');
  await expect(page.getByRole('button', { name: 'Unsubscribe', exact: true })).toHaveCount(0);
  await page.goto('/platform-announcements/unsubscribe?token=isolated-preference-token');
  await expect(page.getByRole('heading', { name: 'Stop BeCore announcements?' })).toBeVisible();
  await expect(page.getByText('Your tickets and RSVPs stay valid.')).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
});

for (const flow of [
  { grantType: 'registration', path: '/rsvp/access', api: '/api/registrations/claim', boundAction: 'Confirm email and updates', ordinaryAction: 'Confirm my email' },
  { grantType: 'recovery', path: '/my-nights/access', api: '/api/customer/recovery/claim', boundAction: 'Confirm email and open My Nights', ordinaryAction: 'Open my tickets' },
]) {
  test(`${flow.grantType} access confirms the bound choice in one deliberate action and fails closed on inspection`, async ({ page }) => {
    const token = 'S'.repeat(43);
    let inspection = 'bound', claims = 0, inspections = 0;
    await page.route('**/api/platform-announcements/verification', route => {
      inspections++;
      expect(route.request().postDataJSON()).toEqual({ token, grantType: flow.grantType });
      return route.fulfill({ status: inspection === 'failed' ? 503 : 200, json: inspection === 'failed'
        ? { error: 'Inspection unavailable.' }
        : { confirmsAnnouncements: inspection === 'malformed' ? 'true' : inspection === 'bound' } });
    });
    await page.route(`**${flow.api}`, route => {
      claims++;
      expect(route.request().postDataJSON()).toEqual({ token, confirmPlatformAnnouncements: inspection === 'bound' });
      return route.fulfill({ status: 503, json: { error: 'Isolated claim stopped before changing any preference.' } });
    });
    for (const [index, state] of ['bound', 'unbound', 'failed', 'malformed'].entries()) {
      inspection = state;
      const before = claims;
      // Each mocked state is a fresh emailed-link document. A fragment-only
      // navigation reuses the prior mounted screen and never re-inspects.
      await page.goto(`${flow.path}?scenario=${state}#token=${token}`);
      await expect.poll(() => inspections).toBe(index + 1);
      const action = page.getByRole('button', { name: state === 'bound' ? flow.boundAction : flow.ordinaryAction, exact: true });
      await expect(action).toBeVisible();
      await expect(page.getByRole('main').getByRole('button')).toHaveCount(1);
      await expect(page.getByRole('main').getByRole('checkbox')).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe('');
      expect(claims).toBe(before);
      const disclosure = page.getByText('This also confirms the BeCore Tickets email updates you chose. Unsubscribe any time.');
      if (state === 'bound') await expect(disclosure).toBeVisible();
      else await expect(disclosure).toHaveCount(0);
      await action.click();
      await expect(page.getByText('Isolated claim stopped before changing any preference.')).toBeVisible();
      expect(claims).toBe(before + 1);
    }
  });
}
