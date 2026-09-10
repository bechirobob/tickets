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
  ['/admin/registrations','RSVP & guests'], ['/admin/orders','Orders & payments'], ['/admin/support','Ticket support'], ['/admin/promoters','Promoter links'],
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
  await page.goto('/admin/events?event=after-dark-osu');
  const title = page.getByLabel('Title', { exact: true }); await expect(title).toBeVisible();
  const original = await title.inputValue(); await title.fill(`${original} revised`);
  await page.getByText('Ticket prices & capacity',{exact:true}).click();
  for(const label of ['Price (GH₵)','Admissions / unit','Admission capacity','Max units / order']) {
    const field=page.getByLabel(label,{exact:label!=='Admission capacity'}).first();const value=await field.inputValue();await field.fill('');await expect(field).toHaveValue('');
    await page.getByRole('button',{name:'Save event & inventory',exact:true}).click();await expect(page.getByRole('status')).toContainText('Fill in each ticket price');
    await field.fill(value);
  }
  await page.getByLabel('Price (GH₵)',{exact:true}).first().fill('12.50');
  await page.route('**/api/admin/events', route => {if(route.request().method()==='PATCH'){expect(route.request().postDataJSON().tiers[0].priceMinor).toBe(1250);return route.abort('failed');}return route.continue();});
  const save = page.getByRole('button', { name: 'Save event & inventory', exact: true }); await save.click();
  await expect(page.getByRole('status')).toContainText('Connection lost'); await expect(save).toBeEnabled();
  await expect(title).toHaveValue(`${original} revised`);
});
test('guest tools wait for initial settings before accepting a tab change', async ({ page }) => {
  let release: (() => Promise<void>) | undefined;
  await page.route('**/api/admin/registrations?**', route => {
    if (new URL(route.request().url()).searchParams.has('live')) return route.continue();
    release = () => route.continue();
  });
  await page.goto('/admin/registrations?event=rsvp-browser');
  const manager = page.locator('.registration-manager');
  const announcements = manager.getByRole('button', { name: 'Announcements', exact: true });
  await expect(announcements).toBeDisabled();
  await expect.poll(() => Boolean(release)).toBe(true);
  await release!();
  await expect(announcements).toBeEnabled();
  await announcements.click();
  await expect(announcements).toHaveAttribute('aria-pressed', 'true');
  await expect(manager.getByLabel('Subject', { exact: true })).toBeVisible();
});
test('RSVP save and copy retains the draft after a failed save', async ({ page }) => {
  await page.goto('/admin/registrations?event=rsvp-browser');
  const manager = page.locator('.registration-manager');
  await expect(manager.getByLabel('RSVP link', { exact: true })).toHaveValue(/\/rsvp\/rsvp-browser$/);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => { throw new Error('A failed save must not copy'); } } }));
  await manager.getByLabel('Guest capacity', { exact: true }).fill('77');
  await page.route('**/api/admin/registrations', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  const copy = manager.getByRole('button', { name: 'Save & copy link' });
  await copy.click();
  await expect(manager.locator('.ops-message')).toContainText('Connection lost');
  await expect(copy).toBeEnabled();
  await expect(manager.getByLabel('Guest capacity', { exact: true })).toHaveValue('77');
  await expect(manager.getByText('Your link is selected. Copy it to share.')).toHaveCount(0);
  await expect(manager.getByText('Link copied. Ready to share.')).toHaveCount(0);
});
test('save and copy starts clipboard access on the tap and supplies only the saved link', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    write: async (items: ClipboardItem[]) => {
      document.documentElement.dataset.clipboardStarted = 'true';
      document.documentElement.dataset.copiedRegistration = await (await items[0].getType('text/plain')).text();
    }
  } }));
  await page.goto('/admin/registrations?event=rsvp-browser');
  const manager = page.locator('.registration-manager');
  await manager.getByLabel('Guest capacity', { exact: true }).fill('26');
  await page.route('**/api/admin/registrations', async route => {
    if (route.request().method() === 'POST') expect(await page.locator('html').getAttribute('data-clipboard-started')).toBe('true');
    await route.continue();
  });
  await manager.getByRole('button', { name: 'Save & copy link' }).click();
  await expect(manager.getByText('Link copied. Ready to share.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-copied-registration', 'https://127.0.0.1:8791/rsvp/rsvp-browser');
});
test('Operations keeps checks, incidents and approvals in focused views', async ({ page }, info) => {
  await page.goto('/admin/operations');
  await expect(page.getByRole('heading', { name: 'Next actions' })).toBeVisible();
  await expect(page.getByText('Doors & devices', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Event readiness', exact: true }).click();
  await expect(page.getByText('Doors & devices', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next actions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Issues', exact: true }).click();
  await expect(page.getByText('Incidents', { exact: true })).toBeVisible();
  await expect(page.getByText('Doors & devices', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  await expect(page.getByText('High-risk approvals', { exact: true })).toBeVisible();
  await expect(page.getByText('Incidents', { exact: true })).not.toBeVisible();
  await page.screenshot({path:info.outputPath('operations-approvals.png'),fullPage:true});
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

test.describe.serial('organiser RSVP and guest journey',()=>{
 // These steps share one booking and a single-use email grant; replay requires fresh fixtures.
 test.describe.configure({retries:0});
 test.beforeEach(async({context,baseURL})=>{await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);});
 test('organiser chooses free or paid entry and previews a direct registration link',async({page},info)=>{
  await page.goto('/organizer/workspace?event=rsvp-browser');
  const manager=page.locator('.registration-manager');await expect(manager).toBeVisible();
  await expect(manager.getByText('Live · refreshes every 5 seconds')).toBeVisible();
  await manager.getByLabel('Guest capacity',{exact:true}).fill('');
  await expect(manager.getByLabel('Guest capacity',{exact:true})).toHaveValue('');
  await manager.getByRole('button',{name:'Save registration settings'}).click();
  await expect(manager.locator('.ops-message')).toContainText('Enter a guest capacity');
  await expect(manager.getByRole('button',{name:'Save & copy link'})).toBeEnabled();
  await manager.getByLabel('Guest capacity',{exact:true}).pressSequentially('25');
  await manager.getByRole('button',{name:/Paid registration Tickets at checkout/}).click();
  const price=manager.getByLabel('Base registration price (GHS)');await price.fill('');await expect(price).toHaveValue('');
  await price.pressSequentially('75.50');await expect(price).toHaveValue('75.50');
  await expect(manager.getByRole('button',{name:'Save & copy link'})).toBeEnabled();
  await price.fill('75');
  await manager.getByRole('button',{name:'Save registration settings'}).click();
  await expect(manager.locator('.ops-message')).toContainText('Registration settings saved');
  await manager.getByRole('button',{name:/RSVP No ticket payment/}).click();
  await manager.getByLabel('Review requests before confirming guests').check();
  await manager.getByRole('button',{name:'Midnight before the event'}).click();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
  await manager.getByRole('button',{name:'Save & copy link'}).click();
  await expect(manager.locator('.ops-message')).toContainText('Registration settings saved');
  await expect(manager.getByRole('link',{name:'Preview guest page'})).toHaveAttribute('href','/rsvp/rsvp-browser');
  const axe=await new AxeBuilder({page}).include('.registration-manager').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await page.screenshot({path:info.outputPath('organiser-rsvp.png'),fullPage:true});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
  await manager.getByRole('button',{name:'Copy RSVP link',exact:true}).click();
  const shared=await manager.getByLabel('RSVP link',{exact:true}).inputValue();
  expect(shared).toBe('https://127.0.0.1:8791/rsvp/rsvp-browser');
  await page.context().clearCookies();await page.goto(shared);
  await expect(page.getByLabel('Your name')).toBeVisible();await expect(page.locator('main')).not.toContainText(/free|no payment/i);
  const flier=page.getByRole('img',{name:'Event flier for RSVP browser gathering'});await expect(flier).toBeVisible();await expect(flier).toHaveCSS('object-fit','contain');
  await expect.poll(()=>flier.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(page.getByLabel('Email me updates from this host')).not.toBeChecked();
  const guestAxe=await new AxeBuilder({page}).include('.registration-form').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(guestAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:info.outputPath('guest-rsvp-form.png'),fullPage:true});
  await page.getByLabel('Your name').fill('Shared Link Guest');await page.getByLabel('Email address').fill('shared-link@example.com');
  await page.getByRole('checkbox',{name:/I accept the event terms/}).check();
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Send RSVP'}).click();expect((await submitted).status()).toBe(202);
  await expect(page.getByRole('status')).toContainText('RSVP received.');
  await expect(page.getByRole('status')).toContainText('Now we wait for the host’s nod.');
  await expect(page.getByRole('button',{name:/confirmation link/i})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('guest-rsvp-success.png'),fullPage:true});
  await page.goto('/event/rsvp-browser?register=1#register');await expect(page).toHaveURL(/\/rsvp\/rsvp-browser(?:#register)?$/);await expect(page.getByLabel('Your name')).toBeVisible();
 });
 test('verified signup appears without refreshing the organiser dashboard and joins guest emails',async({page})=>{
  await page.goto('/organizer/workspace?event=rsvp-browser');const manager=page.locator('.registration-manager');
  await expect(manager.getByText('Live · refreshes every 5 seconds')).toBeVisible();
  await expect(manager.getByLabel('Live registrations')).toContainText('1');
  await manager.getByRole('button',{name:/^Guest list/}).click();
  await expect(manager.getByText('shared-link@example.com',{exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'Setup',exact:true}).click();
  await manager.getByLabel('Guest capacity',{exact:true}).fill('31');
  const response=await page.request.post('/api/registrations/claim',{data:{token:fixture.registrationToken},headers:{origin:'https://127.0.0.1:8791'}});expect(response.ok(),await response.text()).toBe(true);
  await expect(manager.getByText('Guest activity updated.')).toBeVisible({timeout:12000});
  await expect(manager.getByLabel('Guest capacity',{exact:true})).toHaveValue('31');
  await manager.getByText('Recent signups & changes',{exact:true}).click();await expect(manager.getByLabel('Live registrations').getByText('Live RSVP Guest',{exact:true})).toBeVisible();
  await manager.getByRole('button',{name:/^Guest list/}).click();
  const request=manager.locator('.registration-roster article').filter({hasText:'shared-link@example.com'});
  await request.getByRole('button',{name:'Approve',exact:true}).click();await expect(request).toContainText('Confirmed');
  await manager.getByRole('button',{name:'Guest emails',exact:true}).click();
  await expect(manager.getByText('rsvp-browser@example.com',{exact:true})).toBeVisible();
  const csv=await page.request.get('/api/admin/audience?eventSlug=rsvp-browser&export=csv');expect(await csv.text()).toContain('rsvp-browser@example.com');
 });
 test('announcement preview preserves a failed send and owner sees organiser actions',async({page,context,baseURL},info)=>{
  await page.route('**/api/admin/audience?**',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,emailConfigured:true}});});
  await page.goto('/organizer/workspace?event=rsvp-browser');const manager=page.locator('.registration-manager');
  const announcements=manager.getByRole('button',{name:'Announcements',exact:true});await announcements.click();await expect(announcements).toHaveAttribute('aria-pressed','true');
  await manager.getByLabel('Subject',{exact:true}).fill('Doors open at eight');await manager.getByLabel('Announcement',{exact:true}).fill('Please bring your QR pass. See you at the event.');
  await manager.getByRole('button',{name:'Preview announcement'}).click();await expect(manager.locator('.announcement-preview')).toContainText('1 subscribed guest emails');
  await page.route('**/api/admin/audience',route=>route.abort('failed'));await manager.getByRole('button',{name:'Send announcement'}).click();
  await expect(manager.getByRole('button',{name:'Send announcement'})).toBeEnabled();await expect(manager.getByLabel('Subject',{exact:true})).toHaveValue('Doors open at eight');
  const axe=await new AxeBuilder({page}).include('.registration-manager').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:info.outputPath('announcement-preview.png'),fullPage:true});
  await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.token,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);await page.goto('/admin/operations');
  await page.locator('.organizer-activity summary').click();await expect(page.locator('.organizer-activity')).toContainText('rsvp-host@example.com');await expect(page.locator('.organizer-activity')).toContainText('GHS 75.00');
 });
});
