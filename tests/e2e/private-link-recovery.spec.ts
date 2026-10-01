import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
// A PR's live audit still targets the previous release; candidate CI runs these
// regressions locally, and the post-deploy audit verifies the released behavior.
test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Private-link retries are verified against the candidate, then the deployed release.');
const token = 'T'.repeat(43);
const inspections = [
  { path: '/admin/recover', api: '/api/admin/recovery', ready: 'Save new password', payload: { valid: true, requiresEmail: true } },
  { path: '/organizer/activate', api: '/api/organizer/activate', ready: 'Set my password', payload: { valid: true } },
  { path: '/organizer/join/confirm', api: '/api/host-applications/confirm', ready: 'Confirm my email', payload: { application: { brandName: 'Isolated Host', contactName: 'Host Fixture', socialUrl: 'https://example.com' } } },
  { path: '/organizer/team/accept', api: '/api/organizer/team/accept', ready: 'Accept invitation', payload: { email: 'door@example.com', role: 'gate', eventTitle: 'Isolated event', eventSlug: 'isolated-event', needsPassword: false } },
];

for (const fixture of inspections) {
  test(`${fixture.path} retries a temporary inspection failure without reopening or exposing the private link`, async ({ page }, info) => {
    let attempts = 0;
    let finish!: () => void;
    const responseReady = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated fixture only' } }));
    await page.route(`**${fixture.api}`, async route => {
      expect(route.request().postDataJSON()).toEqual({ action: 'inspect', token });
      if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'This link could not be checked. Please retry.' } });
      await responseReady;
      return route.fulfill({ json: fixture.payload });
    });
    try {
      await page.goto(`${fixture.path}#token=${token}&email=owner%40example.com`);
      await expect(page.getByRole('alert')).toContainText('could not be checked');
      expect(new URL(page.url()).hash).toBe('');
      const retry = page.getByRole('button', { name: 'Try checking again', exact: true });
      await expect(retry).toBeVisible();
      expect(attempts).toBe(1);
      await retry.press('Enter');
      await expect(page.getByRole('status')).toContainText(/Checking/);
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect.poll(() => attempts).toBe(2);
      finish();
      await expect(page.getByRole('button', { name: fixture.ready, exact: true })).toBeVisible();
      if (fixture.path === '/admin/recover') await expect(page.getByLabel('Work email')).toHaveValue('owner@example.com');
      expect(attempts).toBe(2);
      expect(await page.evaluate(secret => Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => value.includes(secret)), token)).toBe(false);
      expect(await page.locator('body').innerText()).not.toContain(token);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`${fixture.path.replaceAll('/', '-')}-recovered.png`), fullPage: true });
    } finally { finish(); }
  });

  test(`${fixture.path} does not offer inspection retry for a definitively invalid link`, async ({ page }) => {
    await page.route(`**${fixture.api}`, route => route.fulfill({ status: 400, json: { error: 'This link has expired or has already been used.' } }));
    await page.goto(`${fixture.path}#token=${token}`);
    await expect(page.getByRole('alert')).toContainText('expired');
    await expect(page.getByRole('button', { name: 'Try checking again', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: fixture.ready, exact: true })).toHaveCount(0);
  });
}

test('privacy settings show retry loading, preserve a failed save and confirm only the successful save', async ({ page }, info) => {
  let reads = 0, saves = 0;
  let finish!: () => void;
  const responseReady = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Isolated fixture only' } }));
  await page.route('**/api/customer/privacy', async route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toEqual({ defaultAttendeeVisible: true, allowHostUpdates: false });
      saves++;
      if (saves === 1) return route.fulfill({ status: 503, json: { error: 'Your privacy choices could not be saved. Try again.' } });
      return route.fulfill({ json: saves === 2 ? {} : { saved: true } });
    }
    if (++reads === 1) return route.fulfill({ status: 503, json: { error: 'Choices unavailable. Try again.' } });
    await responseReady;
    return route.fulfill({ json: { defaultAttendeeVisible: false, allowHostUpdates: true } });
  });
  try {
    await page.goto('/account/privacy');
    await expect(page.getByRole('alert')).toContainText('Choices unavailable');
    await page.getByRole('button', { name: 'Retry loading choices' }).click();
    await expect(page.getByRole('status')).toContainText('Loading privacy choices');
    await expect(page.getByRole('button', { name: 'Retry loading choices' })).toHaveCount(0);
    await expect.poll(() => reads).toBe(2);
    finish();
    await page.getByRole('checkbox', { name: /Show me as going by default/ }).check();
    await page.getByRole('checkbox', { name: /Allow followed Host updates/ }).uncheck();
    await page.getByRole('button', { name: 'Save privacy choices' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be saved');
    await expect(page.getByRole('checkbox', { name: /Show me as going by default/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Allow followed Host updates/ })).not.toBeChecked();
    await expect(page.getByText('Privacy choices saved.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save privacy choices' }).click();
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm your saved choices');
    await expect(page.getByText('Privacy choices saved.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save privacy choices' }).click();
    await expect(page.getByRole('status')).toHaveText('Privacy choices saved.');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(saves).toBe(3);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('privacy-recovery.png'), fullPage: true });
  } finally { finish(); }
});

