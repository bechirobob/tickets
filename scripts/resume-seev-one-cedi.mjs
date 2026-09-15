import {publicEncrypt, constants} from 'node:crypto';
const account='af75a230de2eea882606db8d9acce473';
const slug='becore-payment-check-20260915';
const marker='operator:seev-one-cedi-20260915';
const receipt=marker+':transport-resume';
const publicKey=`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkVjJbkWwsrDHtNYoKQyU
rAhqt7yZUNY5hWVKyJBTlCXe4dw5eks3vJYTlgtNcWJS0VqV9JGtA4MCIrP4l9Jl
KLqniadW8rCDPNVDtd+oDejnxbqgBd1xSaMg3qeM9eQAt7oVgaZX9snJ23JP6jp7
UlQmG/M9i8PSAP54lVduILtF7rmEKYMKQombsPBAkmJiGQO0Iev4UEO6VWN8gRGP
ldT/tzxZNldt5Q2ALBFzoxrNGHA/FxENSqadpKD6dFRcqR+VUAz4IihEN6Ps68Ud
jld8R+3xftLVC8Rp0rovt3hkUcPhh+ABVmfS26CJFVRdoSwEGAUo0SSq+zmCWpHq
xwIDAQAB
-----END PUBLIC KEY-----
`;
const expected=process.env.RESUME_RELEASE_SHA;
if(!/^[a-f0-9]{40}$/.test(expected??''))throw new Error('Expected production revision is required.');
const version=await fetch('https://tickets.becoreops.com/api/version',{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
if(version.revision!==expected)throw new Error('The expected transport fix is not deployed.');
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('Cloudflare credentials missing.');
const headers={authorization:'Bearer '+token,'content-type':'application/json'};
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database';
const databases=await fetch(root+'?name=becore-tickets-db',{headers}).then(r=>r.json());
const database=databases.result?.find(row=>row.name==='becore-tickets-db');
if(!databases.success || !database)throw new Error('Production database lookup failed.');
async function query(body){
 const response=await fetch(root+'/'+database.uuid+'/query',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await response.json();
 if(!response.ok||!data.success||!data.result?.length||data.result.some(r=>!r.success))throw new Error('Scoped order recovery database operation failed.');
 return data.result;
}
const rows=(await query({sql:'SELECT o.*,s.request_json,s.checkout_url FROM orders o JOIN seev_checkout_sessions s ON s.order_id=o.id WHERE o.event_slug=?',params:[slug]}))[0].results;
if(rows.length!==1)throw new Error('Expected exactly one original test order.');
const order=rows[0];
if(order.total_amount_minor!==100||order.currency!=='GHS'||order.payment_provider!=='seevplus'||order.payment_environment!=='production'||order.quantity!==1)throw new Error('Test order invariants failed.');
const resumed=(await query({sql:'SELECT id FROM operational_audit_events WHERE id=?',params:[receipt]}))[0].results.length;
if(!resumed){
 if(order.status!=='expired'||order.provider_reference||order.checkout_url||!order.request_json||Date.now()-Date.parse(order.created_at)>23*3600000)throw new Error('Original attempt is not eligible for safe resumption.');
 const original=JSON.parse(order.request_json);
 if(original.amount!==100||original.currency!=='GHS'||original.meta?.orderId!==order.id)throw new Error('Saved request does not match the original order.');
 const now=new Date().toISOString();
 const expires=new Date(Date.now()+45*60000).toISOString();
 const changes=await query({batch:[
  {sql:"UPDATE inventory_reservations SET status='held',expires_at=?,updated_at=? WHERE order_id=? AND event_slug=? AND admission_count=1 AND status='expired' AND EXISTS (SELECT 1 FROM curated_event_records e JOIN event_ticket_tiers t ON t.event_slug=e.slug WHERE e.id=? AND e.slug=? AND e.status='published' AND e.sales_close_at>? AND t.id=inventory_reservations.ticket_tier_id AND t.capacity_admissions=1 AND t.price_minor=100 AND t.status='available') AND NOT EXISTS (SELECT 1 FROM inventory_reservations other WHERE other.event_slug=? AND other.order_id<>? AND (other.status='consumed' OR (other.status='held' AND other.expires_at>?))) AND NOT EXISTS (SELECT 1 FROM tickets WHERE event_slug=?) AND EXISTS (SELECT 1 FROM orders o WHERE o.id=? AND o.status='expired' AND o.provider_reference IS NULL)",params:[expires,now,order.id,slug,marker,slug,expires,slug,order.id,now,slug,order.id]},
  {sql:"UPDATE orders SET status='payment_pending',reservation_expires_at=?,payment_updated_at=?,failure_reason=NULL WHERE id=? AND event_slug=? AND status='expired' AND provider_reference IS NULL AND EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_id=orders.id AND r.status='held' AND r.expires_at=?)",params:[expires,now,order.id,slug,expires]},
  {sql:"UPDATE seev_checkout_sessions SET lease_until=NULL,checked_at=NULL,last_error=NULL WHERE order_id=? AND EXISTS (SELECT 1 FROM orders o WHERE o.id=? AND o.status='payment_pending' AND o.reservation_expires_at=?)",params:[order.id,order.id,expires]},
  {sql:"INSERT INTO operational_audit_events (id,actor_role,action,target_type,target_id,outcome,detail,created_at) SELECT ?,'owner','payment.live-check.resume','event',?,'success','Owner requested checkout repair. Reacquired the original one-cedi reservation for 45 minutes after transport deployment; original order, amount, request and provider idempotency key preserved. No payment or refund status fabricated.',? WHERE EXISTS (SELECT 1 FROM orders o WHERE o.id=? AND o.status='payment_pending' AND o.reservation_expires_at=?)",params:[receipt,slug,now,order.id,expires]}
 ]});
 if(changes.some(row=>row.meta?.changes!==1))throw new Error('Reservation resumption did not satisfy every guard.');
 console.log(JSON.stringify({resume:'original-order-reserved',revision:expected,amountMinor:100,currency:'GHS',expiresAt:expires}));
}else console.log(JSON.stringify({resume:'already-recorded',revision:expected}));
let session;
for(let i=0;i<33;i++){
 session=(await query({sql:"SELECT o.status,o.provider_status,o.provider_reference,s.checkout_url,(SELECT COUNT(*) FROM tickets WHERE order_id=o.id) AS tickets,(SELECT COUNT(*) FROM orders WHERE event_slug=?) AS orderCount FROM orders o JOIN seev_checkout_sessions s ON s.order_id=o.id WHERE o.id=?",params:[slug,order.id]}))[0].results[0];
 if(session?.checkout_url)break;
 if(i===32)throw new Error('Scheduled recovery has not yet returned a hosted checkout.');
 await new Promise(resolve=>setTimeout(resolve,10000));
}
const url=new URL(session.checkout_url);
if(url.origin!=='https://pay.seevplus.com'||url.username||url.password||url.pathname!=='/'+session.provider_reference||session.orderCount!==1)throw new Error('Recovered checkout validation failed.');
const encryptedCheckout=publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(url.href)).toString('base64');
console.log(JSON.stringify({resumeResult:'hosted-checkout-ready',status:session.status,providerStatus:session.provider_status,orderCount:session.orderCount,tickets:session.tickets,encryptedCheckout}));
