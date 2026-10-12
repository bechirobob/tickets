import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { generateRequestDetails } from 'web-push-neo';
import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { GET, POST, DELETE } from '../app/api/organizer/notifications/subscription/route';
import { deliverOrganizerRsvpPush, retryOrganizerRsvpPush } from '../lib/organizer-rsvp-push';
vi.mock('web-push-neo', () => ({ generateRequestDetails: vi.fn(async (subscription:{endpoint:string}) => ({endpoint:subscription.endpoint,method:'POST',headers:{},body:'encrypted'})) }));
const origin='https://tickets.becoreops.com', endpoint='https://fcm.googleapis.com/fcm/send/host-device';
const keys={p256dh:btoa(String.fromCharCode(4)+ 'a'.repeat(64)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,''),auth:btoa('a'.repeat(16)).replace(/=+$/u,'')};
let accountId:string, cookie:string, slug:string;
function request(method:string,body:unknown={endpoint,keys},auth=cookie,requestOrigin=origin){return new Request(origin+'/api/organizer/notifications/subscription',{method,headers:{cookie:auth,origin:requestOrigin,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});}
async function staff(role='organizer'){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,?,?,'test','test',1,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,role,role,now,now,now).run();
 return {id,cookie:adminCookieHeader(await createStaffSession(env.DB,{id})).split(';')[0]};
}
async function rsvp(status='unverified',kind='rsvp'){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,phone,party_size,kind,status,event_signature,created_at,updated_at) VALUES(?,?,?,'Private Guest','',1,?,?,'test',?,?)`).bind(id,slug,`${id}@example.com`,kind,status,now,now).run();return id;
}
async function pending(){return (await env.DB.prepare('SELECT id,attempts,outcome FROM organizer_rsvp_push_deliveries').all<{id:string;attempts:number;outcome:string|null}>()).results;}
async function captured(){const id=await rsvp();await env.DB.prepare("UPDATE event_registrations SET status='requested' WHERE id=?").bind(id).run();return (await pending())[0].id;}
beforeEach(async()=>{
 await env.DB.prepare('DELETE FROM organizer_rsvp_push_deliveries').run();await env.DB.prepare('DELETE FROM organizer_push_subscriptions').run();
 const host=await staff();accountId=host.id;cookie=host.cookie;slug=`push-${crypto.randomUUID()}`;const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES(?,?,?,'Host event','Venue','Accra',?,?,'Night',0,10,'on_sale','','Test event','published',?,?,?)`).bind(slug,slug,slug,new Date(Date.now()+86400000).toISOString(),new Date(Date.now()+90000000).toISOString(),now,now,now).run();
 await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(accountId,slug,accountId,now).run();
 env.VAPID_PUBLIC_KEY='test';env.VAPID_PRIVATE_KEY='test';env.VAPID_SUBJECT='mailto:test@example.com';
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:201}));
 expect((await POST(request('POST'))).status).toBe(200);
});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();delete env.VAPID_PUBLIC_KEY;delete env.VAPID_PRIVATE_KEY;delete env.VAPID_SUBJECT;});
it('captures initial RSVPs atomically, deduplicates later status changes, and excludes interest/unverified',async()=>{
 const id=await rsvp();await rsvp('interested','interest');expect(await pending()).toHaveLength(0);
 await env.DB.prepare("UPDATE event_registrations SET status='requested' WHERE id=?").bind(id).run();
 await env.DB.prepare("UPDATE event_registrations SET status='confirmed' WHERE id=?").bind(id).run();expect(await pending()).toHaveLength(1);
});
it('sends once under concurrent delivery and links to the host roster without guest details',async()=>{
 const id=await captured();await Promise.all([deliverOrganizerRsvpPush(env,id),deliverOrganizerRsvpPush(env,id)]);await deliverOrganizerRsvpPush(env,id);
 expect(fetch).toHaveBeenCalledTimes(1);expect((await pending())[0].outcome).toBe('accepted');
 const payload=JSON.parse(vi.mocked(generateRequestDetails).mock.calls[0][1] as string);
 expect(payload.url).toContain(`event=${slug}&view=rsvp&tab=roster`);expect(JSON.stringify(payload)).not.toContain('Private Guest');
});
it.each(['unassigned','disabled','logout','expired','cancelled','removed','archived','consent_changed'])('suppresses queued work after %s',async(change)=>{
 const id=await captured();
 if(change==='unassigned')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();
 if(change==='disabled')await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(accountId).run();
 if(change==='logout')await env.DB.prepare('UPDATE staff_sessions SET revoked_at=? WHERE account_id=?').bind(new Date().toISOString(),accountId).run();
 if(change==='expired')await env.DB.prepare("UPDATE staff_sessions SET expires_at='2000-01-01' WHERE account_id=?").bind(accountId).run();
 if(change==='cancelled')await env.DB.prepare("UPDATE event_registrations SET status='cancelled' WHERE event_slug=?").bind(slug).run();
 if(change==='archived')await env.DB.prepare('UPDATE curated_event_records SET archived_at=? WHERE slug=?').bind(new Date().toISOString(),slug).run();
 if(change==='removed')await env.DB.prepare('UPDATE curated_event_records SET removed_at=? WHERE slug=?').bind(new Date().toISOString(),slug).run();
 if(change==='consent_changed')await env.DB.prepare("UPDATE organizer_push_subscriptions SET consent_id='changed' WHERE account_id=?").bind(accountId).run();
 await deliverOrganizerRsvpPush(env,id);expect(fetch).not.toHaveBeenCalled();expect((await pending())[0].outcome).toBe('ineligible');
});
it('revokes expired devices and stops retries',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(null,{status:410}));const id=await captured();await deliverOrganizerRsvpPush(env,id);
 expect((await pending())[0].outcome).toBe('expired');expect(await env.DB.prepare('SELECT id FROM organizer_push_subscriptions WHERE revoked_at IS NULL').first()).toBeNull();
});
it('bounds provider retries and scheduler recovers failed attempts',async()=>{
 vi.mocked(fetch).mockResolvedValue(new Response(null,{status:503}));const id=await captured();
 for(let i=0;i<3;i++){await env.DB.prepare('UPDATE organizer_rsvp_push_deliveries SET lease_until=NULL WHERE id=?').bind(id).run();await retryOrganizerRsvpPush(env);}
 expect(fetch).toHaveBeenCalledTimes(3);expect((await pending())[0]).toMatchObject({attempts:3,outcome:'failed'});
});
it('keeps opt-out separate from guest devices and does not backfill after opting in again',async()=>{
 await DELETE(request('DELETE'));await rsvp('requested');expect(await pending()).toHaveLength(0);
 await POST(request('POST'));expect(await pending()).toHaveLength(0);
});
it('requires host authentication, same origin and valid keys; cannot steal another host device',async()=>{
 expect((await POST(request('POST',{},''))).status).toBe(403);
 expect((await POST(request('POST',{endpoint,keys},cookie,'https://evil.test'))).status).toBe(403);
 expect((await POST(request('POST',{endpoint,keys:{auth:'bad',p256dh:'bad'}}))).status).toBe(400);
 const other=await staff();expect((await POST(request('POST',{endpoint,keys},other.cookie))).status).toBe(409);
 const owner=await staff('owner');expect((await GET(request('GET',{},owner.cookie))).status).toBe(200);
 expect((await GET(new Request(origin+'/api/organizer/notifications/subscription?endpoint='+encodeURIComponent(endpoint),{headers:{cookie:other.cookie}}))).status).toBe(200);
});
it('rolls back the captured alert with the RSVP transaction',async()=>{
 const id=await rsvp();await expect(env.DB.batch([env.DB.prepare("UPDATE event_registrations SET status='requested' WHERE id=?").bind(id),env.DB.prepare('INSERT INTO table_that_does_not_exist VALUES(1)')])).rejects.toThrow();expect(await pending()).toHaveLength(0);
});
it('blocks both new and previously queued host RSVP emails without touching guest confirmation mail',async()=>{
 const {sendEmail,retryFailedDeliveries}=await import('../lib/email-delivery');
 const registrationId=await rsvp('requested'),key=`organizer-signup/${slug}/${registrationId}/${accountId}`;
 const input={db:env.DB,kind:'organizer_signup' as const,recipient:`${accountId}@example.com`,subject:'Signup',html:'<p>Signup</p>',text:'Signup',idempotencyKey:key};
 expect(await sendEmail(input)).toEqual({sent:false,reason:'host_rsvp_push_only'});expect(fetch).not.toHaveBeenCalled();
 const deliveryId=crypto.randomUUID();await env.DB.prepare(`INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at) VALUES(?,'organizer_signup',?,'queued',0,?,'2000-01-01','2000-01-01')`).bind(deliveryId,input.recipient,JSON.stringify({...input,db:undefined,provider:'resend'})).run();
 await retryFailedDeliveries(env,20,'all');
 expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(deliveryId).first()).toEqual({status:'suppressed'});expect(fetch).not.toHaveBeenCalled();
 vi.mocked(fetch).mockResolvedValue(Response.json({id:'guest-email-fixture'}));
 expect(await sendEmail({...input,kind:'registration_update',idempotencyKey:'guest-confirmation/'+registrationId,recipient:'guest@example.com'})).toMatchObject({sent:true});expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not capture for a host who is not assigned to the RSVP event',async()=>{
 await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();await rsvp('requested');expect(await pending()).toHaveLength(0);
});
it('disabling an opted-in device cancels queued pushes',async()=>{
 const id=await captured();expect((await DELETE(request('DELETE'))).status).toBe(200);await deliverOrganizerRsvpPush(env,id);expect(fetch).not.toHaveBeenCalled();
});
it('expires stale deliveries without contacting the provider',async()=>{
 const id=await captured();await env.DB.prepare("UPDATE organizer_rsvp_push_deliveries SET created_at='2000-01-01' WHERE id=?").bind(id).run();await retryOrganizerRsvpPush(env);expect(fetch).not.toHaveBeenCalled();expect((await pending())[0].outcome).toBe('expired');
});
it('bounds active host subscriptions to twelve devices',async()=>{
 for(let i=1;i<12;i++)expect((await POST(request('POST',{endpoint:endpoint+i,keys}))).status).toBe(200);
 expect((await POST(request('POST',{endpoint:endpoint+'overflow',keys}))).status).toBe(409);
});
it('queues captured RSVP alerts immediately and leaves durable work when enqueue fails',async()=>{
 const {enqueueOrganizerRsvpPush}=await import('../lib/organizer-rsvp-push');
 const registrationId=await rsvp('requested'),id=(await pending())[0].id;
 const sendBatch=vi.fn().mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValue(undefined);
 const queue={sendBatch} as unknown as NonNullable<Cloudflare.Env['EMAIL_DELIVERY_QUEUE']>;
 await expect(enqueueOrganizerRsvpPush(env.DB,queue,registrationId)).rejects.toThrow('queue unavailable');expect((await pending())[0].outcome).toBeNull();
 await enqueueOrganizerRsvpPush(env.DB,queue,registrationId);expect(sendBatch).toHaveBeenLastCalledWith([{body:{deliveryId:`organizer-rsvp:${id}`}}]);
});

