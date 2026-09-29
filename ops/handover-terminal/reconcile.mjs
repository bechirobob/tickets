import {cloudflare,account} from '../handover/control-client.mjs';
import {inventoryDigest,isLegacyInventory,isKnownUnloggedOperation} from '../../worker/handover-reconciliation.ts';
const root='/accounts/'+account,settings=await cloudflare(root+'/workers/scripts/becore-tickets/settings');
const database=settings.bindings.find(b=>b.name==='DB').id;
const q=async(sql)=>(await cloudflare(root+'/d1/database/'+database+'/query','POST',{sql}))[0].results;
const rows=await q('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id');
console.log(JSON.stringify({revision:settings.bindings.find(b=>b.name==='RELEASE_SHA')?.text,tails:settings.tail_consumers,admission:await q('SELECT * FROM _bct_handover_admission'),total:rows.length,digest:await inventoryDigest(rows),isKnown:await isLegacyInventory(rows),original:rows.filter(r=>r.started_at<='2026-09-29T10:14:07.037Z').length,originalDigest:await inventoryDigest(rows.filter(r=>r.started_at<='2026-09-29T10:14:07.037Z')),newer:rows.filter(r=>r.started_at>'2026-09-29T10:14:07.037Z'),archives:await q("SELECT json_extract(evidence_json,'$.method') method,COUNT(*) n FROM _bct_handover_terminal_operations GROUP BY method")}));
