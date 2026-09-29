import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { inventoryDigest, legacyHttpIncident, unloggedHttpIncident } from '../worker/handover-reconciliation.ts';

test('exact incident flows through actual Room and source fences and restores every obligation on abort', async () => {
  const original=Array.from({length:116},(_,i)=>({id:'synthetic-'+String(i).padStart(3,'0'),kind:'http',started_at:'2000-01-01T00:00:00Z'}));
  const rows=[...original,...unloggedHttpIncident];
  const pair=generateKeyPairSync('rsa',{modulusLength:3072});
  const bundled=await build({stdin:{contents:"export {HandoverEntrypoint} from './worker/handover';export {TheRoom} from './worker/the-room';export default {fetch(){return new Response('Not found',{status:404})}}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',external:['cloudflare:workers']});
  const raw=bundled.outputFiles[0].text;
  assert.equal(raw.split(legacyHttpIncident.digest).length,2);
  // Test-only fixture substitution; no production source or inventory changes.
  const source=raw.replace(legacyHttpIncident.digest,await inventoryDigest(original));
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[
    {name:'source',modules:true,script:source,compatibilityDate:'2026-08-11',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],durableObjects:{THE_ROOM:{className:'TheRoom',useSQLite:true}},bindings:{HANDOVER_RECIPIENT_SPKI:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),HANDOVER_EXPIRES_AT:new Date(Date.now()+600000).toISOString(),RELEASE_SHA:'a'.repeat(40),HANDOVER_TRACKING:'1'}},
    {name:'collector',modules:true,script:"export default {async fetch(request,env){try{const x=await request.json();return Response.json(await env.SOURCE[x.method](...x.args))}catch(e){return new Response(e.message,{status:409})}}}",compatibilityDate:'2026-08-11',serviceBindings:{SOURCE:{name:'source',entrypoint:'HandoverEntrypoint'}}}
  ]}));
  try {
    const caller=await mf.getWorker('collector');
    const rpc=async(method,...args)=>{const r=await caller.fetch('https://internal.test/',{method:'POST',body:JSON.stringify({method,args})});const body=await r.text();assert.equal(r.status,200,method+': '+body);return JSON.parse(body)};
    const db=await mf.getD1Database('DB','source');
    await rpc('prepareSource');
    for(const sql of [
      'CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT)',
      'CREATE TABLE payment_refunds(status TEXT)',
      'CREATE TABLE payout_transfers(status TEXT)',
      'CREATE TABLE refund_batches(status TEXT)',
      'CREATE TABLE approval_requests(status TEXT)',
      'CREATE TABLE delivery_events(status TEXT)',
      'CREATE TABLE confirmation_deliveries(status TEXT,lease_token TEXT)',
      'CREATE TABLE event_announcement_recipients(status TEXT,claimed_at TEXT)',
      'CREATE TABLE room_announcement_deliveries(status TEXT,lease_token TEXT)',
      'CREATE TABLE marketing_state(lease_token TEXT)',
      'CREATE TABLE marketing_campaigns(status TEXT)',
      'CREATE TABLE inventory_reservations(status TEXT)'
    ]) await db.exec(sql);
    for(const row of rows)await db.prepare('INSERT INTO _bct_handover_operations VALUES(?,?,?)').bind(row.id,row.kind,row.started_at).run();
    const transfer='01234567-89ab-4cde-8123-456789abcdef';
    await rpc('pauseSource',transfer);
    const identity=await rpc('roomIdentity','synthetic-incident');
    await rpc('freezeRoom',identity.objectId,transfer);
    const frozen=await rpc('freezeSource',transfer,true);
    assert.equal(frozen.admission.phase,'frozen');assert.deepEqual(frozen.operations,[]);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM _bct_handover_reconciled_operations').first()).n,119);
    await assert.rejects(db.prepare("INSERT INTO orders VALUES('late','paid')").run(),/paused/);
    const proof=JSON.parse((await db.prepare('SELECT evidence_json FROM _bct_handover_reconciled_operations LIMIT 1').first()).evidence_json);
    assert.equal(proof.completionClaimed,false);assert.equal(Object.keys(proof.counts).length,12);
    await rpc('resumeRoom',identity.objectId,transfer);
    await rpc('resumeSource',transfer);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM _bct_handover_operations').first()).n,119);
    await db.prepare("INSERT INTO orders VALUES('resumed','paid')").run();
  } finally {await mf.dispose()}
});
