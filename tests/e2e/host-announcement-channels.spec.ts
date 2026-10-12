import {test as base,expect,type Page} from './analytics-fixture';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
const test=base.extend<{announcementPageErrors:void}>({
 announcementPageErrors:[async({page},use)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  await use();
  expect(errors,'Synthetic announcement fixture page errors').toEqual([]);
 },{auto:true}],
});
let script:string;
test.beforeAll(async()=>{
 // Shared buttons import next/link; this isolated bundle has no framework env replacement.
 // Use empty build-time flags, never the runner's environment or a browser process shim.
 const result=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Composer from './app/announcement-composer';createRoot(document.getElementById('root')).render(<Composer eventSlug='test-night'/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env':'{}'}});
 script=result.outputFiles[0].text;
});
async function fixture(page:Page,allowed=true){
 await page.route('**/api/**',route=>route.fulfill({status:401,json:{error:'Isolated announcement fixture'}}));
 await page.route('**/api/admin/campaigns?**',route=>route.fulfill({json:{canPostPhoneUpdates:allowed,phoneAlertsAvailable:true,configured:true,subscribed:12,synced:12,state:{status:'ready',contactCount:12,reservedCount:12,checkedAt:new Date().toISOString(),error:null},campaigns:[],event:{title:'Test Night'}}}));
 const css=readFileSync('app/globals.css','utf8')+'\n'+readFileSync('app/organizer/workspace/suite.css','utf8');
 await page.route('**/__host_announcement_fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="organizer-suite"><div class="suite-content" id="root"></div></main><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`}));
 await page.goto('/__host_announcement_fixture');
}
test('phone and email keep separate drafts and send only the selected channel',async({page},info)=>{
 await fixture(page);
 let phoneSends=0,emailSends=0;
 await page.route('**/api/organizer/workspace',route=>{phoneSends++;return route.fulfill({json:{announced:true,messageId:'announcement-one'}});});
 await page.route('**/api/admin/campaigns',route=>{emailSends++;return route.fulfill({json:{html:'<p>Email draft</p>',recipients:12}});});
 // The segmented control uses pressed buttons, not tabs or nested navigation.
 const phone=page.getByRole('button',{name:'Phone & in-app',exact:true}),email=page.getByRole('button',{name:'Email',exact:true});
 await expect(phone).toHaveAttribute('aria-pressed','true');
 await page.getByRole('textbox',{name:'Host update',exact:true}).fill('Garden entrance at eight.');
 await email.click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Email-only subject');
 await page.getByRole('textbox',{name:'Announcement',exact:true}).fill('This longer email stays in its own draft.');
 await phone.click();await expect(page.getByRole('textbox',{name:'Host update',exact:true})).toHaveValue('Garden entrance at eight.');
 await page.getByRole('button',{name:'Preview phone update',exact:true}).click();
 expect(phoneSends).toBe(0);expect(emailSends).toBe(0);
 await page.getByRole('button',{name:'Edit phone update',exact:true}).click();await expect(page.getByRole('textbox',{name:'Host update',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Preview phone update',exact:true}).click();
 await page.getByRole('button',{name:'Post phone update',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Posted to The Room');
 expect(phoneSends).toBe(1);expect(emailSends).toBe(0);
 await email.click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Email-only subject');
 await expect(page.getByRole('textbox',{name:'Announcement',exact:true})).toHaveValue('This longer email stays in its own draft.');
 await phone.click();await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('host-announcement-phone.png')});
});
test('uncertain response retries one immutable submission and disables both channels while posting',async({page})=>{
 await fixture(page);const sends:unknown[]=[];
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/organizer/workspace',async route=>{
  sends.push(route.request().postDataJSON());
  if(sends.length===1){await pending;return route.fulfill({status:503,json:{error:'Connection lost. Retry the same update.'}});}
  return route.fulfill({json:{announced:true,messageId:'same-announcement'}});
 });
 await page.getByRole('textbox',{name:'Host update',exact:true}).fill('Keep this exact update.');
 await page.getByRole('button',{name:'Preview phone update',exact:true}).click();
 await page.getByRole('button',{name:'Post phone update',exact:true}).click();
 await expect(page.getByRole('button',{name:'Email',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Phone & in-app',exact:true})).toBeDisabled();
 release();await expect(page.getByRole('button',{name:'Retry phone update',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Edit phone update',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox',{name:'Host update',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Retry phone update',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Posted to The Room');
 expect(sends).toHaveLength(2);expect(sends[0]).toEqual(sends[1]);
});
test('email-only roles cannot submit phone announcements',async({page})=>{
 await fixture(page,false);
 await expect(page.getByRole('status')).toContainText('require host access');
 await page.getByRole('textbox',{name:'Host update',exact:true}).fill('This cannot be submitted.');
 await expect(page.getByRole('button',{name:'Preview phone update',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toBeVisible();
});
