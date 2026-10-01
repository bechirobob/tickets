import { readFileSync, existsSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expectVisibleLettering } from './text-visibility';
import { expect, test, type Page } from '@playwright/test';
async function openWorkspaceMenu(page: Page) {
 const toggle=page.getByRole('button',{name:'Toggle workspace navigation',exact:true});
 if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
}
async function hostArea(page: Page,name: string) {
 await openWorkspaceMenu(page);
 await page.getByRole('navigation',{name:'Organiser workspace'}).getByRole('link',{name,exact:true}).click();
}
const isolated = existsSync('.wrangler/operations-fixture.json');
const fixture = isolated ? JSON.parse(readFileSync('.wrangler/operations-fixture.json', 'utf8')) : null;
test.skip(!isolated, 'Run the isolated Operations fixture and config.');
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(!baseURL?.endsWith(':8791'), 'Isolated local Operations server only.');
  await context.addCookies([{ name: 'bct_staff', value: fixture.token, url: baseURL!, httpOnly: true, sameSite: 'Strict' }]);
});
test('owner approval email links open the exact form and preserve the sign-in destination', async ({ page, context }) => {
  await page.goto('/admin?submission=operations-review');
  await expect(page.getByRole('heading', { name: 'Queue audit submission', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to submissions' })).toBeVisible();
  await page.goto('/admin/hosts?application=host-onboarding-fixture');
  await expect(page.locator('.host-applications details[open]')).toContainText('Host onboarding fixture');
  await expect(page.getByRole('button', { name: 'Approve host', exact: true })).toBeVisible();
  await context.clearCookies();
  for (const path of ['/admin?submission=operations-review', '/admin/hosts?application=host-onboarding-fixture']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);
  }
});
for (const [path, heading] of [
  ['/admin','Submission queue'], ['/admin/operations','Event operations'], ['/admin/events','Events & inventory'],
  ['/admin/registrations','RSVP & guests'], ['/admin/orders','Orders & payments'], ['/admin/support','Ticket support'], ['/admin/promoters','Promoter links'],
  ['/admin/rooms','The Room'], ['/admin/fees','Fees & charges'], ['/admin/accounts','People & permissions'], ['/admin/account','My account'], ['/admin/help','Help centre'], ['/admin/hosts','Host applications'],
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
    if((page.viewportSize()?.width??1280)<=760){const gap=await page.evaluate(()=>{const nav=document.querySelector('.workspace-topbar')!.getBoundingClientRect();const content=document.querySelector('.ops-main,.curation-main,.room-ops > section,.host-applications')!.getBoundingClientRect();return content.top-nav.bottom;});expect(gap,`${path} space below mobile navigation`).toBeLessThan(40);}

    // Expand content before opening the mobile navigation overlay; do not click
    // through an open menu. Both expanded content and navigation retain coverage.
    for(const summary of await page.locator('details:not([open]):not(.workspace-tools) > summary').all()){if(await summary.isVisible())await summary.click();}
    const expandedContentAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(expandedContentAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    await openWorkspaceMenu(page);
    for(const summary of await page.locator('.workspace-sidebar details:not([open]) > summary').all()){if(await summary.isVisible())await summary.click();}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    const expandedAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(expandedAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
    // Inspect the final cascade: generic Operations controls previously restored
    // rounded bottom borders even when the shared tab stylesheet removed them.
    const decoratedTabs = await page.locator('.ops-tabs > button, .suite-event-nav > button, .host-applications nav > button').evaluateAll(buttons => buttons.flatMap(button => {
      const style = getComputedStyle(button);
      return style.borderBottomWidth !== '0px' || style.borderBottomLeftRadius !== '0px' || style.boxShadow !== 'none'
        ? [{ text: button.textContent, border: style.borderBottomWidth, radius: style.borderBottomLeftRadius, shadow: style.boxShadow }] : [];
    }));
    expect(decoratedTabs, `${path} tabs must not have curved underlines or shadows`).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${path.replaceAll('/','-') || 'admin'}.png`), fullPage: true, scale: 'css' });
  });
}
test('mobile workspace navigation closes when keyboard focus leaves and restores focus on Escape', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) > 760, 'The persistent desktop sidebar does not overlay content.');
  await page.goto('/admin/help');
  const toggle = page.getByRole('button', { name: 'Toggle workspace navigation', exact: true });
  const close = page.getByRole('button', { name: 'Close workspace navigation', exact: true });
  await toggle.focus(); await toggle.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/admin\/help$/);
  await toggle.focus(); await toggle.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});
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
test('guest tabs stay under the pointer when live activity arrives', async ({ page }) => {
  let releaseActivity!: () => void;
  const activityReady = new Promise<void>(resolve => { releaseActivity = resolve; });
  await page.route('**/api/admin/registrations?**', async route => {
    if (new URL(route.request().url()).searchParams.has('live')) await activityReady;
    await route.continue();
  });
  try {
    await page.goto('/organizer/workspace?area=events&event=rsvp-browser&view=guests');await page.getByRole('button',{name:'RSVP review & setup',exact:true}).click();
    const manager = page.locator('.registration-manager');
    const announcements = manager.getByRole('button', { name: 'Guest emails', exact: true });
    await expect(announcements).toBeEnabled();
    await announcements.scrollIntoViewIfNeeded();
    const before = (await announcements.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    releaseActivity();
    await expect(manager.getByText('Updates automatically')).toBeVisible();
    const after = (await announcements.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    await page.mouse.up();
    await expect(announcements).toHaveAttribute('aria-pressed', 'true');
    await expect(manager.getByLabel('Search guest emails', { exact: true })).toBeVisible();
  } finally {
    releaseActivity();
    await page.mouse.up();
  }
});
test('registration tabs accept the first click after scrolling to them', async ({ page }) => {
  for (const path of ['/admin/registrations?event=rsvp-browser', '/organizer/workspace?area=events&event=rsvp-browser&view=guests']) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(path);
      if(path.startsWith('/organizer/'))await page.getByRole('button',{name:'RSVP review & setup',exact:true}).click();
      const manager = page.locator('.registration-manager');
      await manager.getByRole('button', { name: 'Save registration settings', exact: true }).scrollIntoViewIfNeeded();
      const emails = manager.getByRole('button', { name: 'Guest emails', exact: true });
      await emails.click();
      await expect(emails).toHaveAttribute('aria-pressed', 'true');
      await expect(manager.getByLabel('Search guest emails', { exact: true })).toBeVisible();
      await manager.getByRole('button', { name: 'Setup', exact: true }).click();
      await manager.getByRole('button', { name: 'Save registration settings', exact: true }).scrollIntoViewIfNeeded();
      const announcements = manager.getByRole('button', { name: path.startsWith('/organizer/')?'Guest emails':'Announcements', exact: true });
      await announcements.click();
      await expect(announcements).toHaveAttribute('aria-pressed', 'true');
      await expect(manager.getByLabel(path.startsWith('/organizer/')?'Search guest emails':'Subject', { exact: true })).toBeVisible();
    }
  }
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
test('owner login waits for hydration before accepting input and preserves both values', async ({ page, context }) => {
  await context.clearCookies();
  let signInRequests = 0;
  await page.route('**/api/admin/session**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { passwordSalt: 'AAECAwQFBgcICQoLDA0ODw', passwordIterations: 600000 } });
    expect(route.request().method()).toBe('POST');
    signInRequests++;
    expect(route.request().postDataJSON().email).toBe(fixture.email);
    return route.fulfill({ status: 401, json: { error: 'Readiness fixture: no session created.' } });
  });
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route('**/_next/static/**/*.js', async route => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/admin/login?returnTo=%2Fadmin%2Foperations', { waitUntil: 'commit' });
    const email = page.getByLabel('Work email');
    const password = page.getByLabel('Password', { exact: true });
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(email).toBeVisible();
    await expect(email).toBeDisabled();
    await expect(password).toBeDisabled();
    await expect(submit).toBeDisabled();
    await expect(email).toHaveValue('');
    await expect(password).toHaveValue('');
    releaseScripts();
    await expect(email).toBeEnabled();
    await expect(password).toBeEnabled();
    await expect(submit).toBeEnabled();
    await email.fill(fixture.email);
    await password.fill(fixture.password);
    await expect(email).toHaveValue(fixture.email);
    await expect(password).toHaveValue(fixture.password);
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('Readiness fixture: no session created.');
    expect(signInRequests).toBe(1);
    await expect(email).toHaveValue(fixture.email);
    await expect(password).toHaveValue(fixture.password);
  } finally {
    releaseScripts();
    await page.unroute('**/_next/static/**/*.js');
  }
});

test('owner signs in through the real password flow and signs out', async ({ page, context }) => {
  await context.clearCookies(); await page.goto('/admin/login?returnTo=%2Fadmin%2Foperations');
  await page.getByLabel('Work email').fill(fixture.email); await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await expect(page.getByLabel('Work email')).toHaveValue(fixture.email);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(fixture.password);
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL(/\/admin\/operations$/);
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
  await page.goto('/organizer/workspace?area=events&event=rsvp-browser&view=guests');await page.getByRole('button',{name:'RSVP review & setup',exact:true}).click();
  const manager=page.locator('.registration-manager');await expect(manager).toBeVisible();
  await expect(manager.getByText('Updates automatically')).toBeVisible();
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
  await expect(page.getByLabel('Receive notifications for this event and host.')).not.toBeChecked();
  const guestAxe=await new AxeBuilder({page}).include('.registration-form').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(guestAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:info.outputPath('guest-rsvp-form.png'),fullPage:true});
  await page.getByLabel('Your name').fill('Shared Link Guest');await page.getByLabel('Email address').fill('shared-link@example.com');
  await page.getByRole('checkbox',{name:/I accept the event terms/}).check();
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/registrations')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Send RSVP'}).click();expect((await submitted).status()).toBe(202);
  await expect(page.getByRole('status')).toContainText('RSVP received.');
  await expect(page.getByRole('status')).toContainText('Your request is not a confirmed spot.');
  await expect(page.getByRole('button',{name:/confirmation link/i})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('guest-rsvp-success.png'),fullPage:true});
  await page.goto('/event/rsvp-browser?register=1#register');await expect(page).toHaveURL(/\/rsvp\/rsvp-browser(?:#register)?$/);await expect(page.getByLabel('Your name')).toBeVisible();
 });
 test('verified signup appears without refreshing the organiser dashboard and joins guest emails',async({page})=>{
  await page.goto('/organizer/workspace?area=events&event=rsvp-browser&view=guests');await page.getByRole('button',{name:'RSVP review & setup',exact:true}).click();const manager=page.locator('.registration-manager');
  await expect(manager.getByText('Updates automatically')).toBeVisible();
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
  await expect(manager.locator('.audience-table')).toHaveCount(0);
  await manager.getByRole('button',{name:'View guest emails',exact:true}).click();
  await expect(manager.getByText('rsvp-browser@example.com',{exact:true})).toBeVisible();
  const csv=await page.request.get('/api/admin/audience?eventSlug=rsvp-browser&export=csv');expect(await csv.text()).toContain('rsvp-browser@example.com');
 });
 test('announcement preview preserves a failed send and owner sees organiser actions',async({page,context,baseURL},info)=>{
  await page.route('**/api/admin/campaigns?**',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,configured:true,state:{...data.state,status:'ready'}}});});
  await page.goto('/organizer/workspace?area=promote&event=rsvp-browser');const manager=page.locator('.suite-content');
  const announcements=manager.getByRole('button',{name:'Announcements',exact:true});await announcements.click();await expect(announcements).toHaveAttribute('aria-pressed','true');
  await manager.getByLabel('Subject',{exact:true}).fill('Doors open at eight');await manager.getByLabel('Announcement',{exact:true}).fill('Please bring your QR pass. See you at the event.');
  await manager.getByRole('button',{name:'Preview announcement'}).click();await expect(manager.locator('.announcement-preview')).toContainText('1 subscribed guest emails');
  await page.route('**/api/admin/campaigns',route=>route.abort('failed'));await manager.getByRole('button',{name:'Send announcement'}).click();
  await expect(manager.getByRole('button',{name:'Send announcement'})).toBeEnabled();await expect(manager.getByLabel('Subject',{exact:true})).toHaveValue('Doors open at eight');
  const axe=await new AxeBuilder({page}).include('.suite-content').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:info.outputPath('announcement-preview.png'),fullPage:true});
  await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.token,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);await page.goto('/admin/operations');
  await page.locator('.organizer-activity summary').click();await expect(page.locator('.organizer-activity')).toContainText('rsvp-host@example.com');await expect(page.locator('.organizer-activity')).toContainText('GHS 75.00');
 });
});

test('master account can remove staff and keeps its own account',async({page},info)=>{
 await page.goto('/admin/accounts');await page.getByRole('button',{name:/Removable Staff/}).click();
 await page.getByRole('button',{name:'Remove from Operations'}).click();await expect(page.getByRole('heading',{name:'Remove Removable Staff?'})).toBeVisible();
 await page.screenshot({path:info.outputPath('staff-removal.png'),fullPage:true});
 await page.route('**/api/admin/accounts',r=>r.request().method()==='DELETE'?r.abort('failed'):r.continue());
 await page.getByRole('button',{name:'Confirm removal'}).click();await expect(page.getByRole('status')).toContainText('Connection lost');
 await page.unroute('**/api/admin/accounts');await page.getByRole('button',{name:'Confirm removal'}).click();await expect(page.getByRole('status')).toContainText('Account removed');await expect(page.getByRole('button',{name:/Removable Staff/})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button',{name:/Removable Staff/})).toHaveCount(0);await page.getByRole('button',{name:/Operations Audit Owner/}).click();await expect(page.getByRole('button',{name:'Remove from Operations'})).toHaveCount(0);
});

test('every organizer task and expanded panel remains compact and readable',async({page},info)=>{
 const apiErrors:string[]=[];page.on('response',r=>{if(r.url().includes('/api/organizer/business')&&r.status()>=500)apiErrors.push(r.url());});
 await page.goto('/organizer/workspace?area=events&event=rsvp-browser');await expect(page.locator('#suite-event')).toHaveValue('rsvp-browser');
 const headerFits=await page.locator('.workspace-topbar').evaluate(header=>{const box=header.getBoundingClientRect();return [...header.children].every(child=>{const rect=child.getBoundingClientRect();return rect.top>=box.top&&rect.bottom<=box.bottom;});});expect(headerFits,'workspace switcher stays within the header').toBe(true);
 const tabs=page.getByRole('navigation',{name:'Event tools'});
 for(const name of ['Overview','Tickets','Room & VIP','Requests','Guests','Insights']){
  await tabs.getByRole('button',{name,exact:true}).click();
  for(const summary of await page.locator('.suite-content details:not([open]) > summary').all())if(await summary.isVisible())await summary.click();
  await expectVisibleLettering(page,'.suite-content');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  const axe=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect.soft(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),name).toEqual([]);
  await page.screenshot({path:info.outputPath(`organizer-${name.replaceAll(/[^a-z]/gi,'-')}.png`),fullPage:true});
 }
 await tabs.getByRole('button',{name:'Details',exact:true}).click();await page.getByLabel('Venue',{exact:true}).fill('Keep my venue draft');await tabs.getByRole('button',{name:'Room & VIP',exact:true}).click();await tabs.getByRole('button',{name:'Details',exact:true}).click();await expect(page.getByLabel('Venue',{exact:true})).toHaveValue('Keep my venue draft');
 for(const name of ['Audience','Promote','Money','Team','Overview']){
  await hostArea(page,name);
  await expect(page.locator('.suite-content h1:visible,.suite-content h2:visible').first()).toBeVisible();
  const axe=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect.soft(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),name).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await page.screenshot({path:info.outputPath(`organizer-area-${name.toLowerCase()}.png`),fullPage:true});
 }
 await hostArea(page,'Events');await tabs.getByRole('button',{name:'Details',exact:true}).click();await expect(page.getByLabel('Venue',{exact:true})).toHaveValue('Keep my venue draft');
 await page.goBack();await expect(tabs.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-current','page');await page.goForward();await expect(page.getByLabel('Venue',{exact:true})).toHaveValue('Keep my venue draft');
 expect(apiErrors).toEqual([]);
 await page.goto('/organizer/analytics');await expect(page.locator('.analytics-overview')).toBeVisible();await expectVisibleLettering(page,'.organizer-analytics');const analyticsAxe=await new AxeBuilder({page}).include('.organizer-analytics').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect.soft(analyticsAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),'Analytics').toEqual([]);
});

test('email list stays closed by default and paginates compact search results',async({page},info)=>{
 await page.route('**/api/admin/audience?**',async route=>{
  const url=new URL(route.request().url());const offset=Number(url.searchParams.get('offset')||0);const query=url.searchParams.get('q')||'';const all=Array.from({length:23},(_,i)=>({email:`guest-${String(i).padStart(2,'0')}@example.com`,name:`Guest ${i}`,subscribed:i%2,source:'rsvp',guests:1}));const matches=all.filter(c=>!query||c.email.includes(query));
  await route.fulfill({json:{contacts:url.searchParams.get('summary')==='1'?[]:matches.slice(offset,offset+10),total:matches.length,subscribers:11,campaigns:[],emailConfigured:false}});
 });
 await page.goto('/admin/registrations?event=rsvp-browser');await page.getByRole('button',{name:'Guest emails',exact:true}).click();await expect(page.getByRole('heading',{name:'23 guest emails'})).toBeVisible();await expect(page.locator('.audience-table')).toHaveCount(0);await page.screenshot({path:info.outputPath('guest-email-summary.png'),fullPage:true});
 await page.getByRole('button',{name:'View guest emails',exact:true}).click();await expect(page.locator('.audience-table tbody tr')).toHaveCount(10);await page.locator('.audience-pagination').getByRole('button',{name:'Next'}).click();await expect(page.getByText('11–20 of 23')).toBeVisible();
 await page.getByLabel('Search guest emails',{exact:true}).fill('guest-22');await expect(page.locator('.audience-table tbody tr')).toHaveCount(1);await expect(page.getByText('guest-22@example.com')).toBeVisible();await expectVisibleLettering(page,'.event-audience');await page.screenshot({path:info.outputPath('guest-email-search.png'),fullPage:true});
});

test('the door desk keeps a large RSVP list compact and retains a failed guest addition',async({page},info)=>{
  await page.route('**/api/admin/door?**',route=>{
    const url=new URL(route.request().url()),q=url.searchParams.get('q')??'',offset=Number(url.searchParams.get('offset')??0);
    const all=Array.from({length:31},(_,i)=>({id:`rsvp:guest-${i}`,guestName:`Party Guest ${String(i+1).padStart(2,'0')}`,admissionCount:1,kind:'guest_list',note:'RSVP',status:'expected'})).filter(g=>g.guestName.toLowerCase().includes(q.toLowerCase()));
    return route.fulfill({json:{guests:all.slice(offset,offset+10),tiers:[],total:all.length,expected:31,admitted:0}});
  });
  await page.route('**/api/admin/door',route=>route.abort('failed'));
  await page.goto('/scan');const desk=page.locator('.door-desk');
  await expect(desk.getByText('31 expected · 0 admitted')).toBeVisible();await expect(desk.locator('.door-desk__list article')).toHaveCount(10);
  await desk.getByRole('button',{name:'Next',exact:true}).click();await expect(desk.getByText('Party Guest 11',{exact:true})).toBeVisible();
  await desk.getByRole('searchbox',{name:'Search RSVP and door guests'}).fill('Guest 31');await expect(desk.locator('.door-desk__list article')).toHaveCount(1);
  await desk.getByText('Add a guest or take a walk-up sale',{exact:true}).click();await desk.getByRole('textbox',{name:'New door guest name'}).fill('Guest at the door');
  await desk.getByRole('button',{name:'Add',exact:true}).click();await expect(desk.getByRole('status')).toContainText('Connection lost');
  await expect(desk.getByRole('textbox',{name:'New door guest name'})).toHaveValue('Guest at the door');await expect(desk.getByRole('button',{name:'Add',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.screenshot({path:info.outputPath('door-desk.png'),fullPage:true});
});


test('RSVP analytics filters, links and exports work without exposing guest contacts', async ({page}, info) => {
 await page.clock.install();
 await page.goto('/organizer/analytics');
 await expect(page.getByRole('heading', {name:'Who’s coming through?'})).toBeVisible();
 await page.getByLabel('Night', {exact:true}).selectOption('rsvp-browser');
 await expect(page.locator('.analytics-loading')).toHaveCount(0);
 await expect(page).toHaveURL(/event=rsvp-browser/);
 await page.getByLabel('Period',{exact:true}).selectOption('7');
 await expect(page.locator('.analytics-loading')).toHaveCount(0);
 await page.reload();
 await expect(page.getByLabel('Night',{exact:true})).toHaveValue('rsvp-browser');
 await expect(page.getByLabel('Period',{exact:true})).toHaveValue('7');
 await expect(page.getByText('Confirmed RSVP guests',{exact:true})).toBeVisible();
 await page.route('**/api/organizer/analytics?**',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Showing the last loaded figures');
 await expect(page.getByText('Confirmed RSVP guests',{exact:true})).toBeVisible();
 await page.unroute('**/api/organizer/analytics?**');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('analytics-summary.png'),fullPage:true});
 const report=page.locator('.rsvp-report');
 await report.getByText('Guest status & signup sources',{exact:true}).click();
 await report.getByText('Share a link. See what it brings.',{exact:true}).click();
 await report.getByLabel('Where you’ll share it').selectOption('instagram');
 await expect(report.getByLabel('RSVP link',{exact:true})).toHaveValue('https://tickets.becoreops.com/rsvp/rsvp-browser?source=instagram');
 await expect(report).not.toContainText('rsvp-browser@example.com');
 await expect(report.getByRole('button',{name:'Copy link'})).toBeVisible();
 const csv=await page.request.get('/api/organizer/analytics?eventSlug=rsvp-browser&range=all&format=csv');
 expect(csv.ok()).toBeTruthy();expect(await csv.text()).toContain('RSVP link sources');
 const axe=await new AxeBuilder({page}).include('.organizer-analytics').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('rsvp-analytics-expanded.png'),fullPage:true});
 const views=page.getByRole('navigation',{name:'Analytics views'});
 for(const [label,id] of [['Sales','sales'],['Reach','reach'],['Door & Room','door']]) {
   await views.getByRole('button',{name:label,exact:true}).click();
   await expect(page.locator(`#analytics-${id}`)).toBeVisible();
   await expect(report).toBeHidden();
   const check=await new AxeBuilder({page}).include('.organizer-analytics').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   expect(check.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   await page.screenshot({path:info.outputPath(`analytics-${id}.png`),fullPage:true});
 }
 await page.reload();
 await expect(views.getByRole('button',{name:'Door & Room',exact:true})).toHaveAttribute('aria-pressed','true');
 await views.getByRole('button',{name:'Guest list',exact:true}).click();
 await report.getByText('Share a link. See what it brings.',{exact:true}).click();
 await report.getByLabel('Where you’ll share it').selectOption('instagram');
 await views.getByRole('button',{name:'Sales',exact:true}).click();
 await views.getByRole('button',{name:'Guest list',exact:true}).click();
 await expect(report.getByLabel('Where you’ll share it')).toHaveValue('instagram');
 const automaticRefresh=page.waitForResponse(response=>response.url().includes('/api/organizer/analytics?')&&response.ok());
 await page.clock.fastForward(60_000);
 await automaticRefresh;
 await expect(report.getByLabel('Where you’ll share it')).toHaveValue('instagram');
 await page.getByRole('link',{name:'Email report settings',exact:true}).click();
 await expect(page.locator('#suite-event')).toHaveValue('rsvp-browser');
 await expect(page.locator('#email-reports')).toHaveAttribute('open','');
});

test('host lands on their event with a useful overview and recoverable report preferences',async({page,context,baseURL},info)=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 await page.goto('/organizer/workspace?area=events');
 await expect(page.locator('#suite-event')).toHaveValue('rsvp-browser');
 const overview=page.getByRole('region',{name:'Your event at a glance'});
 await expect(overview.getByText('Confirmed RSVP guests',{exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-current','page');
 await expect(overview.getByLabel('Guest link')).toHaveValue('https://tickets.becoreops.com/rsvp/rsvp-browser');
 await overview.getByText('Email reports',{exact:true}).click();
 const reports=overview.getByRole('switch',{name:'Email me my host reports'});await expect(reports).toBeChecked();
 await page.route('**/api/organizer/reports',route=>route.request().method()==='PATCH'?route.abort('failed'):route.continue());
 await reports.click();await expect(overview.getByRole('alert')).toBeVisible();await expect(reports).toBeChecked();
 await page.unroute('**/api/organizer/reports');await reports.click();await expect(reports).not.toBeChecked();
 await page.reload();await overview.getByText('Email reports',{exact:true}).click();await expect(reports).not.toBeChecked();
 await reports.click();await expect(reports).toBeChecked();
 const axe=await new AxeBuilder({page}).include('.host-start').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await expectVisibleLettering(page,'.host-start');expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:info.outputPath('host-first-login.png'),fullPage:true});
 await overview.getByRole('button',{name:'Review Guest setup',exact:true}).click();await expect(page.locator('.registration-manager:visible')).toBeVisible();await expect(page.getByRole('heading',{name:'How should guests join?'})).toBeVisible();expect(new URL(page.url()).searchParams.get('tab')).toBe('settings');
 // Fetch the real isolated summary once, then keep a single synchronous mock.
 // Replacing a handler during route.fetch can leave it fulfilling an already
 // handled request when overview activation and manual refresh overlap.
 const reportResponse=await context.request.get(`${baseURL}/api/organizer/reports?eventSlug=rsvp-browser`);
 expect(reportResponse.ok()).toBe(true);
 const reportData=await reportResponse.json();
 let reportView={...reportData,summary:{...reportData.summary,interest:12,event:{...reportData.summary.event,mode:'interest',scheduleStatus:'coming_soon',endsAt:'2020-01-01T00:00:00.000Z'}}};
 await page.route('**/api/organizer/reports?**',route=>route.fulfill({json:reportView}));
 await page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Overview',exact:true}).click();
 await overview.getByRole('button',{name:'Refresh event summary'}).click();
 await expect(overview.getByText('Interest sign-ups',{exact:true})).toBeVisible();
 await expect(overview.getByLabel('Guest link')).toBeVisible();
 await expect(overview.getByText('This event has ended',{exact:true})).toHaveCount(0);
 reportView={...reportData,summary:{...reportData.summary,event:{...reportData.summary.event,status:'unpublished'}}};
 await overview.getByRole('button',{name:'Refresh event summary'}).click();await expect(overview.getByText('Your public link is waiting',{exact:true})).toBeVisible();await expect(overview.getByLabel('Guest link')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('host-private-preparation.png'),fullPage:true});
 await overview.getByRole('button',{name:'View analytics & tracked links'}).click();
 await expect(page.locator('#suite-event')).toHaveValue('rsvp-browser');
 await expect(page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Insights',exact:true})).toHaveAttribute('aria-current','page');
 await expect(page.getByRole('combobox',{name:'Period',exact:true})).toHaveValue('all');
});


test('organizer can manage coupons, questions, guests and promoter records in isolated D1',async({page},info)=>{
 const code=`WEB${Date.now().toString(36)}${info.project.name.includes('mobile')?'M':'D'}`.toUpperCase();
 await page.goto('/organizer/workspace?area=promote&event=after-dark-osu');
 await page.getByRole('button',{name:'Coupons',exact:true}).click();await page.getByText('Create a discount code',{exact:true}).click();
 await page.getByLabel('Code',{exact:true}).fill(code);await page.getByLabel('Value (% or GHS)',{exact:true}).fill('10');
 await page.getByLabel('Expires (Accra time)',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
 await page.getByRole('button',{name:'Create coupon',exact:true}).click();
 const coupon=page.locator('.suite-rows article').filter({hasText:code});await expect(coupon).toBeVisible();await coupon.getByRole('button',{name:'Disable',exact:true}).click();await expect(coupon.getByRole('button',{name:'Enable',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Links & promoters',exact:true}).click();await page.getByText('Add a promoter',{exact:true}).click();await page.getByLabel('Promoter name',{exact:true}).fill(`Crew ${code}`);await page.getByLabel('Link code',{exact:true}).fill(code);await page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Add a promoter$/})}).getByLabel('Commission %',{exact:true}).fill('5');await page.getByRole('button',{name:'Create promoter link',exact:true}).click();
 await page.locator('summary').filter({hasText:`Crew ${code}`}).click();await expect(page.getByLabel(`Crew ${code} buyer link`)).toHaveValue(new RegExp(`ref=${code}`));
 await page.getByRole('button',{name:'Create private report link',exact:true}).click();await expect(page.getByLabel('Share only with this promoter')).toHaveValue(/promoter#token=/);
 await page.goto('/organizer/workspace?area=events&event=after-dark-osu&view=overview');await page.locator('summary').filter({hasText:/^Guest questions$/}).click();await page.getByRole('button',{name:'Add question',exact:true}).click();await page.getByLabel('Question',{exact:true}).fill(`Arrival group ${code}?`);await page.getByRole('button',{name:'Save question',exact:true}).click();await expect(page.getByText(`Arrival group ${code}?`,{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Tickets',exact:true}).click();await page.getByText('Issue complimentary passes',{exact:true}).click();
 await page.getByRole('combobox',{name:'Ticket type',exact:true}).selectOption({index:1});await page.getByLabel('Guest CSV',{exact:true}).fill(`name,email,quantity\nGuest ${code},${code.toLowerCase()}@example.com,1`);await page.getByRole('button',{name:'Review guest list',exact:true}).click();await page.getByRole('button',{name:'Issue reviewed passes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'All complimentary passes are issued'})).toBeVisible();
 await page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Guests',exact:true}).click();await page.getByLabel('Find a guest',{exact:true}).fill(code.toLowerCase());await expect(page.locator('.suite-section:visible').getByText(`Guest ${code}`,{exact:true})).toBeVisible();
 await hostArea(page,'Money');await expect(page.getByRole('heading',{name:'Know where you stand.'})).toBeVisible();await expect(page.getByRole('heading',{name:'Payout history'})).toBeVisible();
});

for(const fails of [false,true])test(`organizer overview keeps task controls stable while its summary ${fails?'fails':'loads'}`,async({page})=>{
 let release:(()=>Promise<void>)|undefined;
 await page.route('**/api/organizer/reports?**',route=>{release=()=>fails?route.fulfill({status:503,json:{error:'Summary temporarily unavailable'}}):route.continue();});
 await page.goto('/organizer/workspace?area=events&event=after-dark-osu&view=overview');
 await expect(page.getByText('Getting your event ready…',{exact:true})).toBeVisible();
 const questions=page.locator('summary').filter({hasText:/^Guest questions$/});
 await expect(questions).toBeHidden();
 await expect.poll(()=>Boolean(release)).toBe(true);await release!();
 if(fails)await expect(page.getByRole('alert')).toContainText('Summary temporarily unavailable');
 await questions.click();
 await expect(page.getByRole('button',{name:'Add question',exact:true})).toBeVisible();
});

test('workspace submission, help, public previews and return retain the organizer session',async({page,context,baseURL},info)=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 const signouts:string[]=[];page.on('request',r=>{if(r.url().includes('/api/admin/session')&&r.method()==='DELETE')signouts.push(r.url());});
 await page.goto('/admin/events');await expect(page).toHaveURL(/\/organizer\/workspace/);await expect(page).not.toHaveURL(/\/admin\/login/);
 await expect(page.getByRole('combobox',{name:'Workspace',exact:true})).toHaveCount(0);
 for(const path of ['/api/admin/events','/api/admin/accounts','/api/admin/orders','/api/admin/operations'])expect((await page.request.get(path)).status()).toBe(403);
 await page.goto('/organizer/workspace?area=overview&event=rsvp-browser');
 await page.getByRole('button',{name:'Submit a Night',exact:true}).click();
 await expect(page).toHaveURL(/area=submit/);await expect(page.locator('.workspace-topbar')).toBeVisible();
 await expect(page.getByLabel('Email',{exact:true})).toHaveValue('rsvp-host@example.com');
 await page.getByLabel('Organiser or collective').fill('My unsent plan');
 await openWorkspaceMenu(page);await page.locator('.workspace-tools>summary').click();
 await page.getByRole('link',{name:'Help centre',exact:true}).click();await expect(page.getByRole('heading',{name:'Help centre',exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search BeCore Help'}).fill('Submit a Night for review');
 await page.getByRole('link',{name:'Submit a Night',exact:true}).click();
 await expect(page.getByLabel('Organiser or collective')).toHaveValue('My unsent plan');
 await page.getByRole('button',{name:'Back to workspace'}).click();await expect(page).toHaveURL(/area=overview/);
 await hostArea(page,'Events');await page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Tickets',exact:true}).click();
 const before=page.url();await openWorkspaceMenu(page);await page.getByRole('link',{name:'View public site'}).click();
 await expect(page.getByRole('link',{name:'Back to workspace'})).toBeVisible();await page.getByRole('link',{name:'Back to workspace'}).click();await expect(page).toHaveURL(before);
 await expect(page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Tickets',exact:true})).toHaveAttribute('aria-current','page');
 await page.goto('/organizer/submit');await expect(page).toHaveURL(/organizer\/workspace\?area=submit/);
 await page.goto('/help');await expect(page).toHaveURL(/organizer\/workspace\?area=help/);
 await expect(page.getByRole('heading',{name:'Help centre',exact:true})).toBeVisible();
 await openWorkspaceMenu(page);
 const links=await page.locator('#workspace-navigation a').evaluateAll(items=>items.map(x=>(x as HTMLAnchorElement).href));expect(new Set(links).size).toBe(links.length);
 expect(signouts).toEqual([]);expect((await context.cookies()).find(c=>c.name==='bct_staff')?.value).toBe(fixture.organizerToken);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const axe=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:info.outputPath('workspace-help-navigation.png'),fullPage:true});
});

test('host edits ticket allocation and grade, keeps a failed draft, and sees persisted stock',async({page,context,baseURL},info)=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 await page.goto('/organizer/workspace?area=events&event=rsvp-browser&view=tickets');
 await expect(page.locator('#suite-event')).toHaveValue('rsvp-browser');
 const form=page.getByRole('form',{name:'Edit ticket grade'}),base=`Host grade ${Date.now()}`,name=`${base} edited`;
 await page.getByRole('button',{name:'Add ticket grade',exact:true}).click();
 await form.getByLabel('Ticket grade / name').fill(base);await form.getByLabel(/^Code/).fill(`browser-${Date.now()}`);
 await form.getByLabel('Price per package (GH₵)',{exact:true}).fill('75');await form.getByLabel('Total admission allocation').fill('25');await form.getByLabel('Description',{exact:true}).fill('Isolated host ticket grade');
 await form.getByRole('button',{name:'Save ticket grade',exact:true}).click();await expect(form).not.toBeVisible();
 await page.getByRole('button',{name:`Edit ${base}`,exact:true}).click();
 const capacity=form.getByLabel('Total admission allocation');
 const current=Number(await capacity.inputValue());await capacity.fill(String(current+5));await form.getByLabel('Ticket grade / name').fill(name);
 await page.route('**/api/organizer/business',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
 await form.getByRole('button',{name:'Save ticket grade',exact:true}).click();await expect(form.getByRole('button',{name:'Save ticket grade',exact:true})).toBeEnabled();await expect(form.getByLabel('Ticket grade / name')).toHaveValue(name);
 await page.unroute('**/api/organizer/business');await form.getByRole('button',{name:'Save ticket grade',exact:true}).click();await expect(form).not.toBeVisible();await expect(page.getByRole('button',{name:`Edit ${name}`,exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:`Edit ${name}`,exact:true}).click();await expect(form.getByLabel('Total admission allocation')).toHaveValue(String(current+5));
 await expect(form.getByLabel('Ticket grade / name')).toHaveValue(name);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const axe=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:info.outputPath('host-ticket-edit-expanded.png'),fullPage:true});
});


test('workspace settings and Event desk retain their frame and unfinished question',async({page,context,baseURL},info)=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 await page.goto('/organizer/assistant?event=rsvp-browser');
 await expect(page).toHaveURL(/area=desk&event=rsvp-browser/);
 await expect(page.locator('#assistant-event')).toHaveValue('rsvp-browser');
 await expect(page.getByRole('heading',{name:'Event desk',exact:true})).toBeVisible();
 const question=page.locator('#event-desk-question');await question.fill('Keep my unfinished event question');
 const visit=async(name:string)=>{await openWorkspaceMenu(page);const tools=page.locator('.workspace-tools');if(!await tools.evaluate(e=>(e as HTMLDetailsElement).open))await tools.locator('summary').click();await tools.getByRole('link',{name,exact:true}).click();};
 await visit('Account settings');await expect(page.locator('.account-security-stack')).toBeVisible();
 for(const summary of await page.locator('.account-security-stack details:not([open])>summary').all())if(await summary.isVisible())await summary.click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const account=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(account.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:info.outputPath('workspace-account.png'),fullPage:true,scale:'css'});
 await visit('Event desk');await expect(question).toHaveValue('Keep my unfinished event question');
 await expect(page.locator('main')).toHaveCount(1);await expect(page.locator('.workspace-topbar')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const desk=await new AxeBuilder({page}).include('.organizer-suite').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(desk.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:info.outputPath('workspace-event-desk.png'),fullPage:true,scale:'css'});
});

test('owner reviews a host application without an event',async({page},info)=>{
 await page.goto('/admin/hosts');
 await expect(page.getByRole('heading',{name:'Host applications',exact:true})).toBeVisible();
 await page.getByText('Host onboarding fixture',{exact:true}).click();
 await expect(page.getByText('host-onboarding-fixture@example.com',{exact:true})).toBeVisible();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:info.outputPath('host-approval.png'),fullPage:true});
 await page.getByRole('button',{name:'Approve host',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Host approved'})).toContainText('Host approved');
 await page.getByRole('button',{name:/^Approved/}).click();
 await page.getByText('Host onboarding fixture',{exact:true}).click();
 await expect(page.getByRole('link',{name:'Manage account access'})).toBeVisible();
});

test('gate camera survives scan results, repeated starts and camera failure', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { denied: false, streams: [] as MediaStream[] };
    Object.assign(window, { gateCameraTest: state });
    const mediaDevices = { getUserMedia: async () => {
      if (state.denied) throw new DOMException('Camera unavailable', 'NotAllowedError');
      try {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      canvas.style.cssText = 'position:fixed;left:-1000px;top:0'; document.body.appendChild(canvas);
      const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(10); state.streams.push(stream);
      const timer = window.setInterval(() => {
        if (stream.getVideoTracks()[0]?.readyState === 'ended') { clearInterval(timer); canvas.remove(); return; }
        context.fillStyle = Date.now() % 2 ? 'white' : '#fefefe';
        context.fillRect(0, 0, 640, 480);
      }, 100);
      return stream;
      } catch (error) { console.error('Camera fixture failed:', String(error)); throw error; }
    } };
    // Use a stable API object: WebKit can replace its native mediaDevices wrapper.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => mediaDevices });
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/^(Camera fixture failed:|Ticket camera could not start)/.test(message.text())) console.error(message.text()); });
  let outcome = 'unavailable';
  let holdStats = false;
  const statsGate: { release?: () => Promise<void> } = {};
  await page.route('**/api/admin/check-in?**', route => {
    if (!holdStats) return route.continue();
    return new Promise<void>(resolve => { statsGate.release = async () => { await route.continue(); resolve(); }; });
  });
  await page.route('**/api/admin/check-in', route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action === 'heartbeat') return route.continue();
    return route.fulfill({ status: outcome === 'valid' ? 200 : 409, json: { result: outcome, error: outcome === 'unavailable' ? 'The host must confirm its date before entry.' : undefined, ticket: { ticketId: 'camera-fixture', ticketType: 'RSVP', attendeeName: 'Camera fixture' } } });
  });
  await page.goto('/scan');
  await expect(page.getByText('Door list saved', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  const video = page.locator('.scan-frame video');
  try { await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2); }
  catch (error) {
    console.error('Scanner startup evidence', await page.evaluate(() => ({ secure: isSecureContext, media: typeof navigator.mediaDevices, camera: String(navigator.mediaDevices?.getUserMedia).slice(0,150), fixture: (window as unknown as {gateCameraTest: {denied:boolean; streams:MediaStream[]}}).gateCameraTest?.streams.map(stream => stream.getVideoTracks().map(track => ({label:track.label,state:track.readyState}))) })), errors);
    throw error;
  }
  await video.evaluate(v => Object.assign(window, { originalGateVideo: v }));
  for (const [result, heading] of [['unavailable', 'Entry is paused'], ['valid', 'You’re in'], ['duplicate', 'Already admitted']]) {
    outcome = result; holdStats = result === 'valid'; statsGate.release = undefined;
    await page.getByPlaceholder('BCT-XXXX-XXXX-XXXX-XXXX').fill('BCT-ABCD-EFGH-IJKL-MNOP');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { originalGateVideo: HTMLVideoElement }).originalGateVideo.isConnected)).toBe(true);
    if (holdStats) await expect.poll(() => Boolean(statsGate.release)).toBe(true);
    await page.getByRole('button', { name: 'Scan next ticket', exact: true }).click();
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(v => !(v as HTMLVideoElement).paused && Boolean((v as HTMLVideoElement).srcObject))).toBe(true);
    holdStats = false; await (statsGate.release as (() => Promise<void>) | undefined)?.();
  }
  outcome = 'unavailable';
  await page.getByPlaceholder('BCT-XXXX-XXXX-XXXX-XXXX').fill('BCT-ABCD-EFGH-IJKL-MNOP');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entry is paused' })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { gateCameraTest: { denied: boolean } }).gateCameraTest.denied = true; });
  await page.getByRole('button', { name: 'Scan next ticket', exact: true }).click();
  await expect(page.getByText('Camera access was not available.', { exact: false })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { gateCameraTest: { denied: boolean } }).gateCameraTest.denied = false; });
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect.poll(() => video.evaluate(v => !(v as HTMLVideoElement).paused && Boolean((v as HTMLVideoElement).srcObject))).toBe(true);
  expect(errors).toEqual([]);
});


test('host attention opens pending RSVP decisions directly and survives back navigation',async({page,context,baseURL})=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 const response=await context.request.get(`${baseURL}/api/organizer/reports?eventSlug=rsvp-browser`);expect(response.ok()).toBe(true);const actual=await response.json();
 await page.route('**/api/organizer/reports?**',route=>route.fulfill({json:{...actual,summary:{...actual.summary,pending:3}}}));
 await page.goto('/organizer/workspace?area=events&event=rsvp-browser&view=overview');
 await page.getByRole('button',{name:/3 RSVP requests need your nod/}).click();
 const manager=page.locator('.registration-manager:visible');
 await expect(manager.getByRole('heading',{name:'Guest list',exact:true})).toBeVisible();
 await expect(manager.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('requested');
 expect(new URL(page.url()).searchParams.get('event')).toBe('rsvp-browser');expect(new URL(page.url()).searchParams.get('status')).toBe('requested');
 await page.getByRole('navigation',{name:'Event tools'}).getByRole('button',{name:'Details',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Venue & line-up'})).toBeVisible();
 await page.goBack();await expect(manager.getByRole('heading',{name:'Guest list',exact:true})).toBeVisible();await expect(manager.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('requested');
 await page.reload();await expect(manager.getByRole('combobox',{name:'Status',exact:true})).toHaveValue('requested');
});

test('scanner preserves mixed offline conflicts and never claims network availability is synchronized',async({page})=>{
 await page.addInitScript(()=>{
  if(sessionStorage.getItem('scanner-recovery-fixture'))return;sessionStorage.setItem('scanner-recovery-fixture','1');
  localStorage.setItem('bct:gate-review:v1','[]');
  localStorage.setItem('bct:gate-queue:v1',JSON.stringify(['accepted','duplicate'].map(id=>({clientScanId:id,code:'BCT-AAAA-BBBB-CCCC-DDDD',eventSlug:'rsvp-browser',gate:'Main gate',deviceId:'isolated-browser',ticket:{ticketId:id,attendeeName:`Offline ${id}`,ticketType:'general'},savedAt:new Date().toISOString()}))));
 });
 await page.route('**/api/admin/check-in**',route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{issued:2,checkedIn:1,tiers:[],canUndo:true,manifest:[],generatedAt:new Date().toISOString()}});
  const body=route.request().postDataJSON();
  if(body.action==='heartbeat')return route.fulfill({json:{online:true}});
  return body.clientScanId==='duplicate'?route.fulfill({status:409,json:{result:'duplicate',error:'Already admitted at another door',ticket:{ticketId:'duplicate',attendeeName:'Offline duplicate',ticketType:'general'}}}):route.fulfill({json:{result:'valid'}});
 });
 await page.goto('/scan?event=rsvp-browser');await expect(page.getByRole('combobox',{name:'Event',exact:true})).toHaveValue('rsvp-browser');
 await expect(page.locator('.scanner-header')).toContainText('Needs supervisor review');
 await expect(page.getByRole('region',{name:'Offline entries needing review'})).toContainText('Offline duplicate');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bct:gate-queue:v1')??'[]'))).toHaveLength(0);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('bct:gate-review:v1')??'[]'))).toHaveLength(1);
 await page.reload();await expect(page.locator('.scanner-header')).toContainText('Needs supervisor review');
 await page.getByRole('button',{name:'Mark reviewed',exact:true}).click();await expect(page.locator('.scanner-header')).toContainText('Connected');
 await page.route('**/api/admin/check-in**',route=>route.abort('failed'));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.scanner-header')).toContainText('Connection not confirmed');
 expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
 await expect(page.locator('.scanner-header')).not.toContainText('Connected');
});

test('team invitations show delivery recovery and return acceptance to the assigned event',async({page,context,baseURL})=>{
 await context.clearCookies();await context.addCookies([{name:'bct_staff',value:fixture.organizerToken,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 let resends=0;
 await page.route('**/api/organizer/business**',route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='GET'&&url.searchParams.get('section')==='team')return route.fulfill({json:{canManage:true,members:[],invites:[{id:'recovery-invite',email:'door@example.com',role:'gate',createdAt:'2026-09-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',usedAt:null,revokedAt:null,expired:0,deliveryStatus:resends?'queued':'failed',nextAttemptAt:null,deliveryAttempts:3}]}});
  if(route.request().method()==='POST'&&route.request().postDataJSON().action==='team_resend_invite'){
   expect(route.request().postDataJSON()).toEqual({action:'team_resend_invite',eventSlug:'rsvp-browser',id:'recovery-invite'});resends++;return route.fulfill({json:{id:'fresh-invite',queued:true}});
  }
  return route.continue();
 });
 await page.goto('/organizer/workspace?area=team&event=rsvp-browser');await expect(page.getByText('Email needs attention',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Resend invitation',exact:true}).click();await expect(page.getByRole('status')).toContainText('Fresh invitation queued');await expect(page.getByText('Email queued',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Refresh team status',exact:true}).click();await expect(page.getByText('Email queued',{exact:true})).toBeVisible();expect(resends).toBe(1);
 await page.route('**/api/organizer/team/accept',route=>route.fulfill({json:route.request().postDataJSON().action==='inspect'?{email:'door@example.com',role:'gate',eventTitle:'RSVP browser gathering',eventSlug:'rsvp-browser',needsPassword:false}:{accepted:true,role:'gate',eventSlug:'rsvp-browser'}}));
 await page.goto('/organizer/team/accept#token=isolated-test-invitation');await expect(page.getByRole('button',{name:'Accept invitation',exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe('');
 await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
 const href=await page.getByRole('link',{name:'Sign in',exact:true}).getAttribute('href');expect(new URL(href!,baseURL).searchParams.get('returnTo')).toBe('/scan?event=rsvp-browser');
});


test('provider records keep event scope and survive an uncertain save without claiming settlement', async ({ page }, info) => {
  const item = { id: 'provider-ui', reference: 'BCT-PROVIDER-UI', eventSlug: 'after-dark-osu', eventTitle: 'Provider evidence test', ticketType: 'general', unitQuantity: 1, quantity: 1, totalAmountMinor: 10000, refundedAmountMinor: 0, currency: 'GHS', customerEmail: 'guest@example.com', customerPhone: '233000000000', customerName: 'Test guest', status: 'paid', paymentProvider: 'paystack', providerStatus: 'success', providerReference: 'PROVIDER-REF', paymentEnvironment: 'production', failureReason: null, refundStatus: null, disputeStatus: null, createdAt: '2026-01-01T00:00:00.000Z', paidAt: '2026-01-01T00:01:00.000Z', paymentVerifiedAt: '2026-01-01T00:01:00.000Z', checkedInCount: 0, issuedTicketCount: 1, deliveryStatus: 'sent', providerCases: [] as Array<Record<string, unknown>> };
  const submissions: Array<Record<string, unknown>> = [];
  const scopes: Array<{ event: string | null; status: string | null; provider: string | null }> = [];
  let externalCalls = 0;
  await page.route(/https:\/\/(api\.paystack\.co|[^/]*seev[^/]*)(\/|$)/, route => { externalCalls++; return route.abort(); });
  await page.route('**/api/admin/orders**', async route => {
    if (route.request().method() === 'GET') {
      const query = new URL(route.request().url()).searchParams;
      scopes.push({ event: query.get('event'), status: query.get('status'), provider: query.get('provider') });
      return route.fulfill({ json: { orders: [item], events: [{ slug: 'after-dark-osu', title: 'Provider evidence test' }], total: 1, page: 1, pageSize: 10, reconciliationRuns: [], settlements: [], disputes: [] } });
    }
    const body = route.request().postDataJSON(); submissions.push(body);
    expect(body.action).toBe('record_provider_case');
    if (submissions.length === 1) return route.abort('failed');
    item.providerCases = [{ id: body.operationId, orderId: item.id, provider: 'paystack', kind: body.kind, status: body.status, version: Number(body.expectedVersion) + 1, caseReference: body.caseReference, amountMinor: body.amountMinor, currency: 'GHS', evidenceAt: null, recordedAt: new Date().toISOString() }];
    return route.fulfill({ json: { result: 'provider_case_recorded' } });
  });
  await page.goto('/admin/orders?event=after-dark-osu&status=paid&provider=paystack');
  await expect(page.getByText('Payment verified · Settlement: not confirmed', { exact: true })).toBeVisible();
  await expect(page.getByText('Confirmation email: sent', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Order status', { exact: true })).toHaveValue('paid');
  await expect(page.getByLabel('Payment method', { exact: true })).toHaveValue('paystack');
  await page.getByRole('button', { name: 'Provider record', exact: true }).click();
  const form = page.getByRole('region', { name: 'Record provider case' });
  await expect(form).toBeVisible();
  await expect(form.getByText(/ticket access stays unchanged/)).toBeVisible();
  await form.getByLabel('Provider case or receipt reference').fill('SUPPORT-123');
  await form.getByLabel('External refund amount (GHS)').fill('50.00');
  await form.getByRole('checkbox').check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  const accessibility = await new AxeBuilder({ page }).include('.provider-tracking').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('provider-case-form.png'), fullPage: true });
  await form.getByRole('button', { name: 'Save provider record', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Your last action may have completed. Refresh to check before trying again.');
  await expect(form.getByLabel('Provider case or receipt reference')).toHaveValue('SUPPORT-123');
  await form.getByRole('button', { name: 'Save provider record', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(submissions).toHaveLength(2); expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0].amountMinor).toBe(5000);
  expect(scopes.length).toBeGreaterThan(1);
  expect(scopes.every(scope => scope.event === 'after-dark-osu' && scope.status === 'paid' && scope.provider === 'paystack')).toBe(true);
  await expect(page.getByText(/External refund case: pending/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Paystack refund', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Provider record', exact: true }).click();
  await expect(form.getByLabel('Provider case or receipt reference')).toHaveValue('SUPPORT-123');
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByLabel('Provider case status').selectOption('closed_unpaid');
  await expect(form.getByLabel('Provider case or receipt reference')).toBeDisabled();
  await expect(form.getByLabel('External refund amount (GHS)')).toBeDisabled();
  await form.getByRole('checkbox', { name: /confirmed no refund was made/ }).check();
  await form.getByRole('button', { name: 'Save provider record', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(submissions[2]).toMatchObject({ status: 'closed_unpaid', confirmedNoRefund: true });
  await expect(page.getByText(/External refund case: closed without refund/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Paystack refund', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Provider record', exact: true }).click();
  await form.getByLabel('Case type').selectOption('settlement');
  await expect(form.getByText(/Checkout totals are not proof of a payout/)).toBeVisible();
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(externalCalls).toBe(0);
});

test('Orders preserves validated payment exception filters and rejects unknown query values', async ({ page }) => {
  const queries: URLSearchParams[] = [];
  const latest = () => queries.at(-1);
  await page.route('**/api/admin/orders**', route => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { orders: [], events: [], total: 0, page: 1, pageSize: 10, reconciliationRuns: [], settlements: [], disputes: [] } });
  });
  for (const provider of ['seevplus', 'paystack']) {
    await page.goto('/admin/orders?status=payment_pending&removed=1&provider=' + provider);
    await expect.poll(() => latest()?.get('provider')).toBe(provider);
    expect(latest()!.get('status')).toBe('payment_pending');
    expect(latest()!.get('removed')).toBe('1');
    await page.getByText('Filter by event or payment method', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Include removed events', exact: true })).toBeChecked();
    await expect(page.getByLabel('Order status', { exact: true })).toHaveValue('payment_pending');
    await expect(page.getByLabel('Payment method', { exact: true })).toHaveValue(provider);
    const beforeSearch = queries.length;
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect.poll(() => queries.length).toBeGreaterThan(beforeSearch);
    await expect.poll(() => latest()?.get('status')).toBe('payment_pending');
    expect(latest()!.get('removed')).toBe('1');
    const beforeReload = queries.length;
    await page.reload();
    await expect.poll(() => queries.length).toBeGreaterThan(beforeReload);
    await page.getByText('Filter by event or payment method', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Include removed events', exact: true })).toBeChecked();
    expect(latest()!.get('removed')).toBe('1');
  }
  await page.goto('/admin/orders?status=untrusted&provider=untrusted&event=%3Cscript%3E&removed=untrusted');
  await expect(page.getByLabel('Order status', { exact: true })).toHaveValue('');
  await expect.poll(() => latest()?.has('status')).toBe(false);
  expect(latest()!.has('provider')).toBe(false); expect(latest()!.has('event')).toBe(false); expect(latest()!.has('removed')).toBe(false);
});
