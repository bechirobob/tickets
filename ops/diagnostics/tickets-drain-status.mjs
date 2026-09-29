import {cloudflare,account} from '../handover/control-client.mjs';
import {isLegacyInventory} from '../../worker/handover-reconciliation.ts';
const p='/accounts/'+account+'/d1/database/8f8723c2-673a-4aba-b025-83c05d67d075/query';
const q=async(sql)=>(await cloudflare(p,'POST',{sql}))[0].results;
await new Promise(r=>setTimeout(r,Math.max(0,Date.parse('2026-09-29T13:18:00Z')-Date.now())));
for(let i=0;i<3;i++){
 const rows=await q('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id');
 console.log(JSON.stringify({at:new Date().toISOString(),admission:await q('SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1'),count:rows.length,onlyKnown:await isLegacyInventory(rows),otherKinds:rows.filter(r=>r.kind!=='http')}));
 if(i<2)await new Promise(r=>setTimeout(r,30000));
}
