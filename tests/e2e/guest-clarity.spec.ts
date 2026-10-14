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

test('the confirmed Pink Edition keeps its host and removes performer details', async ({ page, catalogue }) => {
  const guestList=catalogue.screens?.find(screen => screen.event.slug === 'sun-chasers-labadi');
  expect(guestList?.event.image).toBe('/events/on-the-guest-list-20261025.webp');
  await page.goto('/event/sun-chasers-labadi');
  await expect(page.locator('.event-host')).toContainText('Kofi Bills');
  await expect(page.locator('.event-story-intro')).toContainText('Club House Inc');
  await expect(page.locator('.event-credits section')).toHaveCount(0);
  await expect(page.getByText('Cuppy', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Special Guest DJ', {exact:true})).toHaveCount(0);
  await page.goto('/rsvp/sun-chasers-labadi');
  await expect(page.locator('.rsvp-signup__facts')).toContainText(guestList!.event.fullDate);
  await expect(page.getByText('Special Guest DJ · Cuppy')).toHaveCount(0);
});

async function holdRegistrationScripts(page: import('@playwright/test').Page) {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_next/static/**/*.js', async route => {
    await ready;
    await route.continue();
  });
  return { release, async dispose() { release(); await page.unroute('**/_next/static/**/*.js'); } };
}

for (const activation of ['pointer', 'keyboard'] as const) test(`registration waits for hydration before ${activation} activation and repeated opening`, async ({ page, catalogue }) => {
  const screen = catalogue.screens?.find(screen => screen.registration?.open && screen.registration.mode !== 'paid');
  test.skip(!screen, 'No published registration form is open in this fixture');
  let submissions = 0;
  await page.route('**/api/registrations', route => {
    submissions++;
    return route.fulfill({ status: 202, json: { message: 'Readiness fixture', canManage: false } });
  });
  const scripts = await holdRegistrationScripts(page);
  try {
    await page.goto(`/event/${screen!.event.slug}`, { waitUntil: 'commit' });
    const open = page.getByRole('button', { name: /^(Keep me posted|Request an RSVP|RSVP)$/ });
    await expect(open).toBeVisible();
    await expect(open).toBeDisabled();
    await expect(open).toHaveAttribute('aria-busy', 'true');
    await open.scrollIntoViewIfNeeded();
    const box = (await open.boundingBox())!;
    // A real early pointer activation cannot advertise success or open an inert form.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel('Your name', { exact: true })).toHaveCount(0);
    expect(submissions).toBe(0);
    scripts.release();
    await expect(open).toBeEnabled();
    await expect(open).toHaveAttribute('aria-busy', 'false');
    if (activation === 'keyboard') { await open.focus(); await open.press('Enter'); }
    else await open.dblclick();
    await expect(page.locator('.registration-form form')).toHaveCount(1);
    await expect(page.getByLabel('Your name', { exact: true })).toBeEditable();
    await expect(page.getByRole('checkbox', { name: /I accept the event terms/ })).not.toBeChecked();
    await expect(page.locator('.registration-consent input[type=checkbox]:not([name=acceptedTerms])')).not.toBeChecked();
    const close = page.getByRole('button', { name: 'Close form', exact: true });
    if (activation === 'keyboard') await close.press('Enter'); else await close.click();
    await expect(open).toBeFocused();
    if (activation === 'keyboard') await open.press('Space'); else await open.click();
    await expect(page.locator('.registration-form form')).toHaveCount(1);
    await expect(page.getByLabel('Your name', { exact: true })).toBeEditable();
    expect(submissions).toBe(0);
  } finally { await scripts.dispose(); }
});

test('direct RSVP fields and consent wait for hydration without submitting', async ({ page, catalogue }) => {
  const screen = catalogue.screens?.find(screen => screen.registration?.open && screen.registration.mode !== 'paid');
  test.skip(!screen, 'No published registration form is open in this fixture');
  let submissions = 0;
  await page.route('**/api/registrations', route => {
    submissions++;
    return route.fulfill({ status: 202, json: { message: 'Readiness fixture', canManage: false } });
  });
  const scripts = await holdRegistrationScripts(page);
  try {
    await page.goto(`/rsvp/${screen!.event.slug}`, { waitUntil: 'commit' });
    const name = page.getByLabel('Your name', { exact: true });
    const email = page.getByLabel('Email address', { exact: true });
    const consent = page.getByRole('checkbox', { name: /I accept the event terms/ });
    const submit = page.locator('.registration-form button[type=submit]');
    await expect(name).toBeVisible();
    for (const control of [name, email, consent, submit]) await expect(control).toBeDisabled();
    await expect(consent).not.toBeChecked();
    expect(submissions).toBe(0);
    scripts.release();
    for (const control of [name, email, consent, submit]) await expect(control).toBeEnabled();
    await expect(consent).not.toBeChecked();
    await expect(page.locator('.registration-consent input[type=checkbox]:not([name=acceptedTerms])')).not.toBeChecked();
    await name.fill('Readiness Guest');
    await email.fill('readiness@example.com');
    await expect(name).toHaveValue('Readiness Guest');
    await expect(email).toHaveValue('readiness@example.com');
    expect(submissions).toBe(0);
  } finally { await scripts.dispose(); }
});
