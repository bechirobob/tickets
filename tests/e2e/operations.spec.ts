import { readFileSync, existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
const isolated = existsSync('.wrangler/operations-fixture.json');
const fixture = isolated ? JSON.parse(readFileSync('.wrangler/operations-fixture.json', 'utf8')) : null;
test.skip(!isolated, 'Run the isolated Operations fixture and config.');
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!baseURL?.endsWith(':8791'), 'Isolated local Operations server only.');
  await context.addCookies([{ name: 'bct_staff', value: fixture.token, url: baseURL!, httpOnly: true, sameSite: 'Strict' }]);
});
for (const [path, heading] of [
  ['/admin','Submission queue'], ['/admin/operations','Event operations'], ['/admin/events','Events & inventory'],
  ['/admin/orders','Orders & payments'], ['/admin/support','Ticket support'], ['/admin/promoters','Promoter links'],
  ['/admin/rooms','The Room'], ['/admin/fees','Fees & charges'], ['/admin/accounts','People & permissions'], ['/admin/account','My account'],
]) {
  test(`owner can open ${path} with readable controls`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const apiErrors: string[] = [];
    page.on('response', response => { if (response.url().includes('/api/') && response.status() >= 500) apiErrors.push(`${response.status()}: ${response.url()}`); });
    const response = await page.goto(path);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator('h1')).toBeVisible();
    await expect(page).not.toHaveURL(/\/admin\/login/);
    if (path !== '/admin/account') await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    // Wait for server-backed screen data before examining layout and accessibility.
    await expect(page.getByText(/Loading (real inventory|accounts|operations|events|submissions)/i)).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(axe.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), heading).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow, `${path} document overflow`).toBe(false);
    expect(errors).toEqual([]); expect(apiErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${path.replaceAll('/','-') || 'admin'}.png`), fullPage: true });
  });
}
test('event save survives a dropped connection and retains the draft', async ({ page }) => {
  await page.goto('/admin/events');
  await page.locator('.ops-directory__row').first().click();
  const title = page.getByLabel('Title', { exact: true }); await expect(title).toBeVisible();
  const original = await title.inputValue(); await title.fill(`${original} revised`);
  await page.route('**/api/admin/events', route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
  const save = page.getByRole('button', { name: 'Save event & inventory', exact: true }); await save.click();
  await expect(page.getByRole('status')).toContainText('Connection lost'); await expect(save).toBeEnabled();
  await expect(title).toHaveValue(`${original} revised`);
});
test('RSVP orders do not offer payment verification', async ({ page }) => {
  await page.goto('/admin/orders');
  const row = page.getByRole('row').filter({ hasText: 'BCT-AUDIT-RSVP' });
  await expect(row).toContainText('Free RSVP'); await expect(row.getByTitle('Verify payment')).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Manage RSVP' })).toBeVisible();
});
test('support reply and room memory retain content after failed writes', async ({ page }) => {
  await page.goto('/admin/support');
  await page.getByRole('button', { name: /Need help with my RSVP/ }).click();
  await page.getByLabel('Reply to customer').fill('Please check My Nights for the guest pass.');
  await page.route('**/api/admin/support', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeEnabled();
  await expect(page.getByLabel('Reply to customer')).toHaveValue('Please check My Nights for the guest pass.');
  await page.goto('/admin/rooms');
  await expect(page.locator('#room-event')).not.toHaveValue('');
  await page.getByLabel('Title', { exact: true }).fill('A night to remember'); await page.getByLabel('Note', { exact: true }).fill('Thank you for joining us.');
  await page.route('**/api/admin/rooms', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: 'Publish memory' }).click();
  await expect(page.getByRole('button', { name: 'Publish memory' })).toBeEnabled();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('A night to remember');
});
test('owner signs in through the real password flow and signs out', async ({ page, context }) => {
  await context.clearCookies(); await page.goto('/admin/login?returnTo=%2Fadmin%2Foperations');
  await page.getByLabel('Work email').fill(fixture.email); await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Enter secure workspace' }).click(); await expect(page).toHaveURL(/\/admin\/operations$/);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL('https://127.0.0.1:8791/');
  await page.goto('/admin/accounts'); await expect(page).toHaveURL(/\/admin\/login/);
});

test('review decisions clear the active list and event removal clears inventory', async ({ page }, info) => {
  await page.goto('/admin');
  await expect(page.locator('.curation-detail')).toHaveCount(0);
  const submission = page.locator('.ops-directory__row').filter({hasText:'Queue audit submission'});
  await submission.click();
  await page.getByLabel('Private / organiser note').fill('This proposal does not meet the event requirements.');
  await page.getByRole('button',{name:'Reject',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Submission rejected');
  await expect(submission).toHaveCount(0);
  await page.getByRole('button',{name:/^Rejected /}).click();
  await expect(submission).toBeVisible();
  await submission.click();
  await page.getByRole('button',{name:'Archive submission'}).click();
  await expect(submission).toHaveCount(0);
  await page.goto('/admin/events');
  await expect(page.getByLabel('Title',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/^Previews/}).click();
  const preview = page.locator('.ops-directory__row').filter({hasText:'Obsolete audit preview'});
  await preview.click();
  const detailAxe = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(detailAxe.violations.map(item => ({id:item.id,nodes:item.nodes.map(node=>node.target)}))).toEqual([]);
  await page.getByRole('button',{name:'Remove event',exact:true}).click();
  await page.getByLabel('Reason',{exact:true}).fill('Remove this obsolete local preview');
  await page.getByRole('button',{name:'Confirm removal',exact:true}).click();
  await expect(page.getByLabel('Title',{exact:true})).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await page.screenshot({path:info.outputPath('compact-inventory.png'),fullPage:true});
});
test('finance separates orders from reports and filters free registrations', async ({ page }) => {
  await page.goto('/admin/orders');
  await expect(page.getByRole('heading',{name:'Open disputes'})).not.toBeVisible();
  await page.getByRole('button',{name:'Disputes',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Open disputes'})).toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
  await page.getByRole('button',{name:'Orders',exact:true}).click();
  await page.getByText('Filter by event or payment method',{exact:true}).click();
  await page.getByLabel('Payment method',{exact:true}).selectOption('rsvp');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByRole('row').filter({hasText:'BCT-AUDIT-RSVP'})).toBeVisible();
});