it.each(['revoked','expired','disabled'])('allows a fresh opt-in to transfer an inactive %s device without replaying old work',async(change)=>{
 const id=await captured();
 if(change==='revoked')await DELETE(request('DELETE'));
 if(change==='expired')await env.DB.prepare("UPDATE staff_sessions SET expires_at='2000-01-01' WHERE account_id=?").bind(accountId).run();
 if(change==='disabled')await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(accountId).run();
 const other=await staff();
 expect((await POST(request('POST',{endpoint,keys},other.cookie))).status).toBe(200);
 await deliverOrganizerRsvpPush(env,id);expect(fetch).not.toHaveBeenCalled();
 expect(await env.DB.prepare('SELECT account_id AS accountId FROM organizer_push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toEqual({accountId:other.id});
});
it('expired sessions do not consume the active device limit',async()=>{
 for(let i=1;i<12;i++)expect((await POST(request('POST',{endpoint:endpoint+i,keys}))).status).toBe(200);
 await env.DB.prepare("UPDATE staff_sessions SET expires_at='2000-01-01' WHERE account_id=?").bind(accountId).run();
 cookie=adminCookieHeader(await createStaffSession(env.DB,{id:accountId})).split(';')[0];
 expect((await POST(request('POST',{endpoint:endpoint+'new-session',keys}))).status).toBe(200);
});
it.each(['logout','unassigned','optout'])('rechecks %s while encryption yields before contacting the provider',async(change)=>{
 const id=await captured();
 vi.mocked(generateRequestDetails).mockImplementationOnce(async()=>{
  if(change==='logout')await env.DB.prepare('UPDATE staff_sessions SET revoked_at=? WHERE account_id=?').bind(new Date().toISOString(),accountId).run();
  if(change==='unassigned')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();
  if(change==='optout')await DELETE(request('DELETE'));
  return {endpoint,method:'POST',headers:{},body:new Uint8Array([1])};
 });
 await deliverOrganizerRsvpPush(env,id);expect(fetch).not.toHaveBeenCalled();expect((await pending())[0].outcome).toBe('ineligible');
});
it.each(['support','finance','gate','moderator','curator'])('rejects subscriptions for the %s role',async(role)=>{
 const other=await staff(role);expect((await POST(request('POST',{endpoint,keys},other.cookie))).status).toBe(403);
});
it('old sessions cannot revoke the device after it is transferred to another account',async()=>{
 await DELETE(request('DELETE'));const other=await staff();await POST(request('POST',{endpoint,keys},other.cookie));
 await DELETE(request('DELETE'));
 expect(await env.DB.prepare('SELECT account_id AS accountId FROM organizer_push_subscriptions WHERE endpoint=? AND revoked_at IS NULL').bind(endpoint).first()).toEqual({accountId:other.id});
});

async function purchase(){
 const id=crypto.randomUUID(),tier=crypto.randomUUID(),now=new Date().toISOString(),expires=new Date(Date.now()+900000).toISOString();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO event_ticket_tiers(id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sort_order,created_at,updated_at) VALUES(?,?,'general','General','One admission',10000,1,10,10,'available',0,?,?)").bind(tier,slug,now,now),
  env.DB.prepare("INSERT INTO orders(id,reference,event_slug,ticket_type,ticket_tier_id,unit_quantity,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,status,reservation_expires_at,created_at) VALUES(?,?,?,'general',?,1,1,10000,0,10000,'GHS','buyer@example.invalid','','Private Buyer','card','payment_pending',?,?)").bind(id,id,slug,tier,expires,now),
  env.DB.prepare("INSERT INTO inventory_reservations(order_id,event_slug,ticket_tier_id,unit_quantity,admission_count,status,expires_at,created_at,updated_at) VALUES(?,?,?,1,1,'held',?,?,?)").bind(id,slug,tier,expires,now,now),
 ]);
 return {id,verification:{id,reference:id,status:'success',amount:10000,currency:'GHS',paidAt:now,channel:'card',gatewayResponse:'Approved'}};
}
async function purchaseJobs(){return (await env.DB.prepare('SELECT * FROM organizer_purchase_push_deliveries WHERE account_id=?').bind(accountId).all<{id:string;order_id:string;outcome:string|null;attempts:number}>()).results;}
async function pay(p:Awaited<ReturnType<typeof purchase>>){const {fulfillVerifiedPayment}=await import('../lib/payment-operations');return fulfillVerifiedPayment(env.DB,p.verification);}
it('captures purchases only at verified success, deduplicates callbacks and does not backfill later opt-ins',async()=>{
 const p=await purchase();expect(await purchaseJobs()).toHaveLength(0);
 expect((await pay(p)).result).toBe('paid');expect(await purchaseJobs()).toHaveLength(1);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_id=?').bind(p.id).first()).toEqual({n:1});
 expect((await POST(request('POST',{endpoint:endpoint+'-later',keys}))).status).toBe(200);
 await Promise.all([pay(p),pay(p)]);expect(await purchaseJobs()).toHaveLength(1);
 const mail=await env.DB.prepare("SELECT status FROM delivery_events WHERE kind='organizer_signup' AND recipient=? ORDER BY created_at DESC LIMIT 1").bind(`${accountId}@example.com`).first<{status:string}>();expect(mail).not.toBeNull();expect(mail!.status).not.toBe('suppressed');
});
it.each(['pending','mismatch','cancelled'])('does not capture a %s payment as a host purchase',async scenario=>{
 const p=await purchase();if(scenario==='pending')p.verification.status='pending';if(scenario==='mismatch')p.verification.amount=1;
 if(scenario==='cancelled')await env.DB.prepare("UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?").bind(slug).run();
 await pay(p);expect(await purchaseJobs()).toHaveLength(0);
});
it('rolls purchase capture back with a failed payment transaction',async()=>{
 const {captureOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');const p=await purchase();
 await expect(env.DB.batch([env.DB.prepare("UPDATE orders SET status='paid',payment_verified_at=? WHERE id=?").bind(new Date().toISOString(),p.id),captureOrganizerPurchasePush(env.DB,p.id,new Date().toISOString()),env.DB.prepare('INSERT INTO missing_table VALUES(1)')])).rejects.toThrow();
 expect(await purchaseJobs()).toHaveLength(0);expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(p.id).first()).toEqual({status:'payment_pending'});
});
it('shares device delivery safeguards and uses a private purchase preview and guest destination',async()=>{
 const {deliverOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');const p=await purchase();await pay(p);vi.mocked(fetch).mockClear();
 const job=(await purchaseJobs())[0];await Promise.all([deliverOrganizerPurchasePush(env,job.id),deliverOrganizerPurchasePush(env,job.id)]);
 expect(fetch).toHaveBeenCalledTimes(1);expect((await purchaseJobs())[0].outcome).toBe('accepted');
 const payload=JSON.parse(vi.mocked(generateRequestDetails).mock.calls.at(-1)![1] as string);
 expect(payload).toMatchObject({kind:'organizer_purchase',url:`/organizer/workspace?area=events&event=${slug}&view=guests`});
 expect(JSON.stringify(payload)).not.toMatch(/Private Buyer|buyer@example|10000/u);
});
it.each(['refund','assignment','session','consent'])('rechecks %s before sending a captured purchase',async change=>{
 const {deliverOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');const p=await purchase();await pay(p);const job=(await purchaseJobs())[0];vi.mocked(fetch).mockClear();
 if(change==='refund')await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(p.id).run();
 if(change==='assignment')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();
 if(change==='session')await env.DB.prepare('UPDATE staff_sessions SET revoked_at=? WHERE account_id=?').bind(new Date().toISOString(),accountId).run();
 if(change==='consent')await env.DB.prepare("UPDATE organizer_push_subscriptions SET consent_id='renewed' WHERE account_id=?").bind(accountId).run();
 await deliverOrganizerPurchasePush(env,job.id);expect(fetch).not.toHaveBeenCalled();expect((await purchaseJobs())[0].outcome).toBe('ineligible');
});
it('expires purchase backlog and queues only recent unfinished jobs',async()=>{
 const {retryOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');const p=await purchase();await pay(p);const job=(await purchaseJobs())[0];
 const queue=vi.fn().mockResolvedValue(undefined);env.EMAIL_DELIVERY_QUEUE={send:queue} as unknown as NonNullable<Cloudflare.Env['EMAIL_DELIVERY_QUEUE']>;
 try{await retryOrganizerPurchasePush(env);expect(queue).toHaveBeenCalledWith({deliveryId:`organizer-purchase:${job.id}`});queue.mockClear();await env.DB.prepare("UPDATE organizer_purchase_push_deliveries SET created_at='2000-01-01' WHERE id=?").bind(job.id).run();await retryOrganizerPurchasePush(env);expect(queue).not.toHaveBeenCalled();expect((await purchaseJobs())[0].outcome).toBe('expired');}finally{delete env.EMAIL_DELIVERY_QUEUE;}
});

it.each(['logout','unassigned','optout'])('rechecks purchase %s after encryption yields',async change=>{
 const {deliverOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');const p=await purchase();await pay(p);const job=(await purchaseJobs())[0];vi.mocked(fetch).mockClear();
 vi.mocked(generateRequestDetails).mockImplementationOnce(async()=>{
  if(change==='logout')await env.DB.prepare('UPDATE staff_sessions SET revoked_at=? WHERE account_id=?').bind(new Date().toISOString(),accountId).run();
  if(change==='unassigned')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();
  if(change==='optout')await DELETE(request('DELETE'));
  return {endpoint,method:'POST',headers:{},body:new Uint8Array([1])};
 });
 await deliverOrganizerPurchasePush(env,job.id);expect(fetch).not.toHaveBeenCalled();expect((await purchaseJobs())[0].outcome).toBe('ineligible');
});
it.each(['unassigned','optout','free'])('captures no purchase for %s at the paid transition',async change=>{
 const p=await purchase();
 if(change==='unassigned')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(accountId).run();
 if(change==='optout')await DELETE(request('DELETE'));
 if(change==='free'){await env.DB.prepare('UPDATE orders SET total_amount_minor=0 WHERE id=?').bind(p.id).run();p.verification.amount=0;}
 await pay(p);expect(await purchaseJobs()).toHaveLength(0);
});
it('queue failure preserves a confirmed purchase and durable alert for recovery',async()=>{
 const p=await purchase();env.EMAIL_DELIVERY_QUEUE={sendBatch:vi.fn().mockRejectedValue(new Error('isolated queue failure')),send:vi.fn().mockResolvedValue(undefined)} as unknown as NonNullable<Cloudflare.Env['EMAIL_DELIVERY_QUEUE']>;
 try{expect((await pay(p)).result).toBe('paid');expect(await purchaseJobs()).toHaveLength(1);expect((await purchaseJobs())[0].outcome).toBeNull();}finally{delete env.EMAIL_DELIVERY_QUEUE;}
});

async function capturedHostAlert(kind:'rsvp'|'purchase'){
 const {deliverOrganizerPurchasePush}=await import('../lib/organizer-rsvp-push');
 const id=kind==='rsvp'?await captured():await (async()=>{const p=await purchase();await pay(p);return (await purchaseJobs())[0].id;})();
 vi.mocked(fetch).mockClear();vi.mocked(generateRequestDetails).mockClear();
 return {id,deliver:()=>kind==='rsvp'?deliverOrganizerRsvpPush(env,id):deliverOrganizerPurchasePush(env,id),
  outcome:async()=>kind==='rsvp'?(await pending())[0].outcome:(await purchaseJobs())[0].outcome};
}
for(const kind of ['rsvp','purchase'] as const){
 it.each(['past','elapsed','cancelled','postponed'])(`suppresses queued ${kind} after event becomes %s`,async state=>{
  const job=await capturedHostAlert(kind);
  if(state==='elapsed')await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE slug=?').bind(new Date(Date.now()-1000).toISOString(),slug).run();
  else await env.DB.prepare('UPDATE curated_event_records SET event_state=? WHERE slug=?').bind(state,slug).run();
  await job.deliver();expect(fetch).not.toHaveBeenCalled();expect(generateRequestDetails).not.toHaveBeenCalled();expect(await job.outcome()).toBe('ineligible');
 });
 it.each(['past','elapsed'])(`rechecks ${kind} event becoming %s during encryption`,async state=>{
  const job=await capturedHostAlert(kind),end=Date.now()+10000;
  await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE slug=?').bind(new Date(end).toISOString(),slug).run();
  vi.mocked(generateRequestDetails).mockImplementationOnce(async()=>{
   if(state==='past')await env.DB.prepare("UPDATE curated_event_records SET event_state='past' WHERE slug=?").bind(slug).run();
   else vi.spyOn(Date,'now').mockReturnValue(end+1);
   return {endpoint,method:'POST',headers:{},body:new Uint8Array([1])};
  });
  await job.deliver();expect(generateRequestDetails).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();expect(await job.outcome()).toBe('ineligible');
 });
 it(`stops a recent ${kind} provider retry after the event ends`,async()=>{
  const job=await capturedHostAlert(kind),end=Date.now()+10000;
  await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE slug=?').bind(new Date(end).toISOString(),slug).run();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:503}));
  await job.deliver();expect(fetch).toHaveBeenCalledTimes(1);expect(await job.outcome()).toBeNull();
  await env.DB.prepare(`UPDATE organizer_${kind}_push_deliveries SET lease_until=NULL WHERE id=?`).bind(job.id).run();
  vi.spyOn(Date,'now').mockReturnValue(end+1);
  await job.deliver();expect(fetch).toHaveBeenCalledTimes(1);expect(await job.outcome()).toBe('ineligible');
 });
 it.each(['active','coming_soon','exact_end'])(`preserves ${kind} delivery for %s events`,async state=>{
  const job=await capturedHostAlert(kind),now=Date.now();
  if(state==='coming_soon')await env.DB.prepare("UPDATE curated_event_records SET schedule_status='coming_soon',ends_at=? WHERE slug=?").bind(new Date(now-1000).toISOString(),slug).run();
  if(state==='exact_end'){
   await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE slug=?').bind(new Date(now).toISOString(),slug).run();
   vi.spyOn(Date,'now').mockReturnValue(now);
  }
  await job.deliver();await job.deliver();expect(fetch).toHaveBeenCalledTimes(1);expect(await job.outcome()).toBe('accepted');
 });
}

async function useOwner(){
 await DELETE(request('DELETE'));
 const owner=await staff('owner');accountId=owner.id;cookie=owner.cookie;
 expect((await POST(request('POST'))).status).toBe(200);
}
it.each(['requested','unverified'])('owner captures %s RSVPs without assignments, exactly once per device',async status=>{
 await useOwner();
 const id=await rsvp(status);
 if(status==='unverified')await env.DB.prepare("UPDATE event_registrations SET status='requested' WHERE id=?").bind(id).run();
 await env.DB.prepare("UPDATE event_registrations SET status='confirmed' WHERE id=?").bind(id).run();
 expect(await pending()).toHaveLength(1);
 await Promise.all([deliverOrganizerRsvpPush(env,(await pending())[0].id),deliverOrganizerRsvpPush(env,(await pending())[0].id)]);
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('owner and assigned host receive independent alerts without unassigned-host leakage',async()=>{
 const hostId=accountId,owner=await staff('owner'),other=await staff();
 expect((await POST(request('POST',{endpoint:endpoint+'-owner',keys},owner.cookie))).status).toBe(200);
 expect((await POST(request('POST',{endpoint:endpoint+'-other',keys},other.cookie))).status).toBe(200);
 await rsvp('requested');
 const recipients=await env.DB.prepare('SELECT account_id FROM organizer_rsvp_push_deliveries ORDER BY account_id').all<{account_id:string}>();
 expect(recipients.results.map(r=>r.account_id).sort()).toEqual([hostId,owner.id].sort());
});
it('owner assignment rows do not multiply notification capture',async()=>{
 await useOwner();const now=new Date().toISOString();
 await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(accountId,slug,accountId,now).run();
 await rsvp('requested');expect(await pending()).toHaveLength(1);
 const p=await purchase();await pay(p);await pay(p);expect(await purchaseJobs()).toHaveLength(1);
});
it('active owner device cannot be taken over by organizer or another owner',async()=>{
 await useOwner();
 for(const role of ['organizer','owner']){
  const other=await staff(role);
  expect((await POST(request('POST',{endpoint,keys},other.cookie))).status).toBe(409);
  expect(await env.DB.prepare('SELECT account_id FROM organizer_push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toEqual({account_id:accountId});
 }
});
it('owner opt-out, re-enable and repeated subscription writes never backfill or duplicate a device',async()=>{
 await useOwner();await DELETE(request('DELETE'));await rsvp('requested');
 const p=await purchase();await pay(p);
 await POST(request('POST'));await POST(request('POST'));await pay(p);
 expect(await pending()).toHaveLength(0);expect(await purchaseJobs()).toHaveLength(0);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM organizer_push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toEqual({n:1});
 await rsvp('requested');expect(await pending()).toHaveLength(1);
});
for(const kind of ['rsvp','purchase'] as const){
 it(`owner receives new ${kind} without assignment`,async()=>{
  await useOwner();const job=await capturedHostAlert(kind);
  await job.deliver();await job.deliver();expect(fetch).toHaveBeenCalledTimes(1);expect(await job.outcome()).toBe('accepted');
 });
 it.each(['organizer','curator','finance','support','gate','moderator','disabled','password','logout','expired','consent','ended','archived'])(`owner queued ${kind} revalidates %s`,async change=>{
  await useOwner();const job=await capturedHostAlert(kind);
  if(['organizer','curator','finance','support','gate','moderator'].includes(change))await env.DB.prepare('UPDATE staff_accounts SET role=? WHERE id=?').bind(change,accountId).run();
  if(change==='disabled')await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(accountId).run();
  if(change==='password')await env.DB.prepare('UPDATE staff_accounts SET must_change_password=1 WHERE id=?').bind(accountId).run();
  if(change==='logout')await env.DB.prepare("UPDATE staff_sessions SET revoked_at='2020-01-01' WHERE account_id=?").bind(accountId).run();
  if(change==='expired')await env.DB.prepare("UPDATE staff_sessions SET expires_at='2020-01-01' WHERE account_id=?").bind(accountId).run();
  if(change==='consent')await DELETE(request('DELETE'));
  if(change==='archived')await env.DB.prepare('UPDATE curated_event_records SET archived_at=? WHERE slug=?').bind(new Date().toISOString(),slug).run();
  if(change==='ended')await env.DB.prepare("UPDATE curated_event_records SET event_state='past' WHERE slug=?").bind(slug).run();
  await job.deliver();expect(fetch).not.toHaveBeenCalled();expect(await job.outcome()).toBe('ineligible');
 });
 it(`owner ${kind} revalidates downgrade while encryption yields`,async()=>{
  await useOwner();const job=await capturedHostAlert(kind);
  vi.mocked(generateRequestDetails).mockImplementationOnce(async()=>{
   await env.DB.prepare("UPDATE staff_accounts SET role='organizer' WHERE id=?").bind(accountId).run();
   return {endpoint,method:'POST',headers:{},body:new Uint8Array([1])};
  });
  await job.deliver();expect(fetch).not.toHaveBeenCalled();expect(await job.outcome()).toBe('ineligible');
 });
}
