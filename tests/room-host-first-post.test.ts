import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../lib/attendee-auth';
import { createStaffSession } from '../lib/admin-session';
import { GET as ownerDeliveryRead } from '../app/api/admin/host-pass/route';
import { firstHostDeliveryIssues, deliverFirstHostEmail, queueFirstHostPost, readCurrentRoomHost, retryFirstHostEmails, type FirstHostPost } from '../lib/room-host-first-post';
import { GET as inbox } from '../app/api/customer/notifications/route';
import { deliverHostAnnouncement } from '../lib/notifications';
import { retryFailedDeliveries } from '../lib/email-delivery';

async function fixture(eventSlug?:string) {
 const id=crypto.randomUUID(),slug=eventSlug??`first-host-${id}`,now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
 const host=`host-${id}`,guest=`guest-${id}`,account=`account-${id}`;
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
    SELECT ?,?,?,'Synthetic Night',venue,area,?,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,future,now,now,now),
  env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
    VALUES (?,?,'Synthetic Host','organizer','test','test',600000,0,'active',?,?,'fixture',?)`).bind(account,`${host}@example.com`,now,now,now),
  env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(account,slug,account,now),
 ]);
 for(const who of [host,guest])await env.DB.batch([
  env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Synthetic guest','active',?,?,?)").bind(who,`${who}@example.com`,now,now,now),
  env.DB.prepare("INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)").bind(who,who,await hashToken(who),future,now,now),
  env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES(?,?,?,1,10000,0,10000,'GHS',?,'233000000000','card','paid',?,?)").bind(who,who,slug,`${who}@example.com`,now,now),
  env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)").bind(who,who,slug,who,now),
  env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'fixture','active',?)").bind(who,who,now),
 ]);
 return {id,slug,now,future,host,guest,account,post:{eventSlug:slug,hostAccountId:account,senderAttendeeId:host,messageId:crypto.randomUUID(),createdAt:now} satisfies FirstHostPost};
}
const enabled=(f:Awaited<ReturnType<typeof fixture>>,overrides:Partial<Cloudflare.Env>={})=>({...env,ROOM_HOST_FIRST_POST_ENABLED:'1',ROOM_HOST_FIRST_POST_EVENT_SLUG:f.slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:f.account,...overrides});
async function source(f:Awaited<ReturnType<typeof fixture>>) {
 await runInDurableObject(env.THE_ROOM.getByName(f.slug),async(_instance,state)=>{
  state.storage.sql.exec("INSERT INTO messages(id,attendee_id,display_name,role,kind,content,pinned,created_at) VALUES(?,?,'Synthetic Host','organizer','message','Private synthetic content',0,?)",f.post.messageId,f.host,f.now);
 });
}
async function counts(f:Awaited<ReturnType<typeof fixture>>) {
 return {
  notices:await env.DB.prepare("SELECT COUNT(*) AS n FROM attendee_notifications WHERE event_slug=? AND kind='host_first_post'").bind(f.slug).first(),
  emails:await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE kind='room_host_post' AND json_extract(payload_json,'$.eventSlug')=?").bind(f.slug).first(),
  pushes:await env.DB.prepare('SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).first(),
 };
}
const emailId=(f:Awaited<ReturnType<typeof fixture>>)=>`room-first-email/${f.post.messageId}/${f.guest}`;
afterEach(()=>vi.restoreAllMocks());

async function subscribe(f:Awaited<ReturnType<typeof fixture>>,options:{revoked?:boolean;hostUpdates?:number;attendee?:string}={}) {
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO push_subscriptions(id,attendee_id,endpoint,p256dh,auth,created_at,updated_at,revoked_at,host_updates)
   VALUES(?,?,?,'synthetic-key','synthetic-auth',?,?,?,?)`)
   .bind(id,options.attendee??f.guest,`https://push.example.com/${id}`,f.now,f.now,options.revoked?f.now:null,options.hostUpdates??1).run();
}

