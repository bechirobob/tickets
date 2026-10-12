import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sendEmail, retryFailedDeliveries } from '../lib/email-delivery';
import { notifyRegistrationHosts } from '../lib/event-audience';

// The same fallback code must work before push exists and after its migration.
// Retain these regressions when the subsequent push checkout includes 0063.
const startsMigrated=existsSync(new URL('../drizzle/0063_host_rsvp_push.sql',import.meta.url));
for (const migrated of [false, true]) describe(migrated ? 'fallback after push migration' : 'fallback on startup schema', () => {
 let slug:string, host:string, rsvp:string;
 beforeAll(async()=>{
  if(migrated && !startsMigrated){const sql=readFileSync(new URL('./fixtures/host-rsvp-push.sql',import.meta.url),'utf8');expect(createHash('sha256').update(sql).digest('hex')).toBe('916a7f508d43fbd97061df03db9f1745f5ffabf95de764772c9725e78be539ea');await env.DB.exec(sql);}
  expect(Boolean(await env.DB.prepare("SELECT name FROM sqlite_schema WHERE name='organizer_push_subscriptions'").first())).toBe(migrated || startsMigrated);
 });
 async function registration(kind='rsvp'){
  const id=crypto.randomUUID(),now=new Date().toISOString();await env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at) VALUES(?,?,?,'Guest',1,?,'requested',?,?)").bind(id,slug,`${id}@example.invalid`,kind,now,now).run();return id;
 }
 const input=(id:string,kind:'organizer_signup'|'registration_update'|'registration_access'|'payment_confirmation'|'ticket_recovery'|'support_update'='organizer_signup')=>({db:env.DB,kind,recipient:`${host}@example.invalid`,subject:'Fixture',html:'<p>Fixture</p>',text:'Fixture',idempotencyKey:kind==='organizer_signup'?`organizer-signup/${slug}/${id}/${host}`:`${kind}/${id}`});
 async function queued(id:string,status='queued',providerId:string|null=null,kind:'organizer_signup'|'registration_update'='organizer_signup'){
  const deliveryId=crypto.randomUUID();await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,provider_id,attempt_count,next_attempt_at,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,0,'2000-01-01',?,'2000-01-01','2000-01-01')").bind(deliveryId,kind,`${host}@example.invalid`,status,providerId,JSON.stringify({...input(id,kind),db:undefined,provider:'resend'})).run();return deliveryId;
 }
 beforeEach(async()=>{
  await env.DB.prepare('DELETE FROM delivery_events').run();const now=new Date().toISOString();slug=`fallback-${crypto.randomUUID()}`;host=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,'Host','organizer','test','test',1,0,'active',?,?,'fixture',?)").bind(host,`${host}@example.invalid`,now,now,now).run();
  await env.DB.prepare("INSERT INTO staff_sessions(id,account_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,'2099-01-01',?,?)").bind(host,host,host,now,now).run();
  await env.DB.prepare("INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES(?,?,?,'Fixture','Venue','Area','2099-01-01','2099-01-02','Night',0,10,'on_sale','','Fixture','published',?,?,?)").bind(slug,slug,slug,now,now,now).run();
  await env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(host,slug,host,now).run();rsvp=await registration();
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({id:crypto.randomUUID()}));
 });
 afterEach(()=>vi.restoreAllMocks());
 it('blocks new RSVP email through direct and baseline host-notifier paths without a push dependency',async()=>{
  expect(await sendEmail(input(rsvp))).toEqual({sent:false,reason:'host_rsvp_push_only'});await notifyRegistrationHosts(env.DB,{eventSlug:slug,sourceId:rsvp,guestName:'Guest',status:'requested',guests:1});expect(fetch).not.toHaveBeenCalled();expect(await env.DB.prepare("SELECT id FROM delivery_events WHERE kind='organizer_signup'").first()).toBeNull();
 });
 it.each(['queued','failed'])('suppresses old %s host RSVP retry before contacting provider',async status=>{
  const id=await queued(rsvp,status);await retryFailedDeliveries(env,20,'all');expect(await env.DB.prepare('SELECT status,provider_id,next_attempt_at FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'suppressed',provider_id:null,next_attempt_at:null});expect(fetch).not.toHaveBeenCalled();
 });
 it('does not claim to recall provider-accepted mail',async()=>{
  const id=await queued(rsvp,'sent','accepted-before-suppression');await retryFailedDeliveries(env,20,'all');expect(await env.DB.prepare('SELECT status,provider_id FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'sent',provider_id:'accepted-before-suppression'});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['registration_update','registration_access','payment_confirmation','ticket_recovery','support_update'] as const)('preserves unrelated %s sends',async kind=>{expect(await sendEmail(input(rsvp,kind))).toMatchObject({sent:true});expect(fetch).toHaveBeenCalledTimes(1);});
 it.each(['interest','paid'])('preserves new and retried host %s signup email',async kind=>{
  const id=await registration(kind);await notifyRegistrationHosts(env.DB,{eventSlug:slug,sourceId:id,guestName:'Guest',status:kind==='paid'?'paid':'interested',guests:1});expect(fetch).toHaveBeenCalledTimes(1);vi.mocked(fetch).mockClear();const delivery=await queued(id,'failed');await retryFailedDeliveries(env,20,'all');expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(delivery).first()).toEqual({status:'sent'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('preserves guest retry alongside suppressed host retry',async()=>{
  const hostId=await queued(rsvp),guestId=await queued(rsvp,'failed',null,'registration_update');await retryFailedDeliveries(env,20,'all');expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(hostId).first()).toEqual({status:'suppressed'});expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(guestId).first()).toEqual({status:'sent'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 if(migrated)it('leaves devices and captured pending work intact while handling new RSVPs',async()=>{
  const now=new Date().toISOString();await env.DB.prepare("INSERT INTO organizer_push_subscriptions(id,account_id,session_id,consent_id,endpoint,p256dh,auth,created_at,updated_at) VALUES(?,?,?,?,?,'fixture','fixture',?,?)").bind(host,host,host,host,`https://fcm.googleapis.com/fcm/send/${host}`,now,now).run();const id=await registration();const before=await env.DB.prepare('SELECT * FROM organizer_rsvp_push_deliveries WHERE registration_id=?').bind(id).all();expect(before.results).toHaveLength(1);
  await notifyRegistrationHosts(env.DB,{eventSlug:slug,sourceId:id,guestName:'Guest',status:'requested',guests:1});await queued(id);await retryFailedDeliveries(env,20,'all');expect((await env.DB.prepare('SELECT * FROM organizer_rsvp_push_deliveries WHERE registration_id=?').bind(id).all()).results).toEqual(before.results);expect(await env.DB.prepare('SELECT revoked_at FROM organizer_push_subscriptions WHERE id=?').bind(host).first()).toEqual({revoked_at:null});expect(fetch).not.toHaveBeenCalled();
 });
});
