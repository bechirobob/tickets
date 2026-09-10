// Enqueue the owner's reviewed cleanup once; the deployed Worker clears D1 and Room storage.
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const headers={Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'};
const root=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const listing=await(await fetch(`${root}?name=becore-tickets-db`,{headers})).json();
const database=listing.result?.find(row=>row.name==='becore-tickets-db');
if(!database?.uuid)throw new Error('Production database not found.');
async function query(sql,params=[]){const response=await fetch(`${root}/${database.uuid}/query`,{method:'POST',headers,body:JSON.stringify({sql,params})});const payload=await response.json();if(!response.ok||!payload.success)throw new Error('Cleanup verification query failed.');return payload.result[0].results;}
const id='operator:preview-cleanup-2026-09-10';
await query(`INSERT OR IGNORE INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES (?,'owner','preview.cleanup','maintenance','preview-cases','pending','Owner requested complete removal of preview cases and test purchases. Preserve real listings and registrations.',?)`,[id,new Date().toISOString()]);
let job;
for(let attempt=0;attempt<18;attempt++){
 [job]=await query('SELECT outcome,detail FROM operational_audit_events WHERE id=?',[id]);
 if(job?.outcome==='success')break;
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(job?.outcome!=='success')throw new Error('Preview cleanup has not completed. Inspect the Worker cleanup alert.');
const remaining=await query(`SELECT slug FROM curated_event_records WHERE slug IN ('after-dark-osu','noir-room-labone','longitude-spintex') UNION ALL SELECT 'test-order' FROM orders WHERE payment_environment IN ('test','sandbox')`);
if(remaining.length)throw new Error('Preview records remain after cleanup.');
const real=await query("SELECT slug,status FROM curated_event_records WHERE slug IN ('the-weekend-braai','sun-chasers-labadi') ORDER BY slug");
if(real.length!==2||real.some(row=>row.status!=='published'))throw new Error('Real event listing verification failed.');
console.log(JSON.stringify({previewCleanup:'complete',counts:JSON.parse(job.detail),realListings:real}));