async function rsvpContact(f:Awaited<ReturnType<typeof fixture>>) {
 await env.DB.batch([
  env.DB.prepare("UPDATE orders SET payment_provider='rsvp' WHERE id=?").bind(f.guest),
  env.DB.prepare("UPDATE attendee_profiles SET email_verified_at=NULL WHERE id=?").bind(f.guest),
  env.DB.prepare("INSERT INTO event_registration_settings(event_slug,mode,capacity,room_access,updated_at) VALUES(?,'rsvp',100,1,?)").bind(f.slug,f.now),
  env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,kind,status,attendee_id,order_id,device_claimed_at,created_at,updated_at)
    VALUES(?,?,?,'Synthetic RSVP','rsvp','confirmed',?,?,?,?,?)`).bind(f.id,f.slug,`${f.guest}@example.com`,f.guest,f.guest,f.now,f.now,f.now),
 ]);
}

describe('first host post fanout',()=>{
 it('reports only original scoped bad booking contacts without IDs, bodies or new send attempts',async()=>{
  const f=await fixture('puro-exceso-20261024');await rsvpContact(f);
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,failure_reason,created_at,updated_at) VALUES(?,'registration_update',?,'bounced','Mailbox does not exist',?,?)").bind(f.id,`${f.guest}@example.com`,f.now,f.now).run();
  await queueFirstHostPost(enabled(f),f.post);
  expect(await firstHostDeliveryIssues(enabled(f))).toEqual([{address:`${f.guest}@example.com`,status:'bounced',reason:'Mailbox does not exist',timestamp:f.now,category:'suppressed'}]);
  expect((await counts(f)).emails).toEqual({n:0});
  const owner=await fixture();await env.DB.prepare("UPDATE staff_accounts SET role='owner' WHERE id=?").bind(owner.account).run();
  const token=await createStaffSession(env.DB,{id:owner.account});
  const original={ROOM_HOST_FIRST_POST_ENABLED:env.ROOM_HOST_FIRST_POST_ENABLED,ROOM_HOST_FIRST_POST_EVENT_SLUG:env.ROOM_HOST_FIRST_POST_EVENT_SLUG,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID};
  Object.assign(env,{ROOM_HOST_FIRST_POST_ENABLED:'1',ROOM_HOST_FIRST_POST_EVENT_SLUG:f.slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:f.account});
  try {
   const response=await ownerDeliveryRead(new Request(`https://tickets.becoreops.com/api/admin/host-pass?accountId=${f.account}&email=${f.host}@example.com&deliveryIssues=first-host`,{headers:{cookie:`bct_staff=${token}`}}));
   expect(response.headers.get('cache-control')).toBe('no-store, private');
   expect(await response.json()).toMatchObject({available:true,deliveryIssues:[{address:`${f.guest}@example.com`,status:'bounced',reason:'Mailbox does not exist'}]});
  }finally{Object.assign(env,original);}
  const additional=[];
  for(let i=0;i<4;i++){
   const g=await fixture();additional.push(g.guest);
   await env.DB.batch([
    env.DB.prepare("UPDATE orders SET event_slug=?,payment_provider='rsvp' WHERE id=?").bind(f.slug,g.guest),
    env.DB.prepare('UPDATE tickets SET event_slug=? WHERE id=?').bind(f.slug,g.guest),
    env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,kind,status,attendee_id,order_id,device_claimed_at,created_at,updated_at) VALUES(?,?,?,'Synthetic','rsvp','confirmed',?,?,?,?,?)`).bind(g.id,f.slug,`${g.guest}@example.com`,g.guest,g.guest,f.now,f.now,f.now),
    env.DB.prepare(`INSERT INTO attendee_notifications(id,attendee_id,event_slug,kind,title,body,url,source_id,created_at) SELECT ?,?,event_slug,kind,title,body,url,source_id,created_at FROM attendee_notifications WHERE attendee_id=? AND source_id=?`).bind(g.id,g.guest,f.guest,f.post.messageId),
    env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,created_at,updated_at) VALUES(?,'registration_update',?,'complained',?,?)").bind(g.id,`${g.guest}@example.com`,f.now,f.now),
   ]);
  }
  await expect(firstHostDeliveryIssues(enabled(f))).rejects.toThrow('Suppressed cohort changed');
  for(const id of additional)await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE attendee_id=?").bind(id).run();
  await expect(firstHostDeliveryIssues(enabled(f,{ROOM_HOST_FIRST_POST_EVENT_SLUG:'other'}))).rejects.toThrow();
  expect(await firstHostDeliveryIssues(enabled(f,{ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:'other'}))).toEqual([]);
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,failure_reason,created_at,updated_at) VALUES(?,'room_host_post',?,'uncertain',1,?,'Provider outcome unknown',?,?)").bind(emailId(f),`${f.guest}@example.com`,JSON.stringify({eventSlug:f.slug,messageId:f.post.messageId,attendeeId:f.guest}),f.now,f.now).run();
  expect(await firstHostDeliveryIssues(enabled(f))).toEqual([{address:`${f.guest}@example.com`,status:'uncertain',reason:'Provider outcome unknown',timestamp:f.now,category:'uncertain'}]);
  await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE attendee_id=?").bind(f.guest).run();
  expect(await firstHostDeliveryIssues(enabled(f))).toEqual([]);
  await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE attendee_id IN (?,?)").bind(f.host,f.guest).run();
  await env.DB.prepare('DELETE FROM delivery_events WHERE id=?').bind(emailId(f)).run();
  await env.DB.prepare('DELETE FROM curated_event_records WHERE id=?').bind(f.id).run();
 });
 it('uses the confirmed RSVP contact without upgrading account verification or trusting an edited profile address',async()=>{
  const f=await fixture();await rsvpContact(f);await source(f);
  await env.DB.prepare("UPDATE attendee_profiles SET normalized_email='edited-profile@example.com' WHERE id=?").bind(f.guest).run();
  const send=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:crypto.randomUUID()}),{status:200}));
  await queueFirstHostPost(enabled(f),f.post);
  expect(await env.DB.prepare('SELECT recipient FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({recipient:`${f.guest}@example.com`});
  await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));expect(send).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT email_verified_at FROM attendee_profiles WHERE id=?').bind(f.guest).first()).toEqual({email_verified_at:null});
 });
 it.each(['transferred','mismatched-order-email','no-submission-proof','booking-optout','booking-event-optout','booking-bounce','booking-complaint','push'])('does not route RSVP email when %s',async reason=>{
  const f=await fixture();await rsvpContact(f);
  if(reason.startsWith('booking-'))await env.DB.prepare("UPDATE attendee_profiles SET normalized_email='edited-profile@example.com' WHERE id=?").bind(f.guest).run();
  if(reason==='transferred')await env.DB.prepare('UPDATE event_registrations SET attendee_id=? WHERE id=?').bind(f.host,f.id).run();
  if(reason==='mismatched-order-email')await env.DB.prepare("UPDATE orders SET customer_email='other@example.com' WHERE id=?").bind(f.guest).run();
  if(reason==='no-submission-proof')await env.DB.prepare('UPDATE event_registrations SET device_claimed_at=NULL WHERE id=?').bind(f.id).run();
  if(reason==='booking-optout')await env.DB.prepare('INSERT INTO marketing_contacts(email,unsubscribed,updated_at) VALUES(?,1,?)').bind(`${f.guest}@example.com`,f.now).run();
  if(reason==='booking-event-optout')await env.DB.prepare("INSERT INTO event_audience_contacts(id,event_slug,email,guest_name,source,unsubscribed_at,unsubscribe_token,confirmed_at) VALUES(?,?,?,'Synthetic','rsvp',?,'synthetic',?)").bind(f.id,f.slug,`${f.guest}@example.com`,f.now,f.now).run();
  if(reason==='booking-bounce'||reason==='booking-complaint')await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,created_at,updated_at) VALUES(?,'registration_update',?,?,?,?)").bind(f.id,`${f.guest}@example.com`,reason==='booking-bounce'?'bounced':'complained',f.now,f.now).run();
  if(reason==='push')await subscribe(f);
  await queueFirstHostPost(enabled(f),f.post);expect((await counts(f)).emails).toEqual({n:0});
 });
 it('suppresses queued RSVP mail after booking contact changes and does not resend a delivered job',async()=>{
  const f=await fixture();await rsvpContact(f);await source(f);await queueFirstHostPost(enabled(f),f.post);
  await env.DB.prepare("UPDATE event_registrations SET normalized_email='changed@example.com' WHERE id=?").bind(f.id).run();
  const send=vi.spyOn(globalThis,'fetch');await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));expect(send).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'suppressed'});
  await env.DB.prepare("UPDATE delivery_events SET status='delivered',attempt_count=1 WHERE id=?").bind(emailId(f)).run();
  await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));expect(send).not.toHaveBeenCalled();
 });
 it.each(['active','revoked','host-updates-off','other-attendee'])('uses the %s push preference without altering inbox or essential email jobs',async state=>{
  const f=await fixture();
  await subscribe(f,{revoked:state==='revoked',hostUpdates:state==='host-updates-off'?0:1,attendee:state==='other-attendee'?f.host:f.guest});
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,created_at,updated_at) VALUES(?,'payment_confirmation',?,'queued',0,?,?)").bind(f.id,`${f.guest}@example.com`,f.now,f.now).run();
  await queueFirstHostPost(enabled(f),f.post);
  expect(await counts(f)).toEqual({notices:{n:1},emails:{n:state==='active'?0:1},pushes:{n:1}});
  expect(await env.DB.prepare('SELECT status,attempt_count FROM delivery_events WHERE id=?').bind(f.id).first()).toEqual({status:'queued',attempt_count:0});
 });

 it('is off by default and requires verified event-assigned active host identity',async()=>{
  const f=await fixture();await queueFirstHostPost({...env,ROOM_HOST_FIRST_POST_ENABLED:undefined},f.post);expect((await counts(f)).emails).toEqual({n:0});
  expect(await readCurrentRoomHost(env.DB,f.host,f.slug)).toMatchObject({accountId:f.account});
  expect(await readCurrentRoomHost(env.DB,f.guest,f.slug)).toBeNull();
  expect(await readCurrentRoomHost(env.DB,f.host,'other-event')).toBeNull();
  await env.DB.prepare('UPDATE attendee_profiles SET email_verified_at=NULL WHERE id=?').bind(f.host).run();
  expect(await readCurrentRoomHost(env.DB,f.host,f.slug)).toBeNull();await queueFirstHostPost(enabled(f),f.post);expect((await counts(f)).notices).toEqual({n:0});
 });
 it('uses only the verified linked PURO public alias without exposing staff or attendee names',async()=>{
  const f=await fixture('puro-exceso-20261024');
  await env.DB.prepare("INSERT INTO event_hosts(event_slug,host_id,role,is_primary,created_at) VALUES(?,'host:kofi-bills','Host',1,?)").bind(f.slug,f.now).run();
  expect(await readCurrentRoomHost(env.DB,f.host,f.slug)).toEqual({accountId:f.account,displayName:'Kofi Bills'});
  const c=await connectHost(f);
  try {
   c.socket.send(JSON.stringify({type:'message',content:'Public host greeting',displayName:'Client impersonation'}));
   await expect.poll(async()=>(await counts(f)).emails).toEqual({n:1});
   const posted=await runInDurableObject(c.room,async(_instance,state)=>state.storage.sql.exec<{display_name:string;role:string}>("SELECT display_name,role FROM messages WHERE kind='message'").toArray());
   expect(posted).toEqual([{display_name:'Kofi Bills',role:'organizer'}]);
   const mail=await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE kind='room_host_post' AND json_extract(payload_json,'$.eventSlug')=?").bind(f.slug).first<{payload:string}>();
   expect(mail?.payload).toContain('Kofi Bills');expect(mail?.payload).not.toMatch(/Synthetic Host|Synthetic guest|Client impersonation/);
  }finally{c.socket.close(1000);}
  expect(await env.DB.prepare('SELECT display_name AS name FROM staff_accounts WHERE id=?').bind(f.account).first()).toEqual({name:'Synthetic Host'});
  await env.DB.prepare('DELETE FROM event_hosts WHERE event_slug=?').bind(f.slug).run();
  expect(await readCurrentRoomHost(env.DB,f.host,f.slug)).toEqual({accountId:f.account,displayName:'Host'});
  await env.DB.prepare("INSERT INTO hosts(id,slug,name,bio,city,verification_status,created_at,updated_at) VALUES(?,?,'Unrelated public host','','Accra','verified',?,?)").bind(f.id,f.id,f.now,f.now).run();
  await env.DB.prepare("INSERT INTO event_hosts(event_slug,host_id,role,is_primary,created_at) VALUES(?,?,'Host',1,?)").bind(f.slug,f.id,f.now).run();
  expect(await readCurrentRoomHost(env.DB,f.host,f.slug)).toEqual({accountId:f.account,displayName:'Host'});
  const other=await fixture();
  await env.DB.prepare("INSERT INTO event_hosts(event_slug,host_id,role,is_primary,created_at) VALUES(?,'host:kofi-bills','Host',1,?)").bind(other.slug,other.now).run();
  expect(await readCurrentRoomHost(env.DB,other.host,other.slug)).toEqual({accountId:other.account,displayName:'Host'});
 });
 it('requires the exact approved host and event scope, not a global rollout',async()=>{
  const f=await fixture();await queueFirstHostPost(enabled(f,{ROOM_HOST_FIRST_POST_EVENT_SLUG:'other-event'}),f.post);
  await queueFirstHostPost(enabled(f,{ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:'other-host'}),f.post);
  await queueFirstHostPost(enabled(f,{ROOM_HOST_FIRST_POST_EVENT_SLUG:undefined,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:undefined}),f.post);
  expect(await counts(f)).toEqual({notices:{n:0},emails:{n:0},pushes:{n:0}});
 });
 it('atomically deduplicates concurrency and persists inbox entries for unsubscribed devices',async()=>{
  const f=await fixture();await Promise.all([queueFirstHostPost(enabled(f),f.post),queueFirstHostPost(enabled(f),f.post)]);
  expect(await counts(f)).toEqual({notices:{n:1},emails:{n:1},pushes:{n:1}});
  const notice=await env.DB.prepare('SELECT body,url FROM attendee_notifications WHERE attendee_id=?').bind(f.guest).first<{body:string;url:string}>();
  expect(notice?.body).not.toContain('Private synthetic content');expect(notice?.url).toContain('from=host-first-post');
  await env.DB.prepare('DELETE FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).run();
  await queueFirstHostPost(enabled(f),f.post);await queueFirstHostPost(enabled(f),{...f.post,messageId:crypto.randomUUID()});
  expect(await counts(f)).toEqual({notices:{n:1},emails:{n:1},pushes:{n:0}});
 });
 it('rolls back receipt and all channels after interrupted fanout',async()=>{
  const f=await fixture();
  await env.DB.exec(`CREATE TRIGGER fail_first_host BEFORE INSERT ON delivery_events WHEN NEW.kind='room_host_post' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
  try {await expect(queueFirstHostPost(enabled(f),f.post)).rejects.toThrow();}finally{await env.DB.exec('DROP TRIGGER fail_first_host;');}
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM room_host_first_posts WHERE event_slug=?').bind(f.slug).first()).toEqual({n:0});
  expect(await counts(f)).toEqual({notices:{n:0},emails:{n:0},pushes:{n:0}});
  await queueFirstHostPost(enabled(f),f.post);expect((await counts(f)).emails).toEqual({n:1});
 });
 it.each(['refunded','voided','unassigned','suspended','cancelled','muted','host-off','blocked'])('excludes %s recipients from all channels',async reason=>{
  const f=await fixture();
  if(reason==='refunded')await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(f.guest).run();
  if(reason==='voided')await env.DB.prepare("UPDATE tickets SET status='voided' WHERE id=?").bind(f.guest).run();
  if(reason==='unassigned')await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE ticket_id=?").bind(f.guest).run();
  if(reason==='suspended')await env.DB.prepare("INSERT INTO room_suspensions(event_slug,attendee_id,reason,suspended_at,suspended_by) VALUES(?,?,'fixture',?,'fixture')").bind(f.slug,f.guest,f.now).run();
  if(reason==='cancelled')await env.DB.prepare("UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?").bind(f.slug).run();
  if(reason==='muted'||reason==='host-off')await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,muted_until,updated_at) VALUES(?,?,1,?,?,?)').bind(f.guest,f.slug,reason==='host-off'?0:1,reason==='muted'?f.future:null,f.now).run();
  if(reason==='blocked')await env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES(?,?,?,?,?)').bind(f.id,f.slug,f.guest,f.host,f.now).run();
  await queueFirstHostPost(enabled(f),f.post);expect(await counts(f)).toEqual({notices:{n:0},emails:{n:0},pushes:{n:0}});
 });
 it('suppresses email to unverified or opted-out addresses without removing their in-app notice',async()=>{
  const f=await fixture();await env.DB.prepare('UPDATE attendee_profiles SET email_verified_at=NULL WHERE id=?').bind(f.guest).run();
  await queueFirstHostPost(enabled(f),f.post);expect(await counts(f)).toEqual({notices:{n:1},emails:{n:0},pushes:{n:1}});
 });
 it('rechecks access for only the new notice when reading the inbox',async()=>{
  const f=await fixture();await queueFirstHostPost(enabled(f),f.post);
  const request=()=>new Request('https://tickets.becoreops.com/api/customer/notifications',{headers:{cookie:`bct_attendee=${f.guest}`}});
  expect((await (await inbox(request())).json() as {notifications:unknown[]}).notifications).toHaveLength(1);
  await env.DB.prepare("UPDATE tickets SET status='voided' WHERE id=?").bind(f.guest).run();
  expect((await (await inbox(request())).json() as {notifications:unknown[]}).notifications).toHaveLength(0);
 });
});

