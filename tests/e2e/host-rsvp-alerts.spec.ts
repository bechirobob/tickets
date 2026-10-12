import { test, expect, type Page } from './analytics-fixture';
import { build } from 'esbuild';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let script:string;
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Alerts from './app/organizer/workspace/host-rsvp-alerts';createRoot(document.getElementById('root')).render(<Alerts owner={new URL(location.href).searchParams.has('owner')} accountId={new URL(location.href).searchParams.get('account')||'host-one'} mode={new URL(location.href).searchParams.has('prompt')?'prompt':'settings'}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 script=result.outputFiles[0].text;
});
async function fixture(page:Page,mode:'ready'|'denied'|'ios'|'ios-no-push'|'granted'|'registration-fails'|'unsupported'='ready'){
 await page.addInitScript(({mode})=>{
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:mode.startsWith('ios')?'iPhone':'Android Chrome'});
  Object.defineProperty(navigator,'platform',{configurable:true,value:mode.startsWith('ios')?'iPhone':'Linux'});
  Object.defineProperty(window,'Notification',{configurable:true,value:{permission:mode==='denied'?'denied':mode==='granted'?'granted':'default',requestPermission:async()=>{sessionStorage.setItem('permission-requests',String(Number(sessionStorage.getItem('permission-requests')||0)+1));Object.defineProperty(window.Notification,'permission',{value:'granted',configurable:true});return 'granted';}}});
  Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
  if(mode==='unsupported')Reflect.deleteProperty(window,'PushManager');
  if(mode==='ios-no-push'){Reflect.deleteProperty(window,'Notification');Reflect.deleteProperty(window,'PushManager');}
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{auth:'fixture',p256dh:'fixture'}})};
  const worker={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>{if(mode==='registration-fails'&&!sessionStorage.getItem('registration-failed')){sessionStorage.setItem('registration-failed','1');throw new Error('Offline');}return worker;},ready:Promise.resolve(worker)}});
 },{mode});
 const css=readFileSync(resolve('app/organizer/workspace/host-rsvp-alerts.css'),'utf8')+readFileSync(resolve('app/organizer/workspace/suite.css'),'utf8');
 await page.route('**/__host_rsvp_fixture**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui;background:#fff;color:#241729}${css}</style></head><body><main class="organizer-suite"><div class="suite-content" id="root"></div></main><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`}));
}
test('host device opt-in waits for save, retries failure, persists and turns off',async({page},info)=>{
 await fixture(page);let saved=false,attempts=0,deleted=0;
 await page.route('**/api/organizer/notifications/subscription**',route=>{
  if(route.request().method()==='POST'){attempts++;if(attempts===1)return route.fulfill({status:503,json:{error:'Could not save. Try again.'}});saved=true;return route.fulfill({json:{deviceSubscribed:true}});}
  if(route.request().method()==='DELETE'){deleted++;saved=false;return route.fulfill({json:{deviceSubscribed:false}});}
  return route.fulfill({json:{available:true,deviceSubscribed:saved,publicKey:'AQID'}});
 });
 await page.goto('/__host_rsvp_fixture');
 await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();expect(attempts).toBe(0);
 await page.getByRole('button',{name:'Enable notifications'}).click();await expect(page.getByRole('status')).toHaveText('Could not save. Try again.');await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
 await page.getByRole('button',{name:'Enable notifications'}).click();await expect(page.getByRole('status')).toHaveText('Host notifications are on for this device.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:info.outputPath('host-rsvp-alerts.png'),fullPage:true});
 await page.reload();await expect(page.getByRole('button',{name:'Turn off host notifications'})).toBeVisible();
 await page.getByRole('button',{name:'Turn off host notifications'}).click();await expect(page.getByRole('status')).toHaveText('Host notifications are off for this device.');expect(deleted).toBe(1);
});
test('blocked notification permission does not subscribe',async({page})=>{
 await fixture(page,'denied');await page.route('**/api/organizer/notifications/subscription**',route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});});
 await page.goto('/__host_rsvp_fixture');await expect(page.getByText(/Notifications are blocked/)).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0);
});
test('iPhone browser explains Home Screen setup without prompting',async({page})=>{
 await fixture(page,'ios');await page.goto('/__host_rsvp_fixture');await expect(page.getByText(/add Tickets to your Home Screen/)).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0);
});

