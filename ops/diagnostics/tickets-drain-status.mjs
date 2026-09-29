import {cloudflare,account} from '../handover/control-client.mjs';
const p='/accounts/'+account+'/d1/database/8f8723c2-673a-4aba-b025-83c05d67d075/query';
const q=async(sql)=>(await cloudflare(p,'POST',{sql}))[0].results;
console.log(JSON.stringify({at:new Date().toISOString(),admission:await q('SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1'),outstanding:await q('SELECT kind,COUNT(*) n FROM _bct_handover_operations GROUP BY kind'),lock:await q('SELECT frozen,transfer_id FROM _bct_handover_state WHERE id=1'),reconciled:await q('SELECT COUNT(*) n FROM _bct_handover_reconciled_operations')}));
