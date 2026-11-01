import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFile} from 'node:fs/promises';
const out='docs/boardui-integration/evidence',origin='http://127.0.0.1:8795';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const result={browser:browser.version(),errors:[],scenarios:[],limits:'Real source client components with mocked HTTP contracts. Separate Worker tests exercise authorization/API/database. Not browser-to-database or real Safari/iPhone evidence.'};
const event={slug:'fixture-night',title:'Fictional Friday',startsAt:'2026-11-13T20:00:00Z',endsAt:'2026-11-14T05:00:00Z',status:'published',eventState:'on_sale',venue:'Fictional Courtyard',area:'Accra',capacity:200,isLead:1,pendingRequests:0,admissions:60,arrivals:2,salesMinor:10000};
try{
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,740]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:name!=='desktop',isMobile:name!=='desktop',serviceWorkers:'block'});
  let failYorke=false,failDetails=false; const writes=[],reads=[];
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()); if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   reads.push(url.pathname+url.search);
   if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort();}
   if(url.pathname==='/api/admin/yorkeway-audience'){
    if(failYorke)return route.fulfill({status:503,json:{error:'Synthetic network failure'}});
    const q=url.searchParams.get('q')||'',next=Boolean(url.searchParams.get('after'));
    if(q==='slow')await new Promise(resolve=>setTimeout(resolve,450));
    const rows=q==='missing'?[]:Array.from({length:q?1:25},(_,i)=>({name:q?`Result ${q}`:`Fictional subscriber ${i+1}`,email:q?`${q}@example.test`:`person${next?i+26:i+1}@example.test`,consentedAt:'2026-10-26T11:00:00Z',consentVersion:'yorkeway-year-end-2026-v1'}));
    return route.fulfill({json:{contacts:rows,summary:{subscribed:60,withdrawn:3},matching:q==='missing'?0:q?1:60,nextCursor:next||q?null:'person25@example.test',emailOwnershipVerified:false,deliveryEnabled:false}});
   }
   const section=url.searchParams.get('section');
   if(section==='events')return route.fulfill({json:{events:[event,...Array.from({length:25},(_,i)=>({...event,slug:`other-${i}`,title:`Another event ${i}`}))]}});
   if(section==='guests'){
    const show=url.searchParams.get('show')==='1'||url.searchParams.get('q'),offset=Number(url.searchParams.get('offset')),q=url.searchParams.get('q');
    if(q)await new Promise(resolve=>setTimeout(resolve,180));
    const rows=show?Array.from({length:q?1:25},(_,i)=>({id:String(i+offset),kind:'order',name:q?'Fictional matched guest':`Fictional guest ${i+offset+1}`,email:`guest${i+offset+1}@example.test`,reference:`BOOK-${i+offset}`,status:'paid',admissions:1,arrivals:0,amountMinor:15000,source:'paid_ticket'})):[];
    return route.fulfill({json:{counts:{records:q?1:60,admissions:60,arrivals:2},rows}});
   }
   if(section==='guest_detail'){
    if(failDetails)return route.fulfill({status:503,json:{error:'Synthetic details failure'}});
    return route.fulfill({json:{financialScope:'tickets',canRequestRefund:false,record:{name:'Fictional guest',email:'guest@example.test',reference:'BOOK-25',status:'paid',arrivals:0,admissions:1,amountMinor:15000,source:'paid_ticket'},orderId:'fixture-order',tickets:[],delivery:[],confirmation:null,questions:[]}});
   }
   return route.fulfill({json:{events:[],rooms:[],submissions:[]}});
  });
  const page=await context.newPage();page.on('pageerror',error=>result.errors.push({name,message:error.message}));
  const activate=locator=>name==='desktop'?locator.click():locator.tap();
  const layout=async()=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.bui-table button').evaluateAll(buttons=>buttons.every(button=>{const box=button.getBoundingClientRect(),cell=button.closest('td').getBoundingClientRect();return box.height>=44&&box.right<=cell.right&&box.left>=cell.left;}))).toBe(true);};
  const axe=async()=>expect((await new AxeBuilder({page}).include('.workspace-boardui').analyze()).violations).toEqual([]);
  await page.goto(origin+'/organizer/workspace?area=overview');
  await expect(page.getByRole('button',{name:'Manage event',exact:true})).toHaveCount(25);
  await activate(page.getByRole('button',{name:'Next',exact:true}));await expect(page.getByRole('button',{name:'Manage event',exact:true})).toHaveCount(1);
  await page.getByLabel('Find an event').fill('missing');await expect(page.getByText('No events match your search.')).toBeVisible();
  await page.getByLabel('Find an event').fill('Friday');await expect(page.getByRole('button',{name:'Manage event',exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${name}-events.png`,fullPage:true});await layout();
  await page.goto(origin+'/organizer/workspace?area=events&event=fixture-night&view=guests');
  await expect(page.getByRole('button',{name:'View guests',exact:true})).toBeVisible();
  expect(reads.some(url=>url.includes('section=guests')&&url.includes('show=0'))).toBe(true);
  await activate(page.getByRole('button',{name:'View guests',exact:true}));
  await expect(page.getByRole('button',{name:'Open record for Fictional guest 1',exact:true})).toBeVisible();
  await activate(page.getByRole('button',{name:'Next',exact:true}));
  const trigger=page.getByRole('button',{name:'Open record for Fictional guest 26',exact:true});await expect(trigger).toBeVisible();
  await layout();await axe();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${name}-guests.png`,fullPage:true});
  for(const close of ['Close record','Escape','Close record']){
   await activate(trigger);const dialog=page.getByRole('dialog',{name:'Guest record'});await expect(dialog.getByText(/150\.00/)).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Resend access'})).toHaveCount(0);
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${name}-record.png`});await axe();
   if(close==='Escape')await page.keyboard.press('Escape');else await activate(dialog.getByRole('button',{name:close}));
   await expect(trigger).toBeFocused();await expect(page.getByText('26–50 of 60')).toBeVisible();
  }
  if(name!=='desktop'){ await activate(trigger); await page.waitForFunction(()=>Boolean(history.state?.becoreLayer)); await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(trigger).toBeFocused(); }
  failDetails=true;await activate(trigger);await expect(page.getByText('Synthetic details failure')).toBeVisible();failDetails=false;await activate(page.getByRole('button',{name:'Try again',exact:true}));await expect(page.getByRole('dialog').getByText(/150\.00/)).toBeVisible();await page.keyboard.press('Escape');
  await page.getByLabel('Find a guest').pressSequentially('matched',{delay:35});await expect(page.getByLabel('Find a guest')).toHaveValue('matched');await expect(page.getByLabel('Find a guest')).toBeFocused();await expect(page.locator('.suite-pagination:visible').getByText('1–1 of 1')).toBeVisible();
  await page.goto(origin+'/admin/yorkeway-audience');await expect(page.getByText('60 matching subscribers · Page 1')).toBeVisible();await layout();await axe();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${name}-yorke.png`,fullPage:true});
  const contact=page.getByRole('button',{name:'View Fictional subscriber 1',exact:true});await activate(contact);await expect(page.getByRole('dialog')).toContainText('yorkeway-year-end-2026-v1');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close subscriber'})).toBeFocused();await page.keyboard.press('Escape');await expect(contact).toBeFocused();
  await activate(page.getByRole('button',{name:'Next',exact:true}));await expect(page.getByText('60 matching subscribers · Page 2')).toBeVisible();
  await page.getByLabel('Search subscribers').fill('slow');await page.waitForTimeout(220);await page.getByLabel('Search subscribers').fill('latest');await expect(page.getByText('Result latest', {exact:true})).toBeVisible();await page.waitForTimeout(500);await expect(page.getByText('Result slow', {exact:true})).toHaveCount(0);await expect(page.getByText('1 matching subscribers · Page 1')).toBeVisible();
  await page.getByLabel('Search subscribers').fill('missing');await expect(page.getByText('No subscribers match this view.')).toBeVisible();
  failYorke=true;await activate(page.getByRole('button',{name:'Refresh',exact:true}));await expect(page.getByText('Synthetic network failure')).toBeVisible();failYorke=false;await activate(page.getByRole('button',{name:'Try again',exact:true}));await expect(page.getByText('No subscribers match this view.')).toBeVisible();
  expect(writes).toEqual([]);result.scenarios.push({name,width,height,passed:true,mutationRequests:writes});await context.close();
 }
 expect(result.errors).toEqual([]);
}finally{await writeFile(`${out}/browser-results.json`,JSON.stringify(result,null,2));await browser.close();}
console.log('Source-component integration journeys passed.');
