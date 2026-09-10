import {env} from 'cloudflare:test';
import {expect,it,vi} from 'vitest';
import {planPreviewCleanup,previewCleanupId,runPreviewCleanup} from '../lib/preview-cleanup';
it('fully removes preview relationships and test purchases while preserving live events, guests, accounts and a shared customer',async()=>{
 const now=new Date().toISOString();
 await env.DB.prepare("INSERT INTO booking_fee_rules(id,percentage_basis_points,scope,scope_id,effective_at,created_at,created_by) VALUES ('preview-fee',100,'event','after-dark-osu',?,?, 'test')").bind(now,now).run();
 await env.DB.prepare("INSERT INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,created_at) VALUES (?,'owner','preview.cleanup','maintenance','preview-cases','pending',?)").bind(previewCleanupId,now).run();
 for(const [id,email] of [['preview-only','preview-only@example.com'],['shared-person','shared@example.com']])await env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,created_at,updated_at) VALUES(?,?,?, ?,?)").bind(id,email,id,now,now).run();
 for(const [id,slug,mode,email] of [['preview-order','after-dark-osu','test','preview-only@example.com'],['shared-preview','noir-room-labone','test','shared@example.com'],['current-test','sun-chasers-labadi','sandbox','test-current@example.com'],['live-order','the-weekend-braai','live','shared@example.com']])await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,payment_environment,created_at) VALUES(?,?,?,1,100,0,100,'GHS',?,'','momo','paid',?,?)`).bind(id,`ref-${id}`,slug,email,mode,now).run();
 for(const [id,order,slug,person] of [['preview-ticket','preview-order','after-dark-osu','preview-only'],['shared-preview-ticket','shared-preview','noir-room-labone','shared-person'],['live-ticket','live-order','the-weekend-braai','shared-person']]){
  await env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)").bind(id,order,slug,id,now).run();
  await env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,?,'active',?)").bind(id,person,person,now).run();
  await env.DB.prepare('INSERT INTO ticket_gate_credentials(ticket_id,token,issued_at) VALUES(?,?,?)').bind(id,id,now).run();
 }
 await env.DB.batch([
  env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at) VALUES('live-rsvp','the-weekend-braai','real@example.com','Real Guest',1,'rsvp','requested',?,?)").bind(now,now),
  env.DB.prepare("INSERT INTO support_cases(id,attendee_id,event_slug,order_id,kind,subject,status,created_at,updated_at) VALUES('preview-case','preview-only','after-dark-osu','preview-order','general','Preview','closed',?,?)").bind(now,now),
  env.DB.prepare("INSERT INTO support_messages(id,case_id,author_type,author_id,body,created_at) VALUES('preview-message','preview-case','attendee','preview-only','Preview message',?)").bind(now),
  env.DB.prepare("INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES('preview-session','preview-only','preview-hash','2099-01-01',?,?)").bind(now,now),
  env.DB.prepare("INSERT INTO payment_events(id,event_type,reference,received_at,payload_hash) VALUES('preview-payment-event','charge.success','ref-preview-order',?,'hash')").bind(now),
  env.DB.prepare("INSERT INTO consent_records(id,subject_type,subject_id,policy,version,accepted_at) VALUES('preview-consent','order','preview-order','terms','1',?)").bind(now),
  env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,payload_json,created_at,updated_at) VALUES('preview-email','registration_update','someone@example.com','failed','{\"text\":\"after-dark-osu\"}',?,?)").bind(now,now),
 ]);
 await env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at) VALUES('88ad9bcd-2c2c-49f9-8115-ec982bd9a3c4','legacy-preview','sun-chasers-labadi',1,15000,1125,16125,'GHS','old-preview@example.com','','mobile_money:mtn','paid','2026-08-11T03:51:30.480Z')").run();
 // Exceed both production's 100-node expression limit and SQLite's default 1000-node limit.
 await env.DB.batch(Array.from({length:600},(_,i)=>env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at) VALUES(?,?,'after-dark-osu',1,100,0,100,'GHS','preview-load@example.com','','momo','paid',?)").bind(`preview-load-${i}`,`ref-preview-load-${i}`,now)));
 await env.DB.prepare("INSERT INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,detail,created_at) VALUES ('deep-preview-audit','owner','test','maintenance','unrelated-id','success','Verified ref-preview-load-599',?)").bind(now).run();
 await env.DB.prepare("INSERT INTO system_alerts(id,source,severity,message,detail,status,created_at) VALUES('cleanup-retry-alert','preview-cleanup','critical','Cleanup failed','Expression depth exceeded','open',?)").bind(now).run();
 const plan=await planPreviewCleanup(env.DB);expect(plan.counts.orders).toBe(604);expect(plan.targets.attendee_id).toContain('preview-only');expect(plan.targets.attendee_id).not.toContain('shared-person');
 const removeEventContent=vi.fn().mockResolvedValue(undefined);const removePreviewContentBefore=vi.fn().mockResolvedValue(undefined);const room={getByName:vi.fn(()=>({removeEventContent,removePreviewContentBefore}))} as unknown as Cloudflare.Env['THE_ROOM'];
 await runPreviewCleanup({DB:env.DB,THE_ROOM:room});
 for(const [table,id] of [['orders','preview-order'],['orders','current-test'],['tickets','preview-ticket'],['support_cases','preview-case'],['support_messages','preview-message'],['attendee_profiles','preview-only'],['attendee_sessions','preview-session'],['payment_events','preview-payment-event'],['delivery_events','preview-email'],['consent_records','preview-consent']])expect(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(id).first(),table).toBeNull();
 for(const table of ['ticket_assignments','ticket_gate_credentials'])expect(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE ticket_id='preview-ticket'`).first()).toBeNull();
 expect(await env.DB.prepare("SELECT id FROM booking_fee_rules WHERE id='preview-fee'").first()).toBeNull();
 expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM curated_event_records WHERE slug IN ('the-weekend-braai','sun-chasers-labadi')").first()).toEqual({count:2});
 expect(await env.DB.prepare("SELECT id FROM orders WHERE id='live-order'").first()).toBeTruthy();expect(await env.DB.prepare("SELECT id FROM attendee_profiles WHERE id='shared-person'").first()).toBeTruthy();expect(await env.DB.prepare("SELECT status FROM event_registrations WHERE id='live-rsvp'").first()).toEqual({status:'requested'});
 expect(await env.DB.prepare("SELECT id FROM operational_audit_events WHERE id='deep-preview-audit'").first()).toBeNull();
 expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug='after-dark-osu'").first()).toEqual({count:0});
 expect(removeEventContent).toHaveBeenCalledTimes(3);
 expect(await env.DB.prepare("SELECT status FROM system_alerts WHERE id='cleanup-retry-alert'").first()).toEqual({status:'resolved'});
 expect(removePreviewContentBefore).toHaveBeenCalledWith('2026-09-08T09:59:19.000Z');
 await runPreviewCleanup({DB:env.DB,THE_ROOM:room});expect(removeEventContent).toHaveBeenCalledTimes(3);
 const receipt=await env.DB.prepare('SELECT outcome,detail FROM operational_audit_events WHERE id=?').bind(previewCleanupId).first<{outcome:string;detail:string}>();expect(receipt?.outcome).toBe('success');expect(receipt?.detail).not.toContain('preview-only@example.com');
});
it('refuses to delete a retired listing that became a real event',async()=>{
 await env.DB.prepare("INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,image_url,curation_note,status,created_at,updated_at,is_test_event) VALUES('converted','converted','after-dark-osu','Real event','Venue','Accra','2099-01-01','2099-01-02','Night',0,'/real.jpg','Real event','published','2026-01-01','2026-01-01',0)").run();
 await expect(planPreviewCleanup(env.DB)).rejects.toThrow('converted to a live event');
});
