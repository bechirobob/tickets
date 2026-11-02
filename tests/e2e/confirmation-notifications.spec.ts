import type { Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './analytics-fixture';

test.use({ serviceWorkers: 'block' });
// Match the configured device's native input, and require one real activation.
async function openNotificationDetails(summary: Locator) {
  await expect(summary).toBeVisible();
  await expect(summary.locator('..')).toHaveJSProperty('open', false);
  await summary.evaluate(element => {
    const evidence = { pointerTypes: [] as string[], clicks: 0 };
    Object.assign(element, { notificationActivation: evidence });
    element.addEventListener('pointerdown', event => evidence.pointerTypes.push((event as PointerEvent).pointerType));
    element.addEventListener('click', () => { evidence.clicks++; });
  });
  if (test.info().project.use.hasTouch) await summary.tap(); else await summary.click();
  await expect(summary.locator('..')).toHaveJSProperty('open', true);
  expect(await summary.evaluate(element => (element as HTMLElement & { notificationActivation: { pointerTypes: string[]; clicks: number } }).notificationActivation))
    .toEqual({ pointerTypes: [test.info().project.use.hasTouch ? 'touch' : 'mouse'], clicks: 1 });
}

async function member(page: Page) {
  await page.route('**/api/**', route => route.fulfill({status:401,json:{error:'Isolated fixture'}}));
  await page.route('**/api/customer/my-nights', route => route.fulfill({json:{attendee:{displayName:'Ama'},nights:[]}}));
  await page.route('**/api/customer/registrations', route => route.fulfill({json:{registrations:[]}}));
  await page.route('**/api/customer/notifications', route => route.fulfill({json:{notifications:[],unread:0}}));
}
async function phone(page:Page, permission:'default'|'denied'='default') {
  await page.addInitScript(({permission}) => {
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 Android Chrome'});
    Object.defineProperty(navigator,'platform',{configurable:true,value:'Linux'});
    Object.assign(window, { notificationPermissionRequests: 0 });
    Object.defineProperty(window,'Notification',{configurable:true,value:{permission:permission === 'denied' ? permission : sessionStorage.getItem('fixture-push-permission') ?? permission,requestPermission:async()=>{
      (window as unknown as { notificationPermissionRequests: number }).notificationPermissionRequests++;
      if (permission === 'denied') throw new Error('Denied permission must not request access again');
      sessionStorage.setItem('fixture-push-permission','granted');
      Object.defineProperty(window.Notification,'permission',{configurable:true,value:'granted'});return 'granted';
    }}});
    Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/browser-fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/browser-fixture',keys:{auth:'fixture',p256dh:'fixture'}})};
    const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve(registration),register:async()=>registration}});
  },{permission});
}
test('compact My Nights prompt disappears only after saving and stays hidden on return',async({page})=>{
  await member(page);await phone(page);
  let enabled=false, attempts=0;
  await page.route('**/api/customer/notifications/subscription**',route=>{
    if(route.request().method()==='POST') {
      const body=route.request().postDataJSON(); expect(body).toHaveProperty('confirmationUpdates');expect(body.hostUpdates).toBe(body.confirmationUpdates);expect(body.roomUpdates).toBeUndefined();attempts++;
      if(attempts===1)return route.fulfill({status:503,json:{error:'Could not save. Try again.'}});
      enabled=body.confirmationUpdates;return route.fulfill({status:201,json:{subscribed:true}});
    }
    return route.fulfill({json:{available:true,publicKey:'AQID',deviceSubscribed:true,confirmationUpdates:enabled,hostUpdates:enabled}});
  });
  await page.goto('/my-nights');const card=page.getByRole('complementary',{name:'Event notifications'});
  await expect(card.getByRole('button',{name:'Enable event alerts'})).toBeVisible();
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(60);
  expect((await new AxeBuilder({page}).include('.event-alert-nudge').analyze()).violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('confirmation-compact.png'),fullPage:true});
  await card.getByRole('button',{name:'Enable event alerts'}).click();
  await expect(card.getByRole('status')).toHaveText('Could not save. Try again.');
  await expect(card.getByRole('button',{name:'Turn off on this device'})).toHaveCount(0);
  await card.getByRole('button',{name:'Enable event alerts'}).click();
  await expect(card).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('confirmation-enabled.png'),fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:'My Nights',exact:true})).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.goto('/notifications');
  await openNotificationDetails(page.locator('.notification-device-settings > summary'));
  await expect(card.getByRole('button',{name:'Turn off on this device'})).toBeVisible();
  await card.getByRole('button',{name:'Turn off on this device'}).click();
  await expect(card.getByRole('button',{name:'Enable event alerts'})).toBeVisible();expect(enabled).toBe(false);
  expect((await new AxeBuilder({page}).include('.confirmation-notifications').analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto('/my-nights');await expect(card.getByRole('button',{name:'Enable event alerts'})).toBeVisible();
});
test('iPhone installation stays optional and never blocks access to My Nights',async({page})=>{
  await member(page);
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 iPhone Safari'});
    Object.defineProperty(navigator,'standalone',{configurable:true,value:false});
  });
  await page.goto('/my-nights');const card=page.getByRole('complementary',{name:'Event notifications'});
  await expect(page.getByRole('heading',{name:'My Nights',exact:true})).toBeVisible();
  await expect(card.locator('summary')).toBeVisible();expect((await card.boundingBox())!.height).toBeLessThanOrEqual(60);
  await openNotificationDetails(card.locator('summary'));await expect(card.getByText(/Share → Add to Home Screen/)).toBeVisible();await expect(card).toContainText('This is optional.');
  await expect(card.getByRole('button',{name:'Enable event alerts'})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('confirmation-iphone-optional.png'),fullPage:true});
  expect((await new AxeBuilder({page}).include('.event-alert-nudge').analyze()).violations).toEqual([]);
});
test('declined notification permission leaves booking access available',async({page})=>{
  await member(page);await phone(page,'denied');await page.goto('/my-nights');
  const card=page.getByRole('complementary',{name:'Event notifications'});
  await openNotificationDetails(card.locator('summary'));await expect(card.getByText(/Alerts are blocked/)).toBeVisible();await expect(card.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => Notification.permission)).toBe('denied');
  expect(await page.evaluate(() => (window as unknown as { notificationPermissionRequests: number }).notificationPermissionRequests)).toBe(0);
  await expect(page.getByRole('heading',{name:'My Nights',exact:true})).toBeVisible();
});


test('host announcements have a dedicated inbox filter and point straight to the Room update',async({page})=>{
  await member(page);
  const now=new Date().toISOString();
  await page.route('**/api/customer/notifications',route=>route.fulfill({json:{unread:2,notifications:[
    {id:'host',eventTitle:'Garden Party',kind:'host_update',title:'Host announcement · Garden Party',body:'Use the garden entrance.',url:'/room/garden-party?from=notification&announcement=host-1',createdAt:now,readAt:null},
    {id:'chat',eventTitle:'Garden Party',kind:'room_message',title:'Kofi is in The Room',body:'Who is coming?',url:'/room/garden-party',createdAt:now,readAt:null},
  ]}}));
  await page.goto('/notifications');
  await page.getByRole('button',{name:'Host updates',exact:true}).click();
  await expect(page.locator('.buzz-row')).toHaveCount(1);
  await expect(page.getByRole('link',{name:/Host announcement · Garden Party/})).toHaveAttribute('href','/room/garden-party?from=notification&announcement=host-1');
  await expect(page.locator('.buzz-row header')).toContainText('Host announcement · Garden Party');
  expect((await new AxeBuilder({page}).include('.notification-feed').analyze()).violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('host-announcement-inbox.png'),fullPage:true});
});
