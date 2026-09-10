import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(() => { test.skip(!test.info().config.configFile?.endsWith('playwright.registration.config.ts'), 'Requires isolated registration fixtures.'); });
test('direct registration links respect the saved mode and do not imply free admission for paid events',async({page})=>{
  await page.goto('/rsvp/the-weekend-braai');await expect(page.locator('.rsvp-signup__event .eyebrow')).toContainText('Paid registration');await expect(page.getByRole('heading',{name:'The host is putting the date together. RSVPs open soon.',exact:true})).toBeVisible();await expect(page.getByLabel('Your name')).toHaveCount(0);
  await page.goto('/rsvp/sun-chasers-labadi');await expect(page.getByLabel('Your name')).toBeVisible();await expect(page.getByText('Date drops & updates')).toBeVisible();
});
test('free RSVP preserves form details on failure and submits the selected party without checkout', async ({ page }) => {
  await page.goto('/event/after-dark-osu');
  await page.getByRole('button', { name: 'RSVP' }).click();
  await page.getByLabel('Your name').fill('Registration Guest');
  await page.getByLabel('Email address').fill('registration@example.com');
  await page.getByLabel('Guests, including you').selectOption('3');
  await page.getByRole('checkbox', { name: /I accept the event terms/ }).check();
  let attempts = 0;
  await page.route('**/api/registrations', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ eventSlug: 'after-dark-osu', partySize: 3, acceptedTerms: true });
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 202, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { error: 'Please try again.' } : { message: 'RSVP received. Outfit planning starts now.' }) });
  });
  const send = page.getByRole('button', { name: 'Send RSVP' });
  await send.click();
  await expect(page.getByRole('status')).toHaveText('Please try again.');
  await expect(page.getByLabel('Your name')).toHaveValue('Registration Guest');
  expect((await new AxeBuilder({ page }).include('.registration-form').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/rsvp-${test.info().project.name}.png`, fullPage: true });
  await send.click();
  await expect(page.getByRole('status')).toContainText('RSVP received.');
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await page.goto('/checkout/after-dark-osu');
  await expect(page).toHaveURL(/\/event\/after-dark-osu$/);
});
test('an undated event offers announcements without implying reserved admission', async ({ page }) => {
  await page.goto('/event/sun-chasers-labadi');
  await page.getByRole('button', { name: 'Keep me posted', exact: true }).click();
  await expect(page.getByText('Get the next date drop in your inbox. You’ll still need to book your spot.')).toBeVisible();
  await expect(page.getByLabel('Guests, including you')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Get tickets/ })).toHaveCount(0);
});
test('email access needs an explicit confirmation and provides a recoverable error', async ({ page }) => {
  let claims = 0;
  await page.route('**/api/registrations/claim', async route => { claims++; await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'This link has expired. Request another from the event page.' }) }); });
  await page.goto(`/rsvp/access#token=${'a'.repeat(64)}`);
  await expect(page.getByRole('button', { name: 'Confirm my email' })).toBeVisible();
  expect(claims).toBe(0);
  await expect(page).toHaveURL(/\/rsvp\/access$/);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page.getByRole('status')).toContainText('This link has expired.');
  expect(claims).toBe(1);
});
test('My Nights distinguishes waitlisted guests from confirmed passes and supports cancellation', async ({ page }) => {
  let status = 'waitlisted';
  await page.route('**/api/customer/my-nights', route => route.fulfill({ json: { attendee: { displayName: 'Ama' }, nights: [] } }));
  await page.route('**/api/customer/notifications', route => route.fulfill({ json: { notifications: [], unread: 0 } }));
  await page.route('**/api/customer/registrations', route => {
    if (route.request().method() === 'POST') { expect(route.request().postDataJSON().action).toBe('cancel'); status = 'cancelled'; return route.fulfill({ json: { registration: { status } } }); }
    return route.fulfill({ json: { registrations: [{ id: 'browser-rsvp', eventSlug: 'after-dark-osu', title: 'After Dark: Osu', kind: 'rsvp', status, partySize: 2, maxPartySize: 3, mode: 'rsvp', roomAccess: 0 }] } });
  });
  await page.goto('/my-nights');
  const section = page.locator('.my-registrations');
  await expect(section).toContainText('On the waitlist · your spot isn’t confirmed yet');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  status = 'confirmed'; await page.reload();
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveAttribute('href', '/my-nights/after-dark-osu?view=passes');
  await section.getByRole('button', { name: 'Cancel RSVP' }).click();
  await expect(section).toContainText('Cancelled');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('.my-registrations').analyze()).violations).toEqual([]);
});
