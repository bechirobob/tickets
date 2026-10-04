import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = await readFile(new URL('../app/scan/scanner.tsx',import.meta.url),'utf8');
const policy = transformSync(await readFile(new URL('../lib/scanner-manifest.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {beginGateAccess,clearGateManifests,saveGateManifest,readGateManifest}=await import(`data:text/javascript;base64,${Buffer.from(policy).toString('base64')}`);
const start=source.indexOf('const offlineCheck = useCallback(')+'const offlineCheck = useCallback('.length;
const callback=source.slice(start,source.indexOf(', [access, deviceId, eventSlug, saveQueue]);',start));
const compiled=transformSync(`const callback=${callback};`,{loader:'ts'}).code;

for(const change of ['none','logout','session switch','access denial','event switch']) test(`offline scanner rechecks ${change} after asynchronous QR hashing`,async()=>{
  const records=new Map(),storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
  const access={accountId:'synthetic-staff',sessionId:'synthetic-session',expiresAt:Math.floor(Date.now()/1000)+3600};
  const eventSlug='synthetic-event',token='AAAABBBBCCCCDDDD',hash=createHash('sha256').update(token).digest('hex');
  const list={eventSlug,access,generatedAt:new Date().toISOString(),tickets:[{ticketId:'synthetic-ticket',tokenHash:hash,ticketType:'general',status:'issued',attendeeName:'Synthetic guest'}]};
  beginGateAccess(storage,access);assert.equal(saveGateManifest(storage,access,list),true);
  let finishHash,mode='',saved=[];
  const gateAccessDenied={current:false},currentEvent={current:eventSlug};
  const scope={access,eventSlug,currentEvent,deviceId:'synthetic-device',gateAccessDenied,readGateManifest,window:{localStorage:storage},normalizeToken:()=>token,
    tokenHash:()=>new Promise(resolve=>{finishHash=resolve;}),readGateList:()=>[],QUEUE_KEY:'queue',GATE_REVIEW_KEY:'review',
    saveQueue:next=>{saved=next;},setMode:next=>{mode=next;},setMessage:()=>{},setTicket:()=>{},setStorageError:()=>{}};
  const run=new Function(...Object.keys(scope),`${compiled};return callback;`)(...Object.values(scope));
  const pending=run(`BCT-${token}`,'synthetic-scan');
  if(change==='logout')clearGateManifests(storage);
  if(change==='session switch')beginGateAccess(storage,{...access,sessionId:'new-session'});
  if(change==='access denial')gateAccessDenied.current=true;
  if(change==='event switch')currentEvent.current='other-event';
  finishHash(hash);await pending;
  assert.equal(mode,change==='none'?'offline_saved':change==='event switch'?'':'unavailable');
  assert.equal(saved.length,change==='none'?1:0);
});

test('every scanner gate response applies the shared authorization-denial latch',()=>{
  const blocks=[['const heartbeat','const loadEventState'],['const loadEventState','const syncQueue'],['const syncQueue','  useEffect'],['const checkTicket','  // The decoder'],['async function search','async function undo'],['async function undo','  return <main']];
  for(const [from,to] of blocks){const at=source.indexOf(from);assert.ok(at>=0);assert.match(source.slice(at,source.indexOf(to,at+from.length)),/denyGateAccess\(response\)/u,from);}
  assert.match(source,/beginGateAccess\(window\.localStorage, \{ accountId, sessionId, expiresAt \}\);[\s\S]*?\}, \[accountId, sessionId, expiresAt\]\);/u);
});
test('confirmed workspace logout invalidates offline gate lists',async()=>{
  const chrome=await readFile(new URL('../app/workspace-chrome.tsx',import.meta.url),'utf8');
  assert.match(chrome,/if \(response\.ok\) \{[\s\S]*?clearGateManifests\(window\.localStorage\)/u);
});
