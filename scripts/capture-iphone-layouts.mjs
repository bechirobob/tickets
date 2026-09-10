import { webkit, devices } from '../mobile/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.LAYOUT_OUTPUT || path.join(tmpdir(), 'becore-iphone-layouts');
await mkdir(out, {recursive:true});
const candidate = process.env.LAYOUT_CANDIDATE === '1';
const websiteOrigin = candidate ? 'http://127.0.0.1:8788' : 'https://tickets.becoreops.com';
const websiteServer = candidate ? spawn(process.execPath, [path.join(repo, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', 'dist/server/wrangler.json', '--port', '8788', '--local', '--persist-to', '.wrangler/state'], {cwd: repo, stdio: 'inherit'}) : null;
if (websiteServer) {
  process.on('exit', () => websiteServer.kill());
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(websiteOrigin + '/api/version')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  if (!ready) throw new Error('Candidate website did not start');
}
const webVersionResponse = await fetch(websiteOrigin + '/api/version' , {signal:AbortSignal.timeout(30000)});
if(!webVersionResponse.ok) throw new Error('Website release identity unavailable');
const webVersion = await webVersionResponse.json();
if(process.env.LAYOUT_WEB_SHA && webVersion.revision !== process.env.LAYOUT_WEB_SHA) throw new Error('Website capture does not match the deployed release');
const response = await fetch(websiteOrigin + '/api/public/events', {signal:AbortSignal.timeout(30000)});
if(!response.ok) throw new Error('Public catalogue unavailable');
const catalogue = await response.json();
if(!catalogue.screens || !catalogue.events?.length) throw new Error('No live events available for layout review');
const server = spawn(process.execPath, [path.join(repo,'mobile/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4174'], {cwd:path.join(repo,'mobile'),stdio:'inherit'});
for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4174')).ok)break;}catch{} await new Promise(r=>setTimeout(r,200));}
const browser = await webkit.launch();
const context = await browser.newContext({...devices['iPhone 13'], deviceScaleFactor:2, reducedMotion: 'reduce', serviceWorkers: 'block'});
const page = await context.newPage();
const origin = 'https://tickets.becoreops.com';
await page.route(`${origin}/api/public/events`, route => route.fulfill({json:catalogue,headers:{'access-control-allow-origin':'*'}}));
await page.route(`${origin}/events/*`, async route => {
  const name = path.basename(new URL(route.request().url()).pathname);
  await route.fulfill({body:await readFile(path.join(repo,'public/events',name)),contentType:name.endsWith('.webp')?'image/webp':'image/jpeg'});
});
const pages=[];
const parity=[];
const appSnapshots=new Map();
async function capture(title,kind='App screen',single=false) {
  await page.evaluate(async()=>{
    await document.fonts.ready;
    // Home artwork below the fold is lazy-loaded. Request it before decoding;
    // waiting for a deferred image without scrolling can otherwise never settle.
    const images=[...document.images];
    images.forEach(img=>{img.loading='eager'});
    await Promise.race([
      Promise.all(images.map(img=>img.decode().catch(()=>{}))),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Image loading timed out')),15000)),
    ]);
  });
  await page.waitForTimeout(250);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(overflow) throw new Error(`Horizontal clipping: ${title}`);
  const max=await page.evaluate(()=>Math.max(0,document.documentElement.scrollHeight-innerHeight));
  const positions=[0];
  const stride=Math.max(200, page.viewportSize().height-260);
  if(!single) {for(let y=stride;y<max;y+=stride)positions.push(y);if(max>0)positions.push(max);}
  const files=[];
  for(const [i,y] of positions.entries()) {
    await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(180);
    const file=`${String(pages.length+1).padStart(2,'0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${i+1}.png`;
    await page.screenshot({path:path.join(out,file)});files.push(file);
  }
  pages.push({title,kind,files,url:page.url()});
  const route = new URL(page.url()).pathname;
  if (['/', '/events', ...catalogue.events.map(event => '/event/' + event.slug)].includes(route)) {
    const snapshot = await page.evaluate(() => {
      const selector = 'main h1, .drop-card h3, .drop-card__schedule, .event-detail-facts, .event-story-content, .compact-ticket-panel, .event-detail-toolbar, .customer-dock';
      return [...document.querySelectorAll(selector)].map(element => {
        const style = getComputedStyle(element);
        return { tag: element.tagName, text: element.textContent.replace(/\s+/g, ' ').trim(), font: style.fontFamily, size: style.fontSize, color: style.color };
      });
    });
    if (kind === 'App screen') appSnapshots.set(route, snapshot);
    else if (kind === 'Mobile website' && appSnapshots.has(route)) {
      const match = JSON.stringify(appSnapshots.get(route)) === JSON.stringify(snapshot);
      parity.push({ route, match, app: appSnapshots.get(route), website: snapshot });
      await writeFile(path.join(out, 'parity.json'), JSON.stringify(parity, null, 2));
      if (!match) throw new Error(`App/browser screen mismatch: ${route}`);
    }
  }
  await writeFile(path.join(out,'screens.json'),JSON.stringify({capturedAt:new Date().toISOString(),websiteEnvironment:candidate?'candidate':'production',parity,catalogueUpdatedAt:catalogue.updatedAt,sourceCommit:process.env.LAYOUT_SOURCE_SHA||process.env.GITHUB_SHA||null,websiteCommit:webVersion.revision,viewport:page.viewportSize(),engine:'Playwright WebKit on macOS, iPhone 13 viewport',pages},null,2));
  console.log(`${title}: ${files.length} screenshots`);
  await page.evaluate(()=>scrollTo(0,0));
}
try {
  for (const [title, route] of [['Home', '/'], ['The Drop', '/events'], ...catalogue.events.map(event => [event.title, '/event/' + event.slug])]) {
    await page.goto('http://127.0.0.1:4174' + route);
    await page.locator('main:not(.catalogue-loading) h1').waitFor();
    await capture(title);
  }
  await page.goto('http://127.0.0.1:4174/events');
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await capture('Navigation menu','App state',true);
  await page.keyboard.press('Escape');
  await page.route(`${origin}/api/public/events`,route=>route.abort());
  await page.reload();await page.getByRole('alert').waitFor();
  await capture('Saved events offline','App state');
  await page.evaluate(()=>localStorage.clear());
  await page.reload();await page.getByRole('alert').waitFor();
  await capture('Connection unavailable','App state');
  await page.route(`${origin}/api/public/events`,route=>route.fulfill({json:{...catalogue,events:[],screens:[]},headers:{'access-control-allow-origin':'*'}}));
  await page.reload();await page.getByRole('heading',{name:'The next plan is still cooking.'}).waitFor();
  await capture('No events yet','App state');
  // Remove the simulated outage/empty response before checking the real website.
  await page.unroute(`${origin}/api/public/events`);
  for(const [title,route] of [['Website home','/'],['Website The Drop','/events'],['Help','/help'],['Privacy','/account/privacy'],['My Nights access','/my-nights'],['The Buzz access','/notifications'],...catalogue.events.map(event=>[event.title+' website', '/event/'+event.slug])]) {
    await page.goto(websiteOrigin+route,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    await capture(title,'Mobile website');
  }
} finally {await browser.close();server.kill();websiteServer?.kill();}
