import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {POST} from '../app/api/organizer/workspace/route';
import {GET as campaigns} from '../app/api/admin/campaigns/route';
import {adminCookieHeader,createStaffSession} from '../lib/admin-session';
const origin='https://tickets.becoreops.com';
async function staff(role='organizer'){
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Host',?,'test','test',600000,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,role,now,now,now).run();
 return {id,cookie:adminCookieHeader(await createStaffSession(env.DB,{id}))};
}
async function fixture(){
 const host=await staff(),id=crypto.randomUUID(),slug=`host-notice-${id}`,now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,image_url,curation_note,status,created_at,updated_at) SELECT ?,?,?,'Host notice',venue,area,?,?,vibe,price_from_minor,capacity,image_url,curation_note,'published',?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,future,now,now),
  env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)').bind(host.id,slug,host.id,now),
  env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES (?,?,'Guest','active',?,?)").bind(id,`${id}@example.com`,now,now),
  env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES (?,?,?,1,10000,0,10000,'GHS',?,'233000000000','card','paid',?,?)`).bind(id,id,slug,`${id}@example.com`,now,now),
  env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',?,'issued',?)").bind(id,id,slug,id,now),
  env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'fixture','active',?)").bind(id,id,now),
 ]);
 return {...host,slug,guest:id};
}
function request(cookie:string,eventSlug:string,input:Record<string,unknown>={},requestOrigin=origin){return new Request(`${origin}/api/organizer/workspace`,{method:'POST',headers:{cookie,origin:requestOrigin,'content-type':'application/json'},body:JSON.stringify({action:'announcement',eventSlug,content:'Use the garden entrance tonight.',pinned:false,...input})});}
describe('phone announcement channel',()=>{
 it('deduplicates concurrent submissions, uncertain retries, inbox and update history',async()=>{
  const f=await fixture(),submissionKey=crypto.randomUUID();
  const [a,b]=await Promise.all([POST(request(f.cookie,f.slug,{submissionKey})),POST(request(f.cookie,f.slug,{submissionKey}))]);
  expect(a.status).toBe(200);expect(b.status).toBe(200);
  const first=await a.json() as {messageId:string};expect(await b.json()).toEqual(first);
  expect(await (await POST(request(f.cookie,f.slug,{submissionKey}))).json()).toEqual(first);
  for(const table of ['event_updates','room_moderation_actions','attendee_notifications','room_announcement_deliveries']){
   expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_slug=?`).bind(f.slug).first()).toEqual({n:1});
  }
  expect((await env.THE_ROOM.getByName(f.slug).getMessage(first.messageId))?.content).toBe('Use the garden entrance tonight.');
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM marketing_campaigns WHERE event_slug=?').bind(f.slug).first()).toEqual({n:0});
 });
 it('recovers fanout failure after Room persistence without posting twice',async()=>{
  const f=await fixture(),submissionKey=crypto.randomUUID();
  await env.DB.exec(`CREATE TRIGGER fail_host_notice_test BEFORE INSERT ON attendee_notifications WHEN NEW.event_slug='${f.slug}' BEGIN SELECT RAISE(ABORT,'Simulated fanout interruption'); END;`);
  try {
   expect((await POST(request(f.cookie,f.slug,{submissionKey}))).status).toBe(400);
  } finally { await env.DB.exec('DROP TRIGGER fail_host_notice_test;'); }
  const room=env.THE_ROOM.getByName(f.slug);
  const original=await runInDurableObject(room,async(_instance,state)=>state.storage.sql.exec<{id:string}>('SELECT id FROM messages').toArray());
  expect(original).toHaveLength(1);
  const retried=await (await POST(request(f.cookie,f.slug,{submissionKey}))).json() as {messageId:string};
  expect(retried.messageId).toBe(original[0].id);
  expect(await runInDurableObject(room,async(_instance,state)=>state.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM messages').one())).toEqual({n:1});
  for(const table of ['event_updates','room_moderation_actions','attendee_notifications','room_announcement_deliveries'])expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE event_slug=?`).bind(f.slug).first()).toEqual({n:1});
 });
 it('does not recreate expired push work on a stale retry',async()=>{
  const f=await fixture(),submissionKey=crypto.randomUUID();
  const first=await (await POST(request(f.cookie,f.slug,{submissionKey}))).json() as {messageId:string};
  await runInDurableObject(env.THE_ROOM.getByName(f.slug),async(_instance,state)=>{
   state.storage.sql.exec("UPDATE messages SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?",first.messageId);
  });
  await env.DB.prepare('DELETE FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).run();
  expect(await (await POST(request(f.cookie,f.slug,{submissionKey}))).json()).toEqual(first);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_notifications WHERE event_slug=?').bind(f.slug).first()).toEqual({n:1});
 });
 it('rejects changed payloads and malformed keys without replacing the original',async()=>{
  const f=await fixture(),submissionKey=crypto.randomUUID();
  const first=await (await POST(request(f.cookie,f.slug,{submissionKey}))).json() as {messageId:string};
  for(const change of [{content:'Different update'},{pinned:true}])expect((await POST(request(f.cookie,f.slug,{submissionKey,...change}))).status).toBe(400);
  for(const key of ['',7,'x'.repeat(500),first.messageId])expect((await POST(request(f.cookie,f.slug,{submissionKey:key}))).status).toBe(400);
  expect((await env.THE_ROOM.getByName(f.slug).getMessage(first.messageId))?.content).toBe('Use the garden entrance tonight.');
 });
 it('keeps request keys author/event-scoped and preserves authorization and unkeyed callers',async()=>{
  const a=await fixture(),b=await fixture(),other=await staff(),curator=await staff('curator'),submissionKey=crypto.randomUUID();
  expect((await POST(request('',a.slug,{submissionKey}))).status).toBe(403);
  expect((await POST(request(other.cookie,a.slug,{submissionKey}))).status).toBe(403);
  expect((await POST(request(a.cookie,b.slug,{submissionKey}))).status).toBe(403);
  expect((await POST(request(a.cookie,a.slug,{submissionKey},'https://other.example'))).status).toBe(403);
  await env.DB.batch([env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)').bind(other.id,a.slug,a.id,new Date().toISOString()),env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,?,?)').bind(curator.id,a.slug,a.id,new Date().toISOString())]);
  const x=await (await POST(request(a.cookie,a.slug,{submissionKey}))).json() as {messageId:string};
  const y=await (await POST(request(other.cookie,a.slug,{submissionKey,content:'Another host update.'}))).json() as {messageId:string};
  const z=await (await POST(request(b.cookie,b.slug,{submissionKey}))).json() as {messageId:string};
  expect(new Set([x.messageId,y.messageId,z.messageId]).size).toBe(3);
  expect((await POST(request(curator.cookie,a.slug,{submissionKey}))).status).toBe(403);
  const summary=await campaigns(new Request(`${origin}/api/admin/campaigns?eventSlug=${a.slug}`,{headers:{cookie:curator.cookie}}));
  expect(await summary.json()).toMatchObject({canPostPhoneUpdates:false});
  expect((await POST(request(a.cookie,a.slug))).status).toBe(200);
 });
});
