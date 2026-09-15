import {publicEncrypt,constants,createHash,randomBytes} from 'node:crypto';
const account='af75a230de2eea882606db8d9acce473';
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('Cloudflare credentials missing.');
const headers={authorization:'Bearer '+token,'content-type':'application/json'};
const root='https://api.cloudflare.com/client/v4/accounts/'+account;
const listing=await fetch(root+'/d1/database?name=becore-tickets-db',{headers}).then(r=>r.json());
const database=listing.result?.find(r=>r.name==='becore-tickets-db');
if(!listing.success||!database)throw new Error('Database unavailable.');
const response=await fetch(root+'/d1/database/'+database.uuid+'/query',{method:'POST',headers,body:JSON.stringify({sql:"SELECT o.id,o.reference,o.total_amount_minor,o.currency,o.payment_environment,s.request_json,g.token_hash,g.claimed_at,g.expires_at,(SELECT COUNT(*) FROM tickets t WHERE t.order_id=o.id) AS tickets FROM orders o JOIN seev_checkout_sessions s ON s.order_id=o.id JOIN order_access_grants g ON g.order_id=o.id WHERE o.event_slug=? AND o.status='paid' AND o.payment_provider='seevplus'",params:['becore-payment-check-20260915']}),signal:AbortSignal.timeout(30000)});
const result=await response.json();
if(!response.ok||!result.success||!result.result?.[0]?.success)throw new Error('Scoped paid-order read failed.');
const rows=result.result[0].results;
if(rows.length!==1)throw new Error('Expected exactly one paid test order.');
const order=rows[0];
if(order.total_amount_minor!==100||order.currency!=='GHS'||order.payment_environment!=='production'||order.tickets!==1||order.claimed_at||order.expires_at<=new Date().toISOString())throw new Error('Paid ticket is not eligible for original-link recovery.');
// Initialization deliberately clears provider request payloads. Rotate only
// this unclaimed, paid test order's access grant; never grant email-wide access.
const claim=randomBytes(32).toString('base64url');
const claimHash=createHash('sha256').update(claim).digest('hex');
const now=new Date().toISOString();
const expires=new Date(Date.now()+2*60*60*1000).toISOString();
const marker='operator:seev-one-cedi-20260915:paid-return-recovery';
const changed=await fetch(root+'/d1/database/'+database.uuid+'/query',{method:'POST',headers,body:JSON.stringify({batch:[
 {sql:"UPDATE order_access_grants SET token_hash=?,expires_at=? WHERE order_id=? AND token_hash=? AND claimed_at IS NULL AND NOT EXISTS(SELECT 1 FROM operational_audit_events WHERE id=?) AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_access_grants.order_id AND o.status='paid' AND o.event_slug='becore-payment-check-20260915' AND o.total_amount_minor=100)",params:[claimHash,expires,order.id,order.token_hash,marker]},
 {sql:"INSERT INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) SELECT ?,'owner','payment.live-check.access-recover','order',?,'success','Owner reported paid checkout return lost its claim. Replaced the unclaimed token for this single paid GHS1 test order; no email-wide access, payment state, or ticket changes.',? WHERE EXISTS(SELECT 1 FROM order_access_grants WHERE order_id=? AND token_hash=?)",params:[marker,order.id,now,order.id,claimHash]}
]}),signal:AbortSignal.timeout(30000)}).then(r=>r.json());
if(!changed.success||changed.result?.length!==2||changed.result.some(r=>!r.success||r.meta?.changes!==1))throw new Error('Paid test grant rotation was not applied; inspect status.');
const url=new URL('https://tickets.becoreops.com/payment/return');
url.searchParams.set('reference',order.reference);
url.searchParams.set('claim',claim);
const encrypted=publicEncrypt({key:"-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAoFVfh0dbM4ZQulT+0QFC\nlTIiRigDZE6K18KGtmoCbjmM4xolraulZy8TPg6iLPAYKTyorQdyHn27CxinzNHY\n6zpW+KmCkH21QDFIWj/sy4RV+Exi+z0ahCSPLJEjfW6J0JifElTJ9Aqfw2Xx/f2m\ngmp2rofXMI8z+AIwpLyPS9eLOtV/Ad6ZlweYNtB7d70H8nen/o621Ly+1UkNkA7C\nKCcBcXEn3bFMXOTGFMmZJXxKQwPQNe1WjxcV6LctsOz8jDIVxLI0WKRdD7VesCrm\nz+PUy9Oi4JI2ABn8vf8t8f/F83QRalRdV/AKouYjfgzFxw1o0hxv2LF7N5G+ukvl\nmkYsTMpIWu0slaB9hOCPCX6OJ2SYaq2SgnQciwblIZqo8nYCYEOJlWcU7p7vEYwE\nYbhBekUrd/85DhCSNAi00QvRrQeOtML+bVnA7NNe/MlZ5mCQfyLtYkGllDYjNBjF\nNW/utDNAHFMIvDJ9JrS7DQa2b9OXwP0qJce7LELPlkOGeS06pxJrAw9L74K9fWEW\ns1MDCio0VS0RFZKQQDfsRjM4HaEGemHhJd5LXBguqEOKoVdAM1ILTDzE4ygwulxx\ns6GyAuy/RG7JV6RG8n3vUpHWJAtRAUgCqRnp83qFwgj3PGc47VqnV/kRT1CQGt3I\nIqWTCJwTdrFjgB2OVWQPHv0CAwEAAQ==\n-----END PUBLIC KEY-----",padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(url.href)).toString('base64');
console.log(JSON.stringify({paid:true,amountMinor:100,tickets:1,originalReturnEncrypted:encrypted}));
const settings=await fetch(root+'/workers/scripts/becore-tickets/settings',{headers}).then(r=>r.json());
if(!settings.success)throw new Error('Worker settings unavailable.');
console.log(JSON.stringify({emailConfiguration:{apiKeyPresent:settings.result.bindings.some(b=>b.name==='RESEND_API_KEY'),senderPresent:settings.result.bindings.some(b=>b.name==='EMAIL_FROM')}}));
