import { test, expect, type Page } from './analytics-fixture';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
let script:string;
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Alerts from './app/organizer/workspace/host-rsvp-alerts';createRoot(document.getElementById('root')).render(<Alerts accountId={new URL(location.href).searchParams.get('account')||'host-one'} mode={new URL(location.href).searchParams.has('prompt')?'prompt':'settings'}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
 script=result.outputFiles[0].text;
});
async function fixture(page:Page,mode:'ready'|'denied'|'ios'|'ios-no-push'|'granted'='ready'){
 await page.addInitScript(({mode})=>{
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:mode.startsWith('ios')?'iPhone':'Android Chrome'});
  Object.defineProperty(navigator,'platform',{configurable:true,value:mode.startsWith('ios')?'iPhone':'Linux'});
  Object.defineProperty(window,'Notification',{configurable:true,value:{permission:mode==='denied'?'denied':mode==='granted'?'granted':'default',requestPermission:async()=>{sessionStorage.setItem('permission-requests',String(Number(sessionStorage.getItem('permission-requests')||0)+1));Object.defineProperty(window.Notification,'permission',{value:'granted',configurable:true});return 'granted';}}});
  Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
  if(mode==='ios-no-push'){Reflect.deleteProperty(window,'Notification');Reflect.deleteProperty(window,'PushManager');}
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{auth:'fixture',p256dh:'fixture'}})};
  const worker={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}};
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>worker,ready:Promise.resolve(worker)}});
 },{mode});
 const css=readFileSync(resolve('app/organizer/workspace/suite.css'),'utf8');
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
