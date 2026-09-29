import {cloudflare,account} from '../handover/control-client.mjs';
import {isLegacyInventory} from '../../worker/handover-reconciliation.ts';
const root='/accounts/'+account, settings=await cloudflare(root+'/workers/scripts/becore-tickets/settings');
const database=settings.bindings.find(b=>b.name==='DB').id;
const q=async(sql)=>(await cloudflare(root+'/d1/database/'+database+'/query','POST',{sql}))[0].results;
const deadline=Date.parse('2026-09-29T12:47:00Z');
await new Promise(r=>setTimeout(r,Math.max(0,deadline-Date.now())));
for(let i=0;i<3;i++){
 const rows=await q('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id');
 console.log(JSON.stringify({at:new Date().toISOString(),admission:await q('SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1'),count:rows.length,onlyKnown:await isLegacyInventory(rows),otherKinds:rows.filter(r=>r.kind!=='http'),latest:rows.reduce((a,r)=>r.started_at>a?r.started_at:a,'')}));
 if(i<2)await new Promise(r=>setTimeout(r,30000));
}
