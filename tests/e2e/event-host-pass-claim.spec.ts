import {expect,test} from './analytics-fixture';

test.use({serviceWorkers:'block'});
// Candidate-only UI fixtures. No real link, account, pass, email or Room post.
test.skip(Boolean(process.env.E2E_BASE_URL),'Run the Host acceptance fixture against the local candidate only.');
const token='S'.repeat(43),eventSlug='synthetic-host-night';
test.beforeEach(async({page,baseURL})=>{
 const origin=new URL(baseURL??'http://127.0.0.1:8788').origin;
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin)return route.abort();
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'Isolated fixture only'}});
  return route.continue();
 });
});
test('the nonworking email SAMPLE offers no acceptance action',async({page})=>{
 await page.goto('/my-nights/access?kind=host#token=SAMPLE-NOT-ACTIVE');
 await expect(page.getByRole('heading',{name:'Your Room is waiting.'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Accept pass & enter the Room'})).toHaveCount(0);
 await expect(page.getByText(/This link’s missing a piece/)).toBeVisible();
 expect(new URL(page.url()).hash).toBe('');
});
test('a single acceptance click posts only to the scoped claim and opens its exact Room',async({page},info)=>{
 let claims=0;const posted:string[]=[];
 page.on('request',request=>{if(request.method()==='POST')posted.push(new URL(request.url()).pathname);});
 await page.route('**/api/customer/host-pass/claim',route=>{
  claims++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({token,confirmPlatformAnnouncements:false});
  expect(route.request().url()).not.toContain(token);
  return route.fulfill({json:{redirectTo:`/room/${eventSlug}`,eventSlug}});
 });
 await page.route(`**/room/${eventSlug}`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><title>Synthetic Room</title></head><body><h1>Synthetic Room reached</h1></body></html>'}));
 await page.goto(`/my-nights/access?kind=host#token=${token}`);
 const accept=page.getByRole('button',{name:'Accept pass & enter the Room',exact:true});await expect(accept).toBeVisible();
 expect(claims).toBe(0);expect(new URL(page.url()).hash).toBe('');
 expect(await page.locator('body').innerText()).not.toContain(token);
 expect(await page.evaluate(secret=>Object.values(localStorage).concat(Object.values(sessionStorage)).some(value=>value.includes(secret)),token)).toBe(false);
 await page.screenshot({path:info.outputPath('host-pass-acceptance.png'),fullPage:true});
 await accept.click();await expect(page.getByRole('heading',{name:'Synthetic Room reached'})).toBeVisible();
 expect(new URL(page.url()).pathname).toBe(`/room/${eventSlug}`);expect(claims).toBe(1);expect(posted).toEqual(['/api/customer/host-pass/claim']);
});
test('temporary failure and replay leave the in-memory link usable without automatic retries',async({page})=>{
 let claims=0;
 await page.route('**/api/customer/host-pass/claim',route=>{
  expect(route.request().postDataJSON().token).toBe(token);claims++;
  return route.fulfill({status:claims===1?503:409,json:{error:claims===1?'Please try again.':'This private pass link has already been used.'}});
 });
 await page.goto(`/my-nights/access?kind=host#token=${token}`);
 const accept=page.getByRole('button',{name:'Accept pass & enter the Room',exact:true});await accept.click();
 await expect(page.getByRole('alert')).toHaveText('Please try again.');await expect(accept).toBeEnabled();expect(claims).toBe(1);
 await accept.click();await expect(page.getByRole('alert')).toContainText('already been used');await expect(accept).toBeEnabled();expect(claims).toBe(2);
 expect(new URL(page.url()).hash).toBe('');expect(new URL(page.url()).pathname).toBe('/my-nights/access');
});
