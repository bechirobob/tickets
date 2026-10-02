import AxeBuilder from '@axe-core/playwright';
import {expect,test} from './analytics-fixture';
test.use({serviceWorkers:'block'});
// PR production audits target the previous release. Candidate CI exercises these
// routes locally; the post-deploy production audit exercises the live routes.
test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Host onboarding is verified against the candidate, then the deployed release.');
test('host onboarding preserves details on failure and completes without an event',async({page},info)=>{
 let attempts=0;
 await page.route('**/api/host-applications',route=>{const body=route.request().postDataJSON();expect(body.acceptedPolicies).toBe(true);expect(body.brandName).toBe('Accra Social Club');attempts++;return attempts===1?route.fulfill({status:503,json:{error:'Couldn’t save your details. Try again.'}}):route.fulfill({status:202,json:{received:true}});});
 await page.goto('/organizer/join');
 await expect(page.getByRole('heading',{name:/You bring the people/})).toBeVisible();
 await page.getByLabel('Host or brand name').fill('Accra Social Club');await page.getByLabel('Your name',{exact:true}).fill('Host Example');await page.getByLabel('Email',{exact:true}).fill('host@example.com');await page.getByLabel('Phone / WhatsApp').fill('+233240000000');await page.getByLabel('Social page or website').fill('https://example.com/accra');await page.getByRole('checkbox').check();
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:info.outputPath('host-form.png'),fullPage:true});
 await page.getByRole('button',{name:'Let’s get you verified'}).click();await expect(page.getByRole('alert')).toContainText('Couldn’t save');await expect(page.getByLabel('Host or brand name')).toHaveValue('Accra Social Club');await page.getByRole('button',{name:'Let’s get you verified'}).click();await expect(page.getByRole('heading',{name:'One quick inbox check.'})).toBeVisible();await page.getByRole('button',{name:'Back to my details'}).click();await expect(page.getByLabel('Email',{exact:true})).toHaveValue('host@example.com');
});
test('host confirmation removes the secret from history and requires a deliberate confirmation',async({page})=>{
 let confirmed=false;await page.route('**/api/host-applications/confirm',route=>{const body=route.request().postDataJSON();expect(body.token).toBe('T'.repeat(43));if(body.action==='inspect')return route.fulfill({json:{application:{brandName:'Accra Social Club',contactName:'Host Example',socialUrl:'https://example.com'}}});confirmed=true;return route.fulfill({json:{confirmed:true}});});
 await page.goto(`/organizer/join/confirm#token=${'T'.repeat(43)}`);await expect(page.getByRole('button',{name:'Confirm my email'})).toBeVisible();await expect(page).toHaveURL(/\/organizer\/join\/confirm$/);expect(confirmed).toBe(false);await page.getByRole('button',{name:'Confirm my email'}).click();await expect(page.getByRole('heading',{name:'Your host application is in.'})).toBeVisible();expect(confirmed).toBe(true);
});
