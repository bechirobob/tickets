import { expect, test } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

for (const state of ['confirmed', 'requested', 'signed-out']) {
  test(`registration refresh respects ${state} state`, async ({ page }) => {
    let requests = 0;
    await page.clock.install();
    await page.route('**/api/**', route => route.fulfill({status:401,json:{error:'Isolated fixture'}}));
    await page.route('**/api/customer/registrations', route => {
      requests++;
      return route.fulfill(state === 'signed-out' ? {status:401,json:{registrations:[]}} : {json:{registrations:[{id:'fixture',eventSlug:'the-weekend-braai',title:'Refresh fixture',kind:'rsvp',status:state,partySize:1,maxPartySize:1,mode:'rsvp',roomAccess:0}]}});
    });
    await page.goto('/my-nights');
    await expect.poll(()=>requests).toBe(1);
    await expect(page.getByText('Checking your registrations…')).toHaveCount(0);
    await page.clock.runFor(59_000);
    expect(requests).toBe(1);
    await page.clock.runFor(12_000);
    if(state==='requested') await expect.poll(()=>requests).toBe(2);
    else expect(requests).toBe(1);
    if(state!=='requested') { await page.clock.runFor(600_000); expect(requests).toBe(1); }
  });
}
