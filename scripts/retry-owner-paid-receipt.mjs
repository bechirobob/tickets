// Retry only the owner's confirmed one-cedi receipt after sender activation.
const account="af75a230de2eea882606db8d9acce473";
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error("Cloudflare secret missing");
const root="https://api.cloudflare.com/client/v4/accounts/"+account;
const headers={authorization:"Bearer "+token,"content-type":"application/json"};
async function cf(path,body){
 const response=await fetch(root+path,{method:body?"POST":"GET",headers,...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok||!data.success)throw new Error("Cloudflare operation failed: "+response.status);
 return data.result;
}
const settings=await cf("/workers/scripts/becore-tickets/settings");
if(settings.bindings.find(b=>b.name==="EMAIL_FROM")?.text!=="BeCore Tickets <tickets@becoreops.com>" || !settings.bindings.some(b=>b.name==="RESEND_API_KEY"&&b.type==="secret_text"))throw new Error("Production sender is not ready");
const databases=await cf("/d1/database?name=becore-tickets-db");
const db=databases.find(d=>d.name==="becore-tickets-db");
if(!db)throw new Error("Database not found");
const query=(body)=>cf("/d1/database/"+db.uuid+"/query",body);
const scope="SELECT id FROM orders WHERE reference='BCT-MU3B2WQ1-4D0A93' AND event_slug='becore-payment-check-20260915' AND status='paid' AND total_amount_minor=100 AND currency='GHS'";
const state=await query({sql:"SELECT d.id,d.kind,d.status,d.attempt_count,d.failure_reason,(julianday(g.expires_at)>julianday('now')) AS grant_valid FROM delivery_events d LEFT JOIN attendee_recovery_grants g ON g.id=d.recovery_grant_id WHERE d.order_id IN ("+scope+") AND d.kind='payment_confirmation'"});
const rows=state[0].results;
if(rows.length!==1)throw new Error("Expected exactly one paid test receipt");
const row=rows[0];
if(process.env.RECEIPT_MODE==="retry"){
 if(row.status!=="failed"||row.failure_reason!=="Transactional email is not configured."||row.attempt_count!==1||!row.grant_valid)throw new Error("Receipt is no longer eligible for the scoped configuration retry");
 const now=new Date().toISOString();
 const result=await query({sql:"UPDATE delivery_events SET next_attempt_at=?,updated_at=? WHERE id=? AND status='failed' AND failure_reason='Transactional email is not configured.' AND attempt_count=1 AND provider_id IS NULL",params:[now,now,row.id]});
 if(result[0].meta.changes!==1)throw new Error("Receipt retry was not scheduled");
 console.log("Owner paid test receipt scheduled for normal delivery retry.");
}
console.log("Paid test receipt:",JSON.stringify({status:row.status,attempts:row.attempt_count,grantValid:!!row.grant_valid,failureReason:row.failure_reason}));