describe('first host email delivery safety',()=>{
 it('suppresses an already queued Room email when push is enabled before handoff',async()=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);await subscribe(f);
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
  await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));
  expect(fetcher).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status,attempt_count FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'suppressed',attempt_count:0});
  await env.DB.prepare('UPDATE push_subscriptions SET revoked_at=? WHERE attendee_id=?').bind(f.now,f.guest).run();
  await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('rechecks a push subscription created between eligibility and the atomic email claim',async()=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);let intercepted=false;
  const db=new Proxy(env.DB,{get(target,key){
   if(key==='prepare')return (sql:string)=>{
    const statement=target.prepare(sql);
    if(!sql.startsWith("UPDATE delivery_events SET status='sending'"))return statement;
    return new Proxy(statement,{get(st,k){
     if(k==='bind')return (...args:unknown[])=>{const bound=st.bind(...args);return new Proxy(bound,{get(b,prop){
      if(prop==='run')return async()=>{intercepted=true;await subscribe(f);return b.run();};
      const value=Reflect.get(b,prop);return typeof value==='function'?value.bind(b):value;
     }});};
     const value=Reflect.get(st,k);return typeof value==='function'?value.bind(st):value;
    }});
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
  await deliverFirstHostEmail(enabled(f,{DB:db,EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),emailId(f));
  expect(intercepted).toBe(true);expect(fetcher).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status,attempt_count FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'queued',attempt_count:0});
 });

 const mailEnv=(f:Awaited<ReturnType<typeof fixture>>)=>enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'});
 it('sends one isolated generic email and never resends a duplicate job',async()=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'synthetic-provider-id'}),{status:200}));
  await Promise.all([deliverFirstHostEmail(mailEnv(f),emailId(f)),deliverFirstHostEmail(mailEnv(f),emailId(f))]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const sent=JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body));expect(sent.to).toEqual([`${f.guest}@example.com`]);
  expect(sent.from).toBe('BeCore Tickets <tickets@becoreops.com>');expect(sent.reply_to).toBe('tickets@becoreops.com');expect(sent.html).not.toContain('Private synthetic content');
  expect(await env.DB.prepare('SELECT status,attempt_count AS attempts FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'sent',attempts:1});
 });
 it('does not resend after timeout or let the generic retry worker resend',async()=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
  const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Synthetic network timeout'));
  await deliverFirstHostEmail(mailEnv(f),emailId(f));await deliverFirstHostEmail(mailEnv(f),emailId(f));
  expect(fetcher).toHaveBeenCalledTimes(1);expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'uncertain'});
  await env.DB.prepare("UPDATE delivery_events SET status='failed',next_attempt_at='2020-01-01',updated_at='2020-01-01' WHERE id=?").bind(emailId(f)).run();
  await retryFailedDeliveries(mailEnv(f));expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['pass','assignment','message','email'])('rechecks %s revocation before provider handoff',async reason=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
  if(reason==='pass')await env.DB.prepare("UPDATE tickets SET status='voided' WHERE id=?").bind(f.guest).run();
  if(reason==='assignment')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(f.account).run();
  if(reason==='message')await env.THE_ROOM.getByName(f.slug).removeMessage(f.post.messageId);
  if(reason==='email')await env.DB.prepare("UPDATE attendee_profiles SET normalized_email='changed@example.com' WHERE id=?").bind(f.guest).run();
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
  await deliverFirstHostEmail(mailEnv(f),emailId(f));expect(fetcher).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'suppressed'});
 });
 it('marks interrupted sending uncertain, never queues it again',async()=>{
  const f=await fixture();await queueFirstHostPost(enabled(f),f.post);
  await env.DB.prepare("UPDATE delivery_events SET status='sending',attempt_count=1,updated_at='2020-01-01' WHERE id=?").bind(emailId(f)).run();
  await retryFirstHostEmails(enabled(f));expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'uncertain'});
 });
});

