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
 const start=Math.min(...rows.map(r=>Date.parse(r.started_at)))-2000, end=Date.now();
 assert.ok(end-start<3600000,'Explicit historical window review required.');
 for(let from=start;from<end;from+=30000)await collect(from,Math.min(end,from+30000));
 const matches=matchTerminalEvidence(rows,events);
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