test('iPhone outside Home Screen still explains installation when push APIs are absent',async({page})=>{
 await fixture(page,'ios-no-push');await page.goto('/__host_rsvp_fixture');
 await expect(page.getByText(/add Tickets to your Home Screen/)).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0);
});

for(const mode of ['ready','granted','denied','ios-no-push'] as const){
 test(`first-login prompt is optional and remembered for each account: ${mode}`,async({page})=>{
  await fixture(page,mode);let saves=0;
  await page.route('**/api/organizer/notifications/subscription**',route=>{if(route.request().method()==='POST')saves++;return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});});
  await page.goto('/__host_rsvp_fixture?prompt=1');
  await expect(page.getByRole('dialog',{name:'Host notifications'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();expect(saves).toBe(0);
  if(mode==='denied')await expect(page.getByText(/Notifications are blocked/)).toBeVisible();
  if(mode==='ios-no-push')await expect(page.getByText(/add Tickets to your Home Screen/)).toBeVisible();
  await page.getByRole('button',{name:'Not now'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/__host_rsvp_fixture?prompt=1&account=host-two');await expect(page.getByRole('dialog')).toBeVisible();
  await page.goto('/__host_rsvp_fixture');await expect(page.getByRole('heading',{name:'Ticket & RSVP notifications'})).toBeVisible();
 });
}
test('prompt asks permission only after Enable and saves once',async({page})=>{
 await fixture(page);let saved=false,saves=0;
 await page.route('**/api/organizer/notifications/subscription**',route=>{if(route.request().method()==='POST'){saved=true;saves++;}return route.fulfill({json:{available:true,deviceSubscribed:saved,publicKey:'AQID'}});});
 await page.goto('/__host_rsvp_fixture?prompt=1');await expect(page.getByRole('dialog')).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
 await page.getByRole('button',{name:'Enable notifications'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(saves).toBe(1);expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBe('1');
 await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto('/__host_rsvp_fixture');await expect(page.getByRole('button',{name:'Turn off host notifications'})).toBeVisible();
});

for(const failure of ['registration','config'] as const){
 test(`initial ${failure} failure exposes a permission-free retry`,async({page})=>{
  await fixture(page,failure==='registration'?'registration-fails':'ready');let reads=0;
  await page.route('**/api/organizer/notifications/subscription**',route=>{
   expect(route.request().method()).toBe('GET');reads++;
   if(failure==='config'&&reads===1)return route.fulfill({status:503,json:{error:'Offline'}});
   return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});
  });
  await page.goto('/__host_rsvp_fixture?prompt=1');
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByText(/unavailable right now/)).toBeVisible();
  await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('bct:host-notifications:choice:v1:host-one'))).toBeNull();
 });
}

test('Not now during a pending retry survives late completion and focus',async({page})=>{
 await fixture(page);let reads=0;let finish:()=>void=()=>{};
 await page.route('**/api/organizer/notifications/subscription**',async route=>{
  expect(route.request().method()).toBe('GET');reads++;
  if(reads===1)return route.fulfill({status:503,json:{error:'Offline'}});
  await new Promise<void>(resolve=>{finish=resolve;});
  return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});
 });
 await page.goto('/__host_rsvp_fixture?prompt=1');await page.getByRole('button',{name:'Try again'}).click();
 await expect(page.getByText('Checking this device…')).toBeVisible();await expect.poll(()=>reads).toBe(2);
 await page.getByRole('button',{name:'Not now'}).click();
 const response=page.waitForResponse(url=>url.url().includes('/notifications/subscription'));finish();await response;
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(reads).toBe(2);expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
});

