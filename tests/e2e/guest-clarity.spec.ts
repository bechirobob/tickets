import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './catalogue';

// Every simulated mutation is intercepted; these journeys never send guest data.
test.use({ serviceWorkers: 'block' });

test('recovery help opens the relevant guide directly, including from My Nights', async ({ page }) => {
  await page.route('**/api/customer/my-nights', route => route.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.route('**/api/customer/registrations', route => route.fulfill({ status: 401, json: { error: 'Sign in' } }));
  await page.goto('/my-nights');
  await page.getByRole('link', { name: 'No link, wrong email or locked out?' }).click();
  await expect(page).toHaveURL(/\/help#recover-access$/);
  const guide = page.locator('#recover-access');
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide).toContainText('Never send passwords, access links or QR screenshots');
  await expect(guide.getByRole('link', { name: 'Try My Nights again' })).toHaveAttribute('href', '/my-nights');
  expect((await new AxeBuilder({ page }).include('#recover-access').analyze()).violations).toEqual([]);
});

test('Room help distinguishes confirmed RSVP access from a request', async ({ page }) => {
  await page.goto('/help#room-private');
  const guide = page.locator('#room-private');
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide).toContainText('your place must be confirmed and the host must have included Room access');
  await expect(guide).toContainText('pending request or waitlist place does not unlock it');
});

test('registration drafts survive close and back without carrying consent or submitting', async ({ page, catalogue }) => {
  const screen = catalogue.screens?.find(screen => screen.registration?.open && screen.registration.mode !== 'paid');
  test.skip(!screen, 'No published registration form is open in this fixture');
  let submissions = 0;
  await page.route('**/api/registrations', route => {
    submissions++;
    return route.fulfill({ status: 202, json: { message: 'Received', canManage: false } });
  });
  await page.goto(`/event/${screen!.event.slug}`);
  const open = page.getByRole('button', { name: /^(Keep me posted|Request an RSVP|RSVP)$/ });
  await open.click();
  await page.getByLabel('Your name', { exact: true }).fill('Draft Guest');
  await page.getByLabel('Email address', { exact: true }).fill('draft@example.com');
  const emailChoice = page.locator('.registration-consent input[type=checkbox]:not([name=acceptedTerms])');
  await expect(emailChoice).not.toBeChecked();
  await emailChoice.check();
  await page.getByRole('checkbox', { name: /I accept the event terms/ }).check();
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.getByLabel('Your name', { exact: true })).toHaveValue('Draft Guest');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('draft@example.com');
  await expect(page.getByRole('checkbox', { name: /I accept the event terms/ })).not.toBeChecked();
  await expect(emailChoice).not.toBeChecked();
  await page.locator('.sub-header .back-link').click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goBack();
  // Routers may restore the open screen or remount its collapsed view.
  if (!(await page.getByLabel('Email address', { exact: true }).isVisible())) await open.click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('draft@example.com');
  await expect(emailChoice).not.toBeChecked();
  expect(submissions).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('registration-draft.png'), fullPage: true });
});

test('the existing approved special guest is readable on details and direct RSVP', async ({ page, catalogue }) => {
  test.skip(!catalogue.screens?.some(screen => screen.event.slug === 'sun-chasers-labadi' && screen.event.image === '/events/on-the-guest-list.webp'), 'The approved Guest List artwork is not published in this fixture');
  await page.goto('/event/sun-chasers-labadi');
  await expect(page.locator('.event-practical-details')).toContainText('Special Guest DJ');
  await expect(page.locator('.event-practical-details')).toContainText('Cuppy');
  await page.goto('/rsvp/sun-chasers-labadi');
  await expect(page.locator('.rsvp-signup__event')).toContainText('Special Guest DJ · Cuppy');
  await expect(page.locator('.rsvp-signup__facts')).toContainText('Coming soon');
  await expect(page.locator('.rsvp-signup__facts')).not.toContainText('2PM');
});
