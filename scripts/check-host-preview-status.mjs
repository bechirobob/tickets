const headers={authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'};
const root=`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
const r=await fetch(root+'?name=becore-tickets-db',{headers,signal:AbortSignal.timeout(30000)});
const d=await r.json();const db=d.result?.filter(x=>x.name==='becore-tickets-db');
if(!r.ok||!d.success||db?.length!==1)throw Error('Database lookup failed');
const q=await fetch(root+'/'+db[0].uuid+'/query',{method:'POST',headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({sql:'SELECT id,status,provider_id,attempt_count,next_attempt_at,failure_reason,created_at,updated_at FROM delivery_events WHERE id IN (?,?)',params:['email-preview/host-invitation-owner-20260919-v3','email-preview/host-invitation-kofi-20260919-v3']})});
const result=await q.json();if(!q.ok||!result.success)throw Error('Status lookup failed');
console.log(JSON.stringify({previewStatus:result.result[0].results}));

const schedules=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/becore-tickets/schedules`,{headers,signal:AbortSignal.timeout(30000)});
const scheduleData=await schedules.json();console.log(JSON.stringify({schedules:scheduleData.result,scheduleSuccess:scheduleData.success}));
const checkSqls=[
"SELECT source,message,detail,created_at FROM system_alerts WHERE created_at>datetime('now','-2 hours') AND source IN ('email-delivery-retry','preview-cleanup') ORDER BY created_at DESC LIMIT 5",
"SELECT kind,status,count(*) AS count FROM delivery_events WHERE status='queued' GROUP BY kind,status",
"SELECT id,status,provider_id,attempt_count,next_attempt_at,failure_reason,created_at,updated_at FROM delivery_events WHERE id IN ('email-preview/host-invitation-owner-20260919-v3','email-preview/host-invitation-kofi-20260919-v3')"
];
for(const sql of checkSqls){const response=await fetch(root+'/'+db[0].uuid+'/query',{method:'POST',headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({sql,params:[]})});const value=await response.json();if(!response.ok||!value.success)throw Error('Read-only check failed');console.log(JSON.stringify({diagnostic:value.result[0].results}).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[redacted email]'));}