test('already subscribed device stays hidden without requesting permission',async({page})=>{
 await fixture(page,'granted');
 await page.route('**/api/organizer/notifications/subscription**',route=>{
  expect(route.request().method()).toBe('GET');return route.fulfill({json:{available:true,deviceSubscribed:true,publicKey:'AQID'}});
 });
 await page.goto('/__host_rsvp_fixture?prompt=1');
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('bct:host-notifications:choice:v1:host-one'))).toBe('seen');
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
});

test('unsupported browser keeps honest guidance without retry or permission',async({page})=>{
 await fixture(page,'unsupported');await page.goto('/__host_rsvp_fixture?prompt=1');
 await expect(page.getByText(/does not support phone alerts/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Try again'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Enable notifications'})).toHaveCount(0);
 expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
});

test('Account settings can retry after a previous prompt dismissal',async({page})=>{
 await fixture(page,'registration-fails');
 await page.addInitScript(()=>localStorage.setItem('bct:host-notifications:choice:v1:host-one','seen'));
 await page.route('**/api/organizer/notifications/subscription**',route=>{
  expect(route.request().method()).toBe('GET');return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});
 });
 await page.goto('/__host_rsvp_fixture');await page.getByRole('button',{name:'Try again'}).click();
 await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
});

test('owner choice and device subscription are shared across workspace entries',async({page},info)=>{
 await fixture(page);let subscribed=false,saves=0,removes=0;
 await page.route('**/api/organizer/notifications/subscription**',route=>{
  if(route.request().method()==='POST'){subscribed=true;saves++;}
  if(route.request().method()==='DELETE'){subscribed=false;removes++;}
  return route.fulfill({json:{available:true,deviceSubscribed:subscribed,publicKey:'AQID'}});
 });
 const entry='/__host_rsvp_fixture?owner=1&account=owner-one';
 await page.goto(entry+'&prompt=1&workspace=operations');
 await expect(page.getByText(/across all events/)).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();
 await page.getByRole('button',{name:'Not now'}).click();
 await page.goto(entry+'&prompt=1&workspace=organizer');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto(entry+'&workspace=organizer-account');
 await page.getByRole('button',{name:'Enable notifications'}).click();await expect.poll(()=>saves).toBe(1);
 await expect(page.getByRole('button',{name:'Turn off host notifications'})).toBeVisible();
 await page.goto(entry+'&workspace=operations-account');
 await expect(page.getByRole('button',{name:'Turn off host notifications'})).toBeVisible();expect(saves).toBe(1);
 await page.getByRole('button',{name:'Turn off host notifications'}).click();await expect.poll(()=>removes).toBe(1);
 await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();
 await page.goto(entry+'&prompt=1&workspace=operations');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.goto(entry+'&workspace=organizer-account');await expect(page.getByRole('button',{name:'Enable notifications'})).toBeVisible();expect(saves).toBe(1);
 await page.screenshot({path:info.outputPath('owner-shared-notification-settings.png'),fullPage:true});
});

test('owner prompt explains scope and opt-in stays off before a tap',async({page},info)=>{
 await fixture(page);let saves=0;
 await page.route('**/api/organizer/notifications/subscription**',route=>{
  if(route.request().method()==='POST')saves++;
  return route.fulfill({json:{available:true,deviceSubscribed:false,publicKey:'AQID'}});
 });
 await page.goto('/__host_rsvp_fixture?owner=1&account=owner-one&prompt=1');
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByText(/across all events/)).toBeVisible();
 expect(await page.evaluate(()=>sessionStorage.getItem('permission-requests'))).toBeNull();expect(saves).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const enable=page.getByRole('button',{name:'Enable notifications',exact:true});
 await enable.hover();
 await expect(enable).toHaveCSS('background-color','rgb(59, 41, 66)');
 await expect(enable).toHaveCSS('color','rgb(255, 255, 255)');
 expect((await new AxeBuilder({page}).include('.host-notification-prompt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath('owner-notification-prompt.png'),fullPage:true});
});
