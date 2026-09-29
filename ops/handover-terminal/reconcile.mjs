import assert from 'node:assert/strict';
import { cloudflare, account } from '../handover/control-client.mjs';
import { matchTerminalEvidence } from './evidence.mjs';
import { isLegacyInventory } from '../../worker/handover-reconciliation.ts';
const root='/accounts/'+account, source=root+'/workers/scripts/becore-tickets';
const settings=await cloudflare(source+'/settings');
assert.equal(settings.bindings.find(b=>b.name==='RELEASE_SHA')?.text,'18d1a08e0e77f862870aecd6b9fbcec4705c3bb8');
const database=settings.bindings.find(b=>b.name==='DB'&&b.type==='d1').id;
const q=async(sql,params)=>(await cloudflare(root+'/d1/database/'+database+'/query','POST',{sql,...(params?{params}:{})}))[0].results;
const rows=await q("SELECT id,kind,started_at FROM _bct_handover_operations WHERE started_at>'2026-09-29T10:14:07.037Z' ORDER BY id");
const events=[];
async function collect(from,to){
 const result=await cloudflare(root+'/workers/observability/telemetry/query','POST',{queryId:crypto.randomUUID(),timeframe:{from,to},view:'events',limit:2000,parameters:{filters:[{key:'$metadata.service',operation:'eq',type:'string',value:'becore-tickets'}]}});
 if(result.events.count>=1900 || result.events.events.length>=1900){assert.ok(to-from>1000,'Telemetry completeness cannot be established.');const middle=Math.floor((from+to)/2);await collect(from,middle);await collect(middle,to);}
 else events.push(...result.events.events);
}
if(rows.length){
 const timeframe={from:Date.parse('2026-09-29T11:00:00Z'),to:Date.now()};
 for(const record of rows){
  const result=await cloudflare(root+'/workers/observability/telemetry/query','POST',{queryId:crypto.randomUUID(),timeframe,view:'events',limit:2000,parameters:{needle:{value:record.id,matchCase:true}}});
  events.push(...result.events.events);
 }
 const requests=[...new Set(events.map(e=>e.$metadata?.requestId).filter(Boolean))];
 requests.push('01dd0168f36d1e23ab5614cf7596ed61');
 for(const request of new Set(requests)){
  const result=await cloudflare(root+'/workers/observability/telemetry/query','POST',{queryId:crypto.randomUUID(),timeframe,view:'events',limit:2000,parameters:{filters:[{key:'$metadata.requestId',operation:'eq',type:'string',value:request}]}});
  events.push(...result.events.events);
 }
 const matches=matchTerminalEvidence(rows,events);
 for(const record of rows.filter(r=>!matches.some(m=>m.record.id===r.id))){
  const entries=events.filter(e=>e.source?.handoverOperation===record.id);
  console.log(JSON.stringify({unmatched:record.id,entries:entries.map(e=>({phase:e.source?.phase,request:e.$metadata?.requestId,version:e.$workers?.scriptVersion?.id,metadataType:e.$metadata?.type})),related:events.filter(e=>entries.some(x=>x.$metadata?.requestId===e.$metadata?.requestId)).map(e=>({type:e.$metadata?.type,outcome:e.$workers?.outcome,version:e.$workers?.scriptVersion?.id,phase:e.source?.phase,operation:e.source?.handoverOperation}))}));
 }
 let retired=0;
 for(const {record,evidence} of matches){
  const state=(await q('SELECT phase FROM _bct_handover_admission WHERE id=1'))[0];
  assert.ok(['active','paused'].includes(state.phase),'Frozen/transferred source must not be mutated.');
  // Preserve proof before retiring the exact corresponding record. A lost API
  // response cannot lose evidence; the second statement requires that evidence.
  await q("INSERT OR IGNORE INTO _bct_handover_terminal_operations SELECT id,kind,started_at,? FROM _bct_handover_operations WHERE id=? AND kind='http' AND started_at=?",[JSON.stringify(evidence),record.id,record.started_at]);
  await q("DELETE FROM _bct_handover_operations WHERE id=? AND kind='http' AND started_at=? AND EXISTS(SELECT 1 FROM _bct_handover_terminal_operations WHERE id=?)",[record.id,record.started_at,record.id]);
  retired++;
 }
 console.log(JSON.stringify({examined:rows.length,exactTerminalMatches:matches.length,retired,evidencePreserved:true,noExpiry:true}));
}
const remaining=await q('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id');
console.log(JSON.stringify({remaining:remaining.length,onlyKnownLegacy:await isLegacyInventory(remaining),newer:remaining.filter(r=>r.started_at>'2026-09-29T10:14:07.037Z').slice(0,5)}));