async function connectHost(f:Awaited<ReturnType<typeof fixture>>,active=true,attendee=f.host) {
 const room=env.THE_ROOM.getByName(f.slug);
 await runInDurableObject(room,async(instance)=>{Object.assign((instance as unknown as {env:Cloudflare.Env}).env,{ROOM_HOST_FIRST_POST_ENABLED:active?'1':'0',ROOM_HOST_FIRST_POST_EVENT_SLUG:f.slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:f.account});});
 const response=await room.fetch(new Request('https://room.internal/socket',{headers:{upgrade:'websocket','x-bct-room-authorized':'1',
  'x-bct-session-id':attendee,'x-bct-attendee-id':attendee,'x-bct-display-name':'Untrusted display alias','x-bct-event-slug':f.slug,
  'x-bct-event-title':'Synthetic Night','x-bct-starts-at':f.now,'x-bct-ends-at':f.future,'x-bct-read-only-at':f.future,
  'x-bct-role':'organizer','x-bct-host-account-id':f.account,
 }}));
 const socket=response.webSocket!;const messages:Array<{type:string;message?:{id:string;role:string};error?:string}>=[];
 socket.addEventListener('message',event=>{messages.push(JSON.parse(String(event.data)));});socket.accept();
 await expect.poll(()=>messages.some(row=>row.type==='snapshot')).toBe(true);
 return {room,socket,messages};
}

