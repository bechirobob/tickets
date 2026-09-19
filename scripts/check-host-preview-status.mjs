const headers={authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'};
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
const r=await fetch(root+'?name=becore-tickets-db',{headers,signal:AbortSignal.timeout(30000)});
const d=await r.json();const db=d.result?.filter(x=>x.name==='becore-tickets-db');
if(!r.ok||!d.success||db?.length!==1)throw Error('Database lookup failed');
const q=await fetch(root+'/'+db[0].uuid+'/query',{method:'POST',headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({sql:'SELECT id,status,provider_id,attempt_count,next_attempt_at,failure_reason,created_at,updated_at FROM delivery_events WHERE id IN (?,?)',params:['email-preview/host-invitation-owner-20260919-v3','email-preview/host-invitation-kofi-20260919-v3']})});
const result=await q.json();if(!q.ok||!result.success)throw Error('Status lookup failed');
console.log(JSON.stringify({previewStatus:result.result[0].results}));