test('promoter refresh is bounded and distinguishes stale report data from a completed refresh', async ({ page }, info) => {
  let attempts = 0;
  let finish!: () => void;
  const responseReady = new Promise<void>(resolve => { finish = resolve; });
  const report = { label: 'Isolated promoter', eventTitle: 'Isolated event', eventSlug: 'isolated-event', code: 'FIXTURE', orders: 12, earnedMinor: 6000, paidMinor: 2000, balanceMinor: 4000, commissionBps: 500, payments: [] };
  await page.route('**/api/promoter', async route => {
    expect(route.request().postDataJSON()).toEqual({ token });
    attempts++;
    if (attempts === 2) { await responseReady; return route.fulfill({ status: 503, json: { error: 'The report could not be refreshed.' } }); }
    return route.fulfill({ json: { ...report, orders: attempts === 3 ? 13 : 12 } });
  });
  try {
    await page.goto(`/promoter#token=${token}`);
    await expect(page.getByRole('heading', { name: 'Isolated event' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    const refresh = page.getByRole('button', { name: 'Refresh report', exact: true });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('Refreshing your report');
    await expect(page.locator('.suite-section')).toHaveAttribute('aria-busy', 'true');
    finish();
    await expect(page.getByRole('alert')).toContainText('Showing the last loaded report.');
    await expect(refresh).toBeEnabled();
    await expect(page.locator('.suite-stats article').filter({ hasText: 'Orders' }).locator('b')).toHaveText('12');
    await refresh.click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.suite-stats article').filter({ hasText: 'Orders' }).locator('b')).toHaveText('13');
    await expect(page.locator('.suite-section')).toHaveAttribute('aria-busy', 'false');
    expect(attempts).toBe(3);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('promoter-recovered.png'), fullPage: true });
  } finally { finish(); }
});


test('a stalled promoter inspection times out and can reuse the in-memory link', async ({ page }) => {
  await page.clock.install();
  let attempts = 0;
  let finish!: () => void;
  const stalled = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/promoter', async route => {
    expect(route.request().postDataJSON()).toEqual({ token });
    if (++attempts === 1) { await stalled; await route.abort().catch(() => {}); return; }
    await route.fulfill({ json: { label: 'Isolated promoter', eventTitle: 'Recovered event', eventSlug: 'isolated-event', code: 'FIXTURE', orders: 0, earnedMinor: 0, paidMinor: 0, balanceMinor: 0, commissionBps: 500, payments: [] } });
  });
  try {
    await page.goto(`/promoter#token=${token}`);
    await expect.poll(() => attempts).toBe(1);
    await page.clock.fastForward(16_000);
    await expect(page.getByRole('alert')).toContainText('taking too long');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recovered event' })).toBeVisible();
    expect(attempts).toBe(2);
  } finally { finish(); }
});


test('registration confirmation rejects unreadable success and preserves its private link for recovery', async ({ page }, info) => {
  let attempts = 0;
  await page.route('**/api/registrations/claim', route => {
    expect(route.request().postDataJSON()).toEqual({ token });
    return route.fulfill({ json: ++attempts === 1 ? {} : { registration: { status: 'confirmed', eventSlug: 'isolated-event', partySize: 2 } } });
  });
  await page.goto(`/rsvp/access#token=${token}`);
  const confirm = page.getByRole('button', { name: 'Confirm my email', exact: true });
  await expect(confirm).toBeEnabled();
  expect(attempts).toBe(0);
  expect(new URL(page.url()).hash).toBe('');
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('Open My Nights to check');
  await expect(page.getByRole('heading', { name: 'Your RSVP is confirmed' })).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Your RSVP is confirmed' })).toBeVisible();
  await expect(page.getByText('You have 2 places reserved. Show your QR pass at entry.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show my QR passes' })).toHaveAttribute('href', '/my-nights/isolated-event?view=passes');
  expect(attempts).toBe(2);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('registration-confirmation-recovered.png'), fullPage: true });
});

for (const [status, heading] of [['requested', 'Your request is with the host'], ['waitlisted', 'You’re on the waitlist'], ['interested', 'You’re on the email list']]) {
  test(`registration confirmation ${status} does not promise a confirmed pass`, async ({ page }) => {
    await page.route('**/api/registrations/claim', route => route.fulfill({ json: { registration: { status, eventSlug: 'isolated-event', partySize: 1 } } }));
    await page.goto(`/rsvp/access#token=${token}`);
    await page.getByRole('button', { name: 'Confirm my email', exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  });
}


for (const fixture of inspections.filter(item => item.path === '/organizer/join/confirm' || item.path === '/organizer/team/accept')) {
  test(`${fixture.path} does not claim completion from a malformed success response`, async ({ page }) => {
    let mutations = 0;
    await page.route(`**${fixture.api}`, route => {
      const body = route.request().postDataJSON();
      if (body.action === 'inspect') return route.fulfill({ json: fixture.payload });
      mutations++;
      return route.fulfill({ json: mutations === 1 ? {} : fixture.path.endsWith('/accept') ? { accepted: true } : { confirmed: true } });
    });
    await page.goto(`${fixture.path}#token=${token}`);
    const submit = page.getByRole('button', { name: fixture.ready, exact: true });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm');
    await expect(submit).toBeEnabled();
    await expect(page.getByRole('status')).toHaveCount(0);
    await submit.click();
    await expect(page.getByRole('status')).toBeVisible();
    expect(mutations).toBe(2);
  });
}
