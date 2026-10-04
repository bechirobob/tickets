import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = await readFile(new URL('../app/scan/scanner.tsx',import.meta.url),'utf8');
const policy = transformSync(await readFile(new URL('../lib/scanner-manifest.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {beginGateAccess,clearGateManifests,saveGateManifest,readGateManifest}=await import(`data:text/javascript;base64,${Buffer.from(policy).toString('base64')}`);
const sync = transformSync(await readFile(new URL('../lib/scanner-sync.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'}).code;
const {GATE_QUEUE_KEY,GATE_REVIEW_KEY}=await import(`data:text/javascript;base64,${Buffer.from(sync).toString('base64')}`);
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

function scannerCallback(name, scope) {
  const marker = `const ${name} = useCallback(`;
  const start = source.indexOf(marker) + marker.length;
  const callback = source.slice(start, source.indexOf('\n  }, [', start) + '\n  }'.length);
  const compiled = transformSync(`const callback=${callback};`, {loader:'ts'}).code;
  return new Function(...Object.keys(scope), `${compiled};return callback;`)(...Object.values(scope));
}

for (const scenario of ['stale storage', 'storage failure', 'newer scanner']) test(`a cross-tab session refresh blocks old offline access with ${scenario}`, async () => {
  const failClear = scenario === 'storage failure', newerScanner = scenario === 'newer scanner';
  const records = new Map(), storage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => { records.delete(key); },
  };
  const access = {accountId:'synthetic-staff',sessionId:'synthetic-session',expiresAt:Math.floor(Date.now()/1000)+3600};
  const eventSlug = 'synthetic-event', token = 'AAAABBBBCCCCDDDD';
  const hash = createHash('sha256').update(token).digest('hex');
  const list = {eventSlug,access,generatedAt:new Date().toISOString(),tickets:[{ticketId:'synthetic-ticket',tokenHash:hash,ticketType:'general',status:'issued',attendeeName:'Synthetic guest'}]};
  beginGateAccess(storage, access); assert.equal(saveGateManifest(storage, access, list), true);
  storage.setItem(GATE_QUEUE_KEY, 'pending scan evidence'); storage.setItem(GATE_REVIEW_KEY, 'pending review evidence');
  const nextAccess = {...access,sessionId:'new-session'}, nextList = {...list,access:nextAccess};
  if (failClear) storage.removeItem = () => { throw new Error('Storage unavailable'); };
  let finishHash, mode = '', saved = [], manifest = list, canUndo = true, matches = ['Previous guest'];
  const scope = {
    access,eventSlug,deviceId:'synthetic-device',currentEvent:{current:eventSlug},gateAccessDenied:{current:false},refreshBusy:{current:''},
    window:{localStorage:storage},clearGateManifests,saveGateManifest,readGateManifest,
    normalizeToken:()=>token,tokenHash:()=>new Promise(resolve=>{finishHash=resolve;}),
    readGateList:()=>[],QUEUE_KEY:GATE_QUEUE_KEY,GATE_REVIEW_KEY,saveQueue:next=>{saved=next;},
    setMode:next=>{mode=next;},setManifest:next=>{manifest=next;},setCanUndo:next=>{canUndo=next;},setMatches:next=>{matches=next;},
    setTicket:()=>{},setMessage:()=>{},setStats:()=>{},setStorageError:()=>{},setSyncMessage:()=>{},markContact:()=>{},heartbeat:async()=>{},
    fetch:async()=>Response.json({checkedIn:0,issued:1,canUndo:true,manifest:list.tickets,generatedAt:list.generatedAt,access:nextAccess}),
  };
  scope.denyGateAccess = scannerCallback('denyGateAccess', scope);
  const refresh = scannerCallback('loadEventState', scope);
  const scan = scannerCallback('offlineCheck', scope);
  // The page stays mounted while another tab changes the server session. A
  // successful refresh is the first notice; shared scanner storage is still old.
  const pending = scan(`BCT-${token}`, 'synthetic-scan');
  if (newerScanner) { beginGateAccess(storage, nextAccess); assert.equal(saveGateManifest(storage, nextAccess, nextList), true); }
  await refresh(); finishHash(hash); await pending;
  assert.equal(mode, 'unavailable'); assert.equal(saved.length, 0);
  assert.equal(scope.gateAccessDenied.current, true);
  assert.equal(manifest, null); assert.equal(canUndo, false); assert.deepEqual(matches, []);
  if (!failClear && !newerScanner) {
    assert.equal(storage.getItem('bct:gate-access:v1'), null);
    assert.equal(storage.getItem('bct:gate-manifests:v2'), null);
  } else if (failClear) assert.deepEqual(readGateManifest(storage, access, eventSlug), list);
  else assert.deepEqual(readGateManifest(storage, nextAccess, eventSlug), nextList);
  await scan(`BCT-${token}`, 'later-scan');
  assert.equal(mode, 'invalid'); assert.equal(saved.length, 0);
  assert.equal(storage.getItem(GATE_QUEUE_KEY), 'pending scan evidence');
  assert.equal(storage.getItem(GATE_REVIEW_KEY), 'pending review evidence');
  if (newerScanner) {
    const nextScope = {...scope,access:nextAccess,gateAccessDenied:{current:false},refreshBusy:{current:''}};
    nextScope.denyGateAccess = scannerCallback('denyGateAccess', nextScope);
    await scannerCallback('loadEventState', nextScope)();
    assert.equal(nextScope.gateAccessDenied.current, false);
    const nextScan = scannerCallback('offlineCheck', nextScope)(`BCT-${token}`, 'new-session-scan');
    finishHash(hash); await nextScan;
    assert.equal(mode, 'offline_saved'); assert.equal(saved.length, 1);
  }
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
