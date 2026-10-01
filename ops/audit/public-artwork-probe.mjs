// Read-only diagnostic. Loads only two existing public artwork URLs and a local fixture.
// No browser security switches, credentials, storage state, or response overrides.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = resolve(process.env.TICKETS_SOURCE ?? 'tickets-full-audit');
const out = resolve(process.env.PROBE_OUT ?? 'artwork-probe-evidence');
const base = 'https://tickets.becoreops.com';
const paths = ['/events/on-the-guest-list.webp', '/hosts/kofi-bills.webp'];
const require = createRequire(resolve(source, 'package.json'));
const { chromium, devices, request } = require('playwright');
const allow = new Set(['content-type','content-length','cross-origin-resource-policy','cross-origin-embedder-policy','cross-origin-opener-policy','content-security-policy','cache-control','age','cf-cache-status','cf-ray','etag','last-modified','vary','date','server','access-control-allow-origin','access-control-allow-credentials','access-control-allow-headers','x-content-type-options','referrer-policy']);
const headers = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([k]) => allow.has(k.toLowerCase())).map(([k,v]) => [k.toLowerCase(), String(v).replace(/'nonce-[^']+'/g, "'nonce-[redacted]'").slice(0,4096)]));
const safeURL = raw => { try { const u = new URL(raw); return u.origin === base && paths.includes(u.pathname) ? u.pathname + (u.searchParams.has('__tickets_policy_probe') ? '?__tickets_policy_probe=[diagnostic]' : '') : null; } catch { return null; } };
const netError = raw => String(raw ?? '').match(/net::[A-Za-z0-9_.-]+/)?.[0] ?? 'Unclassified browser failure';
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding:'utf8' }).trim();
const sourceBefore = { head:git('rev-parse','HEAD'), tree:git('rev-parse','HEAD^{tree}'), status:git('status','--porcelain','--untracked-files=no') };
if (sourceBefore.tree !== '51004be28aeae024e286f50b8ddb8c76690db246' || sourceBefore.status) throw new Error('Unexpected or modified frozen source tree');
await mkdir(out, { recursive:true });
const evidence = { schema:1, capturedAt:new Date().toISOString(), sourceBefore, playwright:require('playwright/package.json').version, scope:'Two public images; six fresh Chromium contexts; no browser security overrides; no credentials or raw headers persisted', limitation:'Routing disables browser HTTP cache. ordinary-browser is the unrouted control. Cache-busted success cannot replace canonical success.', direct:[], browser:[], liveIdentity:[] };
const verifyLive = async phase => {
  const expected = '473bbf40afe1a77a722c8399f91c4dd95f3e40ce';
  const observation = { phase, checkedAt:new Date().toISOString(), endpoints:[] };
  evidence.liveIdentity.push(observation);
  const read = async path => {
    const response = await fetch(base + path, { headers:{Accept:'application/json','Cache-Control':'no-cache'}, redirect:'error', signal:AbortSignal.timeout(15000) });
    const item = { path, status:response.status };
    observation.endpoints.push(item);
    if(response.status !== 200)throw new Error('Identity endpoint status mismatch');
    const reader=response.body.getReader();
    const chunks=[];let size=0;
    try {
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new Error('Identity response exceeds bound');}chunks.push(value);}
    } finally { reader.releaseLock(); }
    const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    item.service=parsed.service==='becore-tickets'?'becore-tickets':'[unexpected]';
    item.revision=/^[a-f0-9]{40}$/.test(parsed.revision??'')?parsed.revision:'[unexpected]';
    if(path==='/healthz'){item.runtime=parsed.runtime==='vps'?'vps':'[unexpected]';item.active=parsed.active===true;}
    return parsed;
  };
  const health=await read('/healthz'),version=await read('/api/version');
  observation.matchesExpected=health.service==='becore-tickets'&&version.service==='becore-tickets'&&health.runtime==='vps'&&health.active===true&&health.revision===expected&&version.revision===expected;
  if(!observation.matchesExpected)throw new Error('Live identity mismatch');
};
const variants = ['original-global','ordinary-browser','endpoint-scoped'];
const nonce = `audit-${Date.now()}`;
const urlsFor = variant => paths.map(p => base + p + (variant === 'diagnostic' ? `?__tickets_policy_probe=${nonce}` : ''));
const fixture = createServer((req, res) => {
  const variant = req.url === '/canonical' ? 'canonical' : req.url === '/diagnostic' ? 'diagnostic' : null;
  if (req.method !== 'GET' || !variant) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
  res.end(`<!doctype html><html lang="en"><title>Public artwork policy probe</title><body>${urlsFor(variant).map((u,i) => `<img src="${u}" alt="Public artwork ${i+1}" width="220">`).join('')}</body></html>`);
});
await new Promise((resolve, reject) => { fixture.once('error',reject); fixture.listen(0,'127.0.0.1',resolve); });
const loopback = `http://127.0.0.1:${fixture.address().port}`;
let browser;
try {
  await verifyLive('before');
  // Matches APIRequestContext traffic for each production project's browser UA.
  for (const device of ['Desktop Chrome','Pixel 7','iPhone 13']) {
    for (const globalHeader of [true,false]) {
      const api = await request.newContext({ userAgent:devices[device].userAgent, extraHTTPHeaders:globalHeader ? {'x-becore-analytics':'exclude'} : {}, timeout:15000, ignoreHTTPSErrors:false });
      try {
        for (const urlKind of ['canonical','diagnostic']) for (const url of urlsFor(urlKind)) {
          try {
            const response = await api.get(url, { maxRedirects:0, failOnStatusCode:false });
            evidence.direct.push({ device, globalHeader, urlKind, url:safeURL(url), status:response.status(), headers:headers(response.headers()) });
            await response.dispose();
          } catch (error) { evidence.direct.push({ device, globalHeader, urlKind, url:safeURL(url), failed:true, errorType:error.name ?? 'Error' }); }
        }
      } finally { await api.dispose(); }
    }
  }
  browser = await chromium.launch({ channel:'chromium', headless:true, timeout:30000 });
  evidence.browserVersion = browser.version();
  for (const variant of variants) for (const urlKind of ['canonical','diagnostic']) {
    const result = { variant, urlKind, routingEnabled:variant === 'endpoint-scoped', responses:[], requestFailures:[], cdp:[], consoleErrorCount:0, pageErrorCount:0, imageResults:[] };
    evidence.browser.push(result);
    const context = await browser.newContext({ ...devices['Desktop Chrome'], serviceWorkers:'block', extraHTTPHeaders:variant === 'original-global' ? {'x-becore-analytics':'exclude'} : {}, ignoreHTTPSErrors:false });
    try {
      if (variant === 'endpoint-scoped') await context.route(url => url.href === `${base}/api/analytics`, route => route.continue({ headers:{...route.request().headers(),'x-becore-analytics':'exclude'} }));
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const records = new Map();
      const record = id => { if (!records.has(id)) records.set(id, {}); return records.get(id); };
      cdp.on('Network.requestWillBeSent', e => { const r=record(e.requestId); r.url=safeURL(e.request.url); if (!r.url) return; r.resourceType=e.type; r.auditHeaderPresent=Object.keys(e.request.headers ?? {}).some(k=>k.toLowerCase()==='x-becore-analytics'); });
      cdp.on('Network.requestWillBeSentExtraInfo', e => { const r=record(e.requestId); r.requestPolicyHeaders=Object.fromEntries(Object.entries(e.headers ?? {}).filter(([k])=>['accept','cache-control','pragma','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','x-becore-analytics'].includes(k.toLowerCase())).map(([k,v])=>[k.toLowerCase(),String(v).slice(0,512)])); });
      cdp.on('Network.responseReceived', e => { const r=record(e.requestId); r.response={status:e.response.status,headers:headers(e.response.headers),fromDiskCache:!!e.response.fromDiskCache,fromServiceWorker:!!e.response.fromServiceWorker,protocol:e.response.protocol}; });
      cdp.on('Network.responseReceivedExtraInfo', e => { const r=record(e.requestId); r.extra={statusCode:e.statusCode,headers:headers(e.headers)}; if(e.headersText) r.extra.corpHeaderLines=e.headersText.split(/\r?\n/).filter(line=>/^cross-origin-resource-policy:/i.test(line)).map(line=>line.slice(0,256)); });
      cdp.on('Network.loadingFailed', e => { const r=record(e.requestId); r.failure={error:netError(e.errorText),blockedReason:e.blockedReason ?? null,corsError:e.corsErrorStatus?.corsError ?? null,cancelled:!!e.canceled}; });
      await cdp.send('Network.enable');
      const pending=[];
      page.on('response', response => { if (!safeURL(response.url())) return; pending.push(response.allHeaders().then(h=>result.responses.push({url:safeURL(response.url()),status:response.status(),headers:headers(h)})).catch(()=>{})); });
      page.on('requestfailed', req=>{if(safeURL(req.url()))result.requestFailures.push({url:safeURL(req.url()),error:netError(req.failure()?.errorText)});});
      page.on('console', msg=>{if(msg.type()==='error')result.consoleErrorCount++;});
      page.on('pageerror', ()=>result.pageErrorCount++);
      try {
        await page.goto(`${loopback}/${urlKind}`, { waitUntil:'load', timeout:15000 });
        await page.waitForFunction(()=>[...document.images].length===2 && [...document.images].every(i=>i.complete), undefined, { timeout:5000 });
      } catch (error) { result.navigationErrorType=error.name ?? 'Error'; }
      result.imageResults = await page.locator('img').evaluateAll(images=>images.map(i=>({complete:i.complete,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight}))).catch(()=>[]);
      await Promise.allSettled(pending);
      result.cdp = [...records.values()].filter(r=>r.url);
      result.canonicalGateCandidate = urlKind === 'canonical' && result.imageResults.length === 2 && result.imageResults.every(i=>i.complete&&i.naturalWidth>0);
      await cdp.detach();
    } catch (error) { result.contextErrorType=error.name ?? 'Error'; }
    finally { await context.close(); }
  }
} catch(error) { evidence.runnerErrorType=error.name ?? 'Error'; process.exitCode=1; }
finally {
  if(browser)await browser.close();
  fixture.closeAllConnections();
  await new Promise(resolve=>fixture.close(resolve));
  try { await verifyLive('after'); } catch(error) { evidence.liveIdentityAfterErrorType=error.name ?? 'Error'; process.exitCode=1; }
  evidence.sourceAfter={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=no')};
  evidence.sourceUnchanged=JSON.stringify(evidence.sourceBefore)===JSON.stringify(evidence.sourceAfter);
  await writeFile(resolve(out,'public-artwork-policy-probe.json'), JSON.stringify(evidence,null,2)+'\n');
  if(!evidence.sourceUnchanged)process.exitCode=1;
  console.log(JSON.stringify({output:'public-artwork-policy-probe.json',sourceUnchanged:evidence.sourceUnchanged,directSamples:evidence.direct.length,browserContexts:evidence.browser.length,runnerErrorType:evidence.runnerErrorType??null}));
}
