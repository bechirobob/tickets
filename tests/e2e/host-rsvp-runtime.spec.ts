import { test, expect } from './analytics-fixture';
import { readFileSync } from 'node:fs';

// Opt-in local runtime fixture only. This uses the built application, real auth,
// SQLite routes and production service worker; only the push-provider boundary
// is replaced. No subscription or notification is sent to an external provider.
const fixturePath = process.env.BECORE_HOST_PUSH_FIXTURE;
test('new host device saves through real API and active worker opens authenticated RSVP roster', async ({ page, context, baseURL, browserName }, info) => {
  test.skip(!fixturePath, 'Requires the isolated inactive VPS runtime and synthetic SQLite fixture.');
  test.skip(browserName !== 'chromium', 'Local worker-event injection is Chromium acceptance evidence.');
  expect(['127.0.0.1', 'localhost']).toContain(new URL(baseURL!).hostname);
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as {token:string;event:string};
  await context.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
  await context.grantPermissions(['notifications']);
  await context.addCookies([{name:'bct_staff',value:fixture.token,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
  await page.addInitScript(() => {
    const storedKey='isolated-host-push-subscription';
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/local-runtime-fixture',keys:{p256dh:btoa(String.fromCharCode(4)+'a'.repeat(64)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,''),auth:btoa('a'.repeat(16)).replace(/=+$/u,'')}};
    const result=()=>({...subscription,toJSON:()=>subscription});
    Object.defineProperty(PushManager.prototype,'getSubscription',{configurable:true,value:async()=>sessionStorage.getItem(storedKey)?result():null});
    Object.defineProperty(PushManager.prototype,'subscribe',{configurable:true,value:async(options:PushSubscriptionOptionsInit)=>{
      if(options.userVisibleOnly!==true || !(options.applicationServerKey instanceof Uint8Array) || options.applicationServerKey.byteLength!==65)throw new Error('Missing explicit subscription options');
      sessionStorage.setItem(storedKey,'created');sessionStorage.setItem('isolated-subscribe-count',String(Number(sessionStorage.getItem('isolated-subscribe-count')??0)+1));return result();
    }});
  });
  await page.goto('/organizer/workspace');
  const prompt=page.getByRole('dialog',{name:'Host notifications'});await expect(prompt).toBeVisible();
  await expect(page.getByRole('button',{name:'Enable notifications',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('isolated-subscribe-count'))).toBeNull();
  const save=page.waitForResponse(response=>response.url().includes('/api/organizer/notifications/subscription')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
  expect((await save).status()).toBe(200);
  await expect(prompt).toHaveCount(0);
  await page.goto('/organizer/workspace?area=account');
  expect(await page.evaluate(()=>sessionStorage.getItem('isolated-subscribe-count'))).toBe('1');
  await page.reload();await expect(page.getByRole('button',{name:'Turn off host notifications',exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>({state:(await navigator.serviceWorker.ready).active?.state,controlled:!!navigator.serviceWorker.controller}))).toEqual({state:'activated',controlled:true});
  const worker=context.serviceWorkers().find(worker=>new URL(worker.url()).pathname==='/sw.js');expect(worker).toBeTruthy();
  const destination=`/organizer/workspace?area=events&event=${fixture.event}&view=rsvp&tab=roster`;
  // Synthetic browser PushEvent exercises the unmodified installed worker's
  // display handler. It does not claim encryption/provider/OS delivery evidence.
  await worker!.evaluate(async ({destination})=>{
    const scope=globalThis as unknown as {dispatchEvent:(event:Event)=>boolean};
    const PushEventClass=(globalThis as unknown as {PushEvent:new(type:string,init:{data:string})=>Event}).PushEvent;
    scope.dispatchEvent(new PushEventClass('push',{data:JSON.stringify({kind:'organizer_rsvp',title:'Local RSVP Event',body:'A new RSVP is ready.',url:destination,tag:'isolated-host-rsvp'})}));
  },{destination});
  await expect.poll(()=>worker!.evaluate(async()=>{
    const registration=(globalThis as unknown as {registration:ServiceWorkerRegistration}).registration;
    return (await registration.getNotifications({tag:'isolated-host-rsvp'})).map(n=>({title:n.title,kind:n.data.kind,url:n.data.url}));
  })).toEqual([{title:'Local RSVP Event',kind:'organizer_rsvp',url:destination}]);
  // Dispatch a synthetic notificationclick on the actual browser Notification;
  // the production handler uses real clients.navigate/focus and live auth routes.
  await worker!.evaluate(async()=>{
    const scope=globalThis as unknown as {registration:ServiceWorkerRegistration;dispatchEvent:(event:Event)=>boolean;NotificationEvent:new(type:string,init:{notification:Notification})=>Event};
    const notification=(await scope.registration.getNotifications({tag:'isolated-host-rsvp'}))[0];
    scope.dispatchEvent(new scope.NotificationEvent('notificationclick',{notification}));
  });
  await expect(page).toHaveURL(baseURL+destination);
  await expect(page.getByRole('article').getByText('Local RSVP Guest',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('authenticated-rsvp-roster.png'),fullPage:true});
  const purchaseDestination=`/organizer/workspace?area=events&event=${fixture.event}&view=guests`;
  await worker!.evaluate(async({destination})=>{
    const scope=globalThis as unknown as {dispatchEvent:(event:Event)=>boolean;PushEvent:new(type:string,init:{data:string})=>Event};
    scope.dispatchEvent(new scope.PushEvent('push',{data:JSON.stringify({kind:'organizer_purchase',title:'Tickets purchased',body:'A ticket purchase is confirmed.',url:destination,tag:'isolated-host-purchase'})}));
  },{destination:purchaseDestination});
  await expect.poll(()=>worker!.evaluate(async()=>((globalThis as unknown as {registration:ServiceWorkerRegistration}).registration.getNotifications({tag:'isolated-host-purchase'})).then(list=>list.length))).toBe(1);
  await worker!.evaluate(async()=>{
    const scope=globalThis as unknown as {registration:ServiceWorkerRegistration;dispatchEvent:(event:Event)=>boolean;NotificationEvent:new(type:string,init:{notification:Notification})=>Event};
    scope.dispatchEvent(new scope.NotificationEvent('notificationclick',{notification:(await scope.registration.getNotifications({tag:'isolated-host-purchase'}))[0]}));
  });
  await expect(page).toHaveURL(baseURL+purchaseDestination);
  await expect(page.getByRole('dialog',{name:'Host notifications'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('authenticated-purchase-guests.png'),fullPage:true});
  await context.clearCookies();await page.reload();await expect(page).toHaveURL(/\/admin\/login\?/u);
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(purchaseDestination);
});