describe('normal chat first-host trigger',()=>{
 it('claims exactly one receipt across concurrent posts and never re-arms after deletion or reconnect',async()=>{
  const f=await fixture(),a=await connectHost(f),b=await connectHost(f);
  try {
   a.socket.send(JSON.stringify({type:'typing',role:'organizer'}));a.socket.send(JSON.stringify({type:'message',content:' '}));
   expect(await counts(f)).toEqual({notices:{n:0},emails:{n:0},pushes:{n:0}});
   a.socket.send(JSON.stringify({type:'message',content:'First valid message'}));b.socket.send(JSON.stringify({type:'message',content:'Another tab'}));
   await expect.poll(async()=>(await counts(f)).emails).toEqual({n:1});
   const ledger=await runInDurableObject(a.room,async(_instance,state)=>state.storage.sql.exec<{message_id:string;completed_at:string}>('SELECT message_id,completed_at FROM room_host_posts').toArray());
   expect(ledger).toHaveLength(1);expect(ledger[0].completed_at).not.toBeNull();
   const normal=await runInDurableObject(a.room,async(_instance,state)=>state.storage.sql.exec<{role:string;display_name:string}>("SELECT role,display_name FROM messages WHERE kind='message'").toArray());
   expect(normal).toHaveLength(2);expect(normal.every(row=>row.role==='organizer' && row.display_name==='Host')).toBe(true);
   await a.room.removeMessage(ledger[0].message_id);
   const c=await connectHost(f);try{c.socket.send(JSON.stringify({type:'message',content:'A fresh post after deletion'}));await expect.poll(()=>c.messages.some(row=>row.type==='message')).toBe(true);}finally{c.socket.close(1000);}
   expect((await counts(f)).emails).toEqual({n:1});
   expect(await runInDurableObject(a.room,async(_instance,state)=>state.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM room_host_posts').one())).toEqual({n:1});
  } finally {a.socket.close(1000);b.socket.close(1000);}
 });
 it.each(['unassigned','unverified','disabled','feature-off','guest-spoof','wrong-account','wrong-event'])('does not grant Host from %s identity',async reason=>{
  const f=await fixture();
  if(reason==='unassigned')await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(f.account).run();
  if(reason==='unverified')await env.DB.prepare('UPDATE attendee_profiles SET email_verified_at=NULL WHERE id=?').bind(f.host).run();
  if(reason==='disabled')await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(f.account).run();
  const c=await connectHost(f,reason!=='feature-off',reason==='guest-spoof'?f.guest:f.host);
  if(reason==='wrong-account'||reason==='wrong-event')await runInDurableObject(c.room,async instance=>{
   Object.assign((instance as unknown as {env:Cloudflare.Env}).env,reason==='wrong-account'?{ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:'other-account'}:{ROOM_HOST_FIRST_POST_EVENT_SLUG:'other-event'});
  });
  try{
   c.socket.send(JSON.stringify({type:'message',content:'Hello',role:'organizer',hostAccountId:f.account}));
   await expect.poll(()=>c.messages.some(row=>row.type==='message')).toBe(true);
   expect(c.messages.find(row=>row.type==='message')?.message?.role).toBe('attendee');
   expect((await counts(f)).emails).toEqual({n:0});
  }finally{c.socket.close(1000);}
 });
 it('checks revoked attendee sessions at post time',async()=>{
  const f=await fixture(),c=await connectHost(f);
  try{
   await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE attendee_id=?').bind(f.now,f.host).run();
   c.socket.send(JSON.stringify({type:'message',content:'Must be denied'}));
   await expect.poll(()=>c.socket.readyState).not.toBe(WebSocket.OPEN);
   expect((await counts(f)).emails).toEqual({n:0});
  }finally{if(c.socket.readyState===WebSocket.OPEN)c.socket.close(1000);}
 });
 it('recovers a durable outbox after fanout failure without closing the Room early',async()=>{
  const f=await fixture(),c=await connectHost(f);
  await env.DB.exec(`CREATE TRIGGER fail_first_host_alarm BEFORE INSERT ON delivery_events WHEN NEW.kind='room_host_post' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
  try{
   c.socket.send(JSON.stringify({type:'message',content:'Only message'}));await expect.poll(()=>c.messages.some(row=>row.type==='message')).toBe(true);
   await expect.poll(async()=>await runInDurableObject(c.room,async(_instance,state)=>state.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM room_host_posts WHERE completed_at IS NULL').one())).toEqual({n:1});
  }finally{await env.DB.exec('DROP TRIGGER fail_first_host_alarm;');}
  try{
   await runInDurableObject(c.room,async(instance)=>instance.alarm());await expect.poll(async()=>(await counts(f)).emails).toEqual({n:1});
   expect(c.messages.some(row=>row.type==='room_closed')).toBe(false);
  }finally{c.socket.close(1000);}
 });
});


describe('first host cancellation races',()=>{
 it.each(['repeat removal','alarm'])('recovers failed cancellation through %s without rearming fanout',async recovery=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
  const room=env.THE_ROOM.getByName(f.slug);
  await runInDurableObject(room,async(instance,state)=>{
   Object.assign((instance as unknown as {env:Cloudflare.Env}).env,{ROOM_HOST_FIRST_POST_ENABLED:'1',ROOM_HOST_FIRST_POST_EVENT_SLUG:f.slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:f.account});
   instance.updatePolicy({eventSlug:f.slug,eventTitle:'Synthetic Night',startsAt:f.now,endsAt:f.future,readOnlyAt:f.future,readOnly:false});
   state.storage.sql.exec('INSERT INTO room_host_posts(host_account_id,message_id,sender_attendee_id,created_at,completed_at) VALUES(?,?,?,?,?)',f.account,f.post.messageId,f.host,f.now,f.now);
  });
  await env.DB.exec(`CREATE TRIGGER fail_first_host_cancel BEFORE INSERT ON room_host_first_posts WHEN NEW.cancelled_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic cancellation failure'); END;`);
  try {
   const failure=await runInDurableObject(room,async(instance)=>{
    try {await instance.removeMessage(f.post.messageId);return null;}
    catch(error){return error instanceof Error ? error.message : String(error);}
   });
   expect(failure).toContain('synthetic cancellation failure');
   expect(await room.hasMessage(f.post.messageId)).toBe(false);
   expect(await runInDurableObject(room,async(_instance,state)=>state.storage.sql.exec<{completed_at:string|null}>('SELECT completed_at FROM room_host_posts').one())).toEqual({completed_at:null});
   expect(await runInDurableObject(room,async(_instance,state)=>state.storage.getAlarm())).not.toBeNull();
   expect(await env.DB.prepare('SELECT cancelled_at FROM room_host_first_posts WHERE message_id=?').bind(f.post.messageId).first()).toEqual({cancelled_at:null});
  } finally { await env.DB.exec('DROP TRIGGER fail_first_host_cancel;'); }
  if(recovery==='repeat removal')expect(await room.removeMessage(f.post.messageId)).toBe(true);
  else await runInDurableObject(room,async(instance)=>instance.alarm());
  expect(await env.DB.prepare('SELECT cancelled_at FROM room_host_first_posts WHERE message_id=?').bind(f.post.messageId).first()).toMatchObject({cancelled_at:expect.any(String)});
  expect(await runInDurableObject(room,async(_instance,state)=>state.storage.sql.exec<{completed_at:string|null}>('SELECT completed_at FROM room_host_posts').one())).toMatchObject({completed_at:expect.any(String)});
  expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'suppressed'});
  const request=new Request('https://tickets.becoreops.com/api/customer/notifications',{headers:{cookie:`bct_attendee=${f.guest}`}});
  expect((await (await inbox(request)).json() as {notifications:unknown[]}).notifications).toHaveLength(0);
  await queueFirstHostPost(enabled(f),f.post);
  await queueFirstHostPost(enabled(f),{...f.post,messageId:crypto.randomUUID()});
  expect(await counts(f)).toEqual({notices:{n:1},emails:{n:1},pushes:{n:1}});
 });

 it('does not acknowledge in-flight fanout over a failed deletion cancellation',async()=>{
  const f=await fixture();await source(f);const room=env.THE_ROOM.getByName(f.slug);
  await env.DB.exec(`CREATE TRIGGER fail_first_host_interleaved_cancel BEFORE INSERT ON room_host_first_posts WHEN NEW.cancelled_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic interleaved cancellation failure'); END;`);
  try {
   const result=await runInDurableObject(room,async(instance,state)=>{
    const target=instance as unknown as {env:Cloudflare.Env};
    const original=target.env.DB;let intercepted=false;let cancellation:Promise<boolean>|null=null;
    Object.assign(target.env,{ROOM_HOST_FIRST_POST_ENABLED:'1',ROOM_HOST_FIRST_POST_EVENT_SLUG:f.slug,ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:f.account});
    instance.updatePolicy({eventSlug:f.slug,eventTitle:'Synthetic Night',startsAt:f.now,endsAt:f.future,readOnlyAt:f.future,readOnly:false});
    state.storage.sql.exec('INSERT INTO room_host_posts(host_account_id,message_id,sender_attendee_id,created_at) VALUES(?,?,?,?)',f.account,f.post.messageId,f.host,f.now);
    target.env.DB=new Proxy(original,{get(db,key){
     if(key==='batch')return async(statements:D1PreparedStatement[])=>{
      const results=await db.batch(statements);
      if(!intercepted){
       intercepted=true;
       // The VPS Room serializes handlers. Start the competing removal now,
       // but join it outside this batch so it cannot wait on its own alarm.
       cancellation=instance.removeMessage(f.post.messageId).then(()=>false,
        error=>String(error).includes('synthetic interleaved cancellation failure'));
      }
      return results;
     };
     const value=Reflect.get(db,key);return typeof value==='function'?value.bind(db):value;
    }});
    try {
     await instance.alarm();
     const cancellationFailed=await cancellation;
     return {intercepted,cancellationFailed,receipt:state.storage.sql.exec<{completed_at:string|null}>('SELECT completed_at FROM room_host_posts').one()};
    }finally{target.env.DB=original;}
   });
   expect(result).toEqual({intercepted:true,cancellationFailed:true,receipt:{completed_at:null}});
  }finally{await env.DB.exec('DROP TRIGGER fail_first_host_interleaved_cancel;');}
  await runInDurableObject(room,async(instance)=>instance.alarm());
  expect(await env.DB.prepare('SELECT cancelled_at FROM room_host_first_posts WHERE message_id=?').bind(f.post.messageId).first()).toMatchObject({cancelled_at:expect.any(String)});
  expect(await runInDurableObject(room,async(_instance,state)=>state.storage.sql.exec<{completed_at:string|null}>('SELECT completed_at FROM room_host_posts').one())).toMatchObject({completed_at:expect.any(String)});
 });
 it('a cancellation tombstone prevents late fanout after deletion',async()=>{
  const f=await fixture();await source(f);
  await runInDurableObject(env.THE_ROOM.getByName(f.slug),async(instance,state)=>{
   instance.updatePolicy({eventSlug:f.slug,eventTitle:'Synthetic Night',startsAt:f.now,endsAt:f.future,readOnlyAt:f.future,readOnly:false});
   state.storage.sql.exec('INSERT INTO room_host_posts(host_account_id,message_id,sender_attendee_id,created_at) VALUES(?,?,?,?)',f.account,f.post.messageId,f.host,f.now);
  });
  await env.THE_ROOM.getByName(f.slug).removeMessage(f.post.messageId);
  await queueFirstHostPost(enabled(f),f.post);
  expect(await counts(f)).toEqual({notices:{n:0},emails:{n:0},pushes:{n:0}});
  expect(await env.DB.prepare('SELECT cancelled_at FROM room_host_first_posts WHERE message_id=?').bind(f.post.messageId).first()).toMatchObject({cancelled_at:expect.any(String)});
 });
 it('does not deliver push jobs whose source was deleted before a late fanout',async()=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
  await runInDurableObject(env.THE_ROOM.getByName(f.slug),async(_instance,state)=>state.storage.sql.exec('UPDATE messages SET deleted_at=? WHERE id=?',f.now,f.post.messageId).toArray());
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
  await deliverHostAnnouncement(enabled(f),`${f.post.messageId}/${f.guest}`);expect(fetcher).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status FROM room_announcement_deliveries WHERE id=?').bind(`${f.post.messageId}/${f.guest}`).first()).toEqual({status:'complete'});
 });
});

