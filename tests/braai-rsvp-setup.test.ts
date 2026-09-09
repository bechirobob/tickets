import {env} from 'cloudflare:test';
import {beforeEach,expect,it} from 'vitest';
import {braaiRsvpStatements,requestId} from '../scripts/configure-braai-rsvp.mjs';
const slug='the-weekend-braai';
const run=(now='2026-09-10T00:00:00.000Z')=>env.DB.batch(braaiRsvpStatements(now).map(item=>env.DB.prepare(item.sql).bind(...item.params)));
beforeEach(async()=>{
 await env.DB.batch([
  env.DB.prepare('DELETE FROM operational_audit_events WHERE id=?').bind(requestId),
  env.DB.prepare('DELETE FROM event_registration_settings WHERE event_slug=?').bind(slug),
  env.DB.prepare("UPDATE curated_event_records SET starts_at='2026-09-20T14:00:00.000Z',schedule_status='end_pending',status='published',event_state='on_sale',removed_at=NULL WHERE slug=?").bind(slug),
 ]);
});
it('applies the exact requested settings once and preserves subsequent organiser edits',async()=>{
 await run();
 expect(await env.DB.prepare('SELECT mode,capacity,approval_required,accepting,closes_at FROM event_registration_settings WHERE event_slug=?').bind(slug).first()).toEqual({mode:'rsvp',capacity:100,approval_required:1,accepting:1,closes_at:'2026-09-20T00:00:00.000Z'});
 expect(await env.DB.prepare('SELECT outcome FROM operational_audit_events WHERE id=?').bind(requestId).first()).toEqual({outcome:'success'});
 await env.DB.prepare('UPDATE event_registration_settings SET capacity=120 WHERE event_slug=?').bind(slug).run();
 await run('2026-09-11T00:00:00.000Z');
 expect(await env.DB.prepare('SELECT capacity FROM event_registration_settings WHERE event_slug=?').bind(slug).first()).toEqual({capacity:120});
});
it('does not replace paid bookings with free admission',async()=>{
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,unit_quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at)
 VALUES('braai-setup-paid','braai-setup-paid',?,'general',1,1,35000,0,35000,'GHS','fixture@example.com','','mobile_money','paystack','paid','2026-09-10T00:00:00.000Z')`).bind(slug).run();
 await run();
 expect(await env.DB.prepare('SELECT mode FROM event_registration_settings WHERE event_slug=?').bind(slug).first()).toBeNull();
 expect(await env.DB.prepare('SELECT id FROM operational_audit_events WHERE id=?').bind(requestId).first()).toBeNull();
});
it('refuses an altered event date or an expired setup deadline',async()=>{
 await run('2026-09-20T00:00:00.000Z');
 expect(await env.DB.prepare('SELECT mode FROM event_registration_settings WHERE event_slug=?').bind(slug).first()).toBeNull();
 await env.DB.prepare("UPDATE curated_event_records SET starts_at='2026-09-21T14:00:00.000Z' WHERE slug=?").bind(slug).run();
 await run();
 expect(await env.DB.prepare('SELECT mode FROM event_registration_settings WHERE event_slug=?').bind(slug).first()).toBeNull();
});
