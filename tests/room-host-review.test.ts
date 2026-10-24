import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../lib/attendee-auth';
import { deliverFirstHostEmail, queueFirstHostPost, type FirstHostPost } from '../lib/room-host-first-post';
import { readRoomUpdateSummaries } from '../lib/room-updates';
import { GET as inbox } from '../app/api/customer/notifications/route';

async function fixture() {
 const id=crypto.randomUUID(),slug=`first-host-${id}`,now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
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

afterEach(() => vi.restoreAllMocks());
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function suppress(f: Fixture, reason: string) {
 const email=`${f.guest}@example.com`;
 if(reason==='global')await env.DB.prepare('INSERT INTO marketing_contacts(email,unsubscribed,updated_at) VALUES(?,1,?)').bind(email,f.now).run();
 if(reason==='event')await env.DB.prepare("INSERT INTO event_audience_contacts(id,event_slug,email,guest_name,source,consented_at,unsubscribed_at,unsubscribe_token,confirmed_at) VALUES(?,?,?,'Synthetic','fixture',?,?,?,?)").bind(f.id,f.slug,email,f.now,f.now,f.id,f.now).run();
 if(reason==='bounced'||reason==='complained')await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,created_at,updated_at) VALUES(?,'fixture',?,?,?,?)").bind(f.id,email,reason,f.now,f.now).run();
 if(reason==='muted'||reason==='host-off')await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,muted_until,updated_at) VALUES(?,?,1,?,?,?)').bind(f.guest,f.slug,reason==='host-off'?0:1,reason==='muted'?f.future:null,f.now).run();
}
describe('first-host independent recipient and visibility regressions',()=>{
 it.each(['global','event','bounced','complained'])('excludes %s suppression from initial email fanout',async reason=>{
  const f=await fixture();await suppress(f,reason);await queueFirstHostPost(enabled(f),f.post);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE kind='room_host_post' AND recipient=?").bind(`${f.guest}@example.com`).first()).toEqual({n:0});
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM attendee_notifications WHERE kind='host_first_post' AND attendee_id=?").bind(f.guest).first()).toEqual({n:1});
 });
 it.each(['global','event','bounced','complained','muted','host-off'])('rechecks %s after queueing and never calls the provider',async reason=>{
  const f=await fixture();await source(f);await queueFirstHostPost(enabled(f),f.post);await suppress(f,reason);
  const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Provider must not be called'));
  const id=`room-first-email/${f.post.messageId}/${f.guest}`;
  await deliverFirstHostEmail(enabled(f,{EMAIL_FROM:'BeCore Tickets <tickets@becoreops.com>',RESEND_API_KEY:'synthetic-key'}),id);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'suppressed'});
 });
 it.each(['cancelled','blocked','muted','host-off'])('Room count and inbox both hide %s first-post notices',async reason=>{
  const f=await fixture();await queueFirstHostPost(enabled(f),f.post);
  const cookie=`bct_attendee=${f.guest}`;
  const count=async()=> (await readRoomUpdateSummaries(env.DB,cookie)).reduce((n,row)=>n+row.unread,0);
  expect(await count()).toBe(1);
  if(reason==='cancelled')await env.DB.prepare('UPDATE room_host_first_posts SET cancelled_at=? WHERE message_id=?').bind(f.now,f.post.messageId).run();
  else if(reason==='blocked')await env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES(?,?,?,?,?)').bind(f.id,f.slug,f.guest,f.host,f.now).run();
  else await suppress(f,reason);
  expect(await count()).toBe(0);
  expect((await (await inbox(new Request('https://tickets.becoreops.com/api/customer/notifications',{headers:{cookie}}))).json() as {notifications:unknown[]}).notifications).toHaveLength(0);
 });
});