it.each([true,false])('pins first-host email to VPS across configuration rollback and validates receipt (%s)',async valid=>{
 const f=await fixture();await source(f);
 const runtime=enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',TRANSACTIONAL_EMAIL_PROVIDER:'vps',VPS_EMAIL_SIGNING_KEY:'a'.repeat(64),RESEND_API_KEY:undefined});
 await queueFirstHostPost(runtime,f.post);
 const payload=await env.DB.prepare('SELECT payload_json FROM delivery_events WHERE id=?').bind(emailId(f)).first<{payload_json:string}>();
 expect(JSON.parse(payload!.payload_json).provider).toBe('vps');
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:valid?`vps-${'a'.repeat(64)}`:'resend-shaped-id'}));
 await deliverFirstHostEmail({...runtime,TRANSACTIONAL_EMAIL_PROVIDER:'resend'},emailId(f));await deliverFirstHostEmail(runtime,emailId(f));
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('https://mail.becoreops.com/v1/emails');
 const sent=JSON.parse(String(fetcher.mock.calls[0][1]?.body)),queued=JSON.parse(payload!.payload_json);
 expect(sent).toMatchObject({kind:'room_host_post',to:`${f.guest}@example.com`,html:queued.html,text:queued.text,subject:queued.subject});
 expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:valid?'sent':'uncertain'});
});
it('never switches a queued Resend first-host email to VPS',async()=>{
 const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'resend-receipt'}));
 await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',TRANSACTIONAL_EMAIL_PROVIDER:'vps',VPS_EMAIL_SIGNING_KEY:'a'.repeat(64),RESEND_API_KEY:'fixture'}),emailId(f));
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/emails');
});

it.each([undefined,'unknown-provider',null])('preserves legacy provider fallback and rejects invalid pinned providers (%s)',async provider=>{
 const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);
 const stored=await env.DB.prepare('SELECT payload_json FROM delivery_events WHERE id=?').bind(emailId(f)).first<{payload_json:string}>();
 const payload=JSON.parse(stored!.payload_json);if(provider===undefined)delete payload.provider;else payload.provider=provider;
 await env.DB.prepare('UPDATE delivery_events SET payload_json=? WHERE id=?').bind(JSON.stringify(payload),emailId(f)).run();
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({id:'resend-receipt'}));
 await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',TRANSACTIONAL_EMAIL_PROVIDER:'vps',VPS_EMAIL_SIGNING_KEY:'a'.repeat(64),RESEND_API_KEY:'fixture'}),emailId(f));
 if(provider===undefined){expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/emails');}
 else{expect(fetcher).not.toHaveBeenCalled();expect(await env.DB.prepare('SELECT status,attempt_count AS attempts FROM delivery_events WHERE id=?').bind(emailId(f)).first()).toEqual({status:'queued',attempts:0});}
});
