import { test, expect } from './analytics-fixture';
import AxeBuilder from '@axe-core/playwright';
import { captureConsentPreview } from './booking-consent';
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
  const updates = page.getByRole('checkbox', { name: 'Keep me posted on new nights from BeCore Tickets.' });
  await expect(page.locator('.registration-form').getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Email me updates from this event and host.' })).toHaveCount(0);
  await expect(updates).not.toBeChecked();
  await expect(updates).not.toHaveAttribute('required', '');
  await expect(page.getByRole('checkbox', { name: /I accept the event terms/ })).not.toBeChecked();
  expect((await updates.locator('..').boundingBox())!.height).toBeLessThanOrEqual(60);
  if (test.info().project.use.isMobile) await expect(page.getByRole('navigation', { name: 'Customer navigation' })).toBeVisible();
  await captureConsentPreview(page, '.registration-confirmation', test.info().outputPath('rsvp-consent-default.png'));
  await page.getByRole('button', { name: 'Send RSVP' }).click({ trial: true });
  await updates.check();
  await page.getByRole('checkbox', { name: /I accept the event terms/ }).check();
  let attempts = 0;
  await page.route('**/api/registrations', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ eventSlug: 'after-dark-osu', partySize: 3, acceptedTerms: true, announcementsOptIn: false, platformAnnouncementsOptIn: true });
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 503 : 202, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { error: 'Please try again.' } : { message: 'RSVP received. Outfit planning starts now.' }) });
  });
  const send = page.getByRole('button', { name: 'Send RSVP' });
  await send.click();
  await expect(page.getByRole('status')).toHaveText('Please try again.');
  await expect(page.getByLabel('Your name')).toHaveValue('Registration Guest');
  await expect(updates).toBeChecked();
  expect((await new AxeBuilder({ page }).include('.registration-form').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/rsvp-${test.info().project.name}.png`, fullPage: true });
  await send.click();
  await expect(page.getByRole('status')).toContainText('RSVP received.');
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await page.goto('/checkout/after-dark-osu');
  await expect(page).toHaveURL(/\/event\/after-dark-osu$/);
});
test('an undated event keeps optional email consent event-scoped without implying reserved admission', async ({ page }) => {
  await page.goto('/event/sun-chasers-labadi');
  await page.getByRole('button', { name: 'Keep me posted', exact: true }).click();
  await expect(page.getByText('Get the next date drop in your inbox. You’ll still need to book your spot.')).toBeVisible();
  await expect(page.getByLabel('Guests, including you')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Get tickets/ })).toHaveCount(0);
  const updates = page.getByRole('checkbox', { name: 'Email me updates from this event and host.' });
  await expect(page.locator('.registration-form').getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Keep me posted on new nights from BeCore Tickets.' })).toHaveCount(0);
  await expect(updates).not.toBeChecked();
  await expect(updates).not.toHaveAttribute('required', '');
  let attempts = 0;
  await page.route('**/api/registrations', route => {
    expect(route.request().postDataJSON()).toMatchObject({ eventSlug: 'sun-chasers-labadi', announcementsOptIn: attempts++ > 0, platformAnnouncementsOptIn: false });
    return route.fulfill({ status: 503, json: { error: 'Test registration stopped before sending email.' } });
  });
  await page.getByLabel('Your name').fill('Interest Guest');
  await page.getByLabel('Email address').fill('interest@example.com');
  await page.getByRole('checkbox', { name: /I accept the event terms/ }).check();
  await page.getByRole('button', { name: 'Send my confirmation link' }).click();
  await expect(page.getByRole('status')).toHaveText('Test registration stopped before sending email.');
  expect(attempts).toBe(1);
  await updates.check();
  await page.getByRole('button', { name: 'Send my confirmation link' }).click();
  await expect.poll(() => attempts).toBe(2);
});

test('RSVP can be submitted without opting into platform announcements', async ({ page }) => {
  let submissions = 0;
  await page.route('**/api/registrations', route => {
    submissions++;
    expect(route.request().postDataJSON()).toMatchObject({ acceptedTerms: true, announcementsOptIn: false, platformAnnouncementsOptIn: false });
    return route.fulfill({ status: 202, json: { message: 'RSVP received.' } });
  });
  await page.goto('/rsvp/after-dark-osu');
  await page.getByLabel('Your name').fill('No Emails Guest');
  await page.getByLabel('Email address').fill('no-emails@example.com');
  await page.getByRole('checkbox', { name: /I accept the event terms/ }).check();
  await page.getByRole('button', { name: 'Send RSVP' }).click();
  await expect(page.getByRole('status')).toContainText('RSVP received.');
  expect(submissions).toBe(1);
});
test('email access needs an explicit confirmation and provides a recoverable error', async ({ page }) => {
  let claims = 0;
  await page.route('**/api/platform-announcements/verification', route => route.fulfill({ json: { confirmsAnnouncements: false } }));
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
  await page.goto('/my-nights?view=rsvps');
  const section = page.locator('.my-registrations');
  await expect(section).toContainText('On the waitlist · your spot isn’t confirmed yet');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  status = 'confirmed'; await page.reload();
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveAttribute('href', '/my-nights/after-dark-osu?view=passes');
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Cancel RSVP' }).click();
  await section.getByRole('button', { name: 'Yes, cancel' }).click();
  await expect(section).toContainText('Cancelled');
  await expect(section.getByRole('link', { name: 'Show my QR passes' })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('.my-registrations').analyze()).violations).toEqual([]);
});
