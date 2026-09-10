import { webkit, devices } from '../mobile/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.LAYOUT_OUTPUT || path.join(tmpdir(), 'becore-iphone-layouts');
await mkdir(out, {recursive:true});
const response = await fetch('https://tickets.becoreops.com/api/public/events', {signal:AbortSignal.timeout(30000)});
if(!response.ok) throw new Error('Public catalogue unavailable');
const catalogue = await response.json();
if(!catalogue.events?.length) throw new Error('No live events available for layout review');
const server = spawn(process.execPath, [path.join(repo,'mobile/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4174'], {cwd:path.join(repo,'mobile'),stdio:'inherit'});
for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4174')).ok)break;}catch{} await new Promise(r=>setTimeout(r,200));}
const browser = await webkit.launch();
const context = await browser.newContext({...devices['iPhone 13'], deviceScaleFactor:2});
const page = await context.newPage();
const origin = 'https://tickets.becoreops.com';
await page.route(`${origin}/api/public/events`, route => route.fulfill({json:catalogue,headers:{'access-control-allow-origin':'*'}}));
await page.route(`${origin}/events/*`, async route => {
  const name = path.basename(new URL(route.request().url()).pathname);
  await route.fulfill({body:await readFile(path.join(repo,'public/events',name)),contentType:name.endsWith('.webp')?'image/webp':'image/jpeg'});
});
const pages=[];
async function capture(title,kind='App screen',single=false) {
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})))});
  await page.waitForTimeout(250);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow) throw new Error(`Horizontal clipping: ${title}`);
  const max=await page.evaluate(()=>Math.max(0,document.documentElement.scrollHeight-innerHeight));
  const positions=[0];
  if(!single) {for(let y=600;y<max;y+=600)positions.push(y);if(max>0)positions.push(max);}
  const files=[];
  for(const [i,y] of positions.entries()) {
    await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(180);
    const file=`${String(pages.length+1).padStart(2,'0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${i+1}.png`;
    await page.screenshot({path:path.join(out,file)});files.push(file);
  }
  pages.push({title,kind,files,url:page.url()});
  await writeFile(path.join(out,'screens.json'),JSON.stringify({capturedAt:new Date().toISOString(),catalogueUpdatedAt:catalogue.updatedAt,sourceCommit:process.env.GITHUB_SHA||null,viewport:page.viewportSize(),engine:'Playwright WebKit, iPhone 13 emulation',pages},null,2));
  console.log(`${title}: ${files.length} screenshots`);
  await page.evaluate(()=>scrollTo(0,0));
}
try {
  await page.goto('http://127.0.0.1:4174');
  await page.getByRole('heading',{name:catalogue.events[0].title,exact:true}).waitFor();
  await capture('The Drop');
  for(const event of catalogue.events) {
    await page.getByRole('heading',{name:event.title,exact:true}).click();
    await page.getByRole('heading',{level:1,name:event.title,exact:true}).waitFor();
    await capture(event.title);
    await page.getByRole('button',{name:'Back to The Drop',exact:true}).click();
  }
  for(const name of ['My Nights','The Buzz']) {
    await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('button',{name,exact:true}).click();
    await capture(name);
  }
  await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('button',{name:'The Drop',exact:true}).click();
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await capture('Navigation menu','App state',true);
  await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  await page.route(`${origin}/api/public/events`,route=>route.abort());
  await page.reload();await page.getByRole('alert').waitFor();
  await capture('Saved events offline','App state');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();await page.getByRole('alert').waitFor();
  await capture('Connection unavailable','App state');
  await page.route(`${origin}/api/public/events`,route=>route.fulfill({json:{...catalogue,events:[]},headers:{'access-control-allow-origin':'*'}}));
  await page.reload();await page.getByRole('heading',{name:'The next good plan is on its way.'}).waitFor();
  await capture('No events yet','App state');
  for(const [title,route] of [['Help','/help'],['Privacy','/account/privacy'],['My Nights access','/my-nights'],['The Buzz access','/notifications'],['Weekend Braai RSVP','/event/the-weekend-braai']]) {
    await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    await capture(title,'Secure browser destination');
  }
} finally {await browser.close();server.kill();}
