import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processOrganizerReports, reportDeliveryAllowed, hostReportEmail } from '../lib/organizer-reports';
import { readHostSummary } from '../lib/host-summary';
import { preferredHostEvent } from '../lib/host-guide';
import { retryFailedDeliveries } from '../lib/email-delivery';
import { adminCookieHeader,createStaffSession } from '../lib/admin-session';
import { GET,PATCH } from '../app/api/organizer/reports/route';
const clock=new Date('2026-10-05T08:05:00.000Z');
async function fixture(end='2026-10-10T22:00:00.000Z') {
 const id=crypto.randomUUID(),slug=`host-${id}`,email=`${id}@example.com`;
 await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
 VALUES (?,?,'Host <test>','organizer','test','test',1,0,'active','2026-01-01','2026-01-01','test','2026-01-01')`).bind(id,email).run();
 await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,age_restriction,lineup,image_url,curation_note,status,created_at,updated_at,schedule_status,event_state)
 VALUES (?,?,?,'A proper Night','Test Venue','Accra','2026-10-10T18:00:00.000Z',?,'Night',10000,25,'18+','Test DJ','/events/the-weekend-braai.jpeg','A carefully selected night','published','2026-01-01','2026-01-01','confirmed','on_sale')`).bind(slug,slug,slug,end).run();
 await env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES (?,?,'test','2026-01-01')").bind(id,slug).run();
 return {id,slug,email};
}
async function reports(id:string){return (await env.DB.prepare('SELECT * FROM organizer_reports WHERE account_id=?').bind(id).all<{id:string;kind:string;period_key:string}>()).results;}
beforeEach(async()=>{await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE role='organizer'").run();await env.DB.prepare("UPDATE organizer_report_rollout SET started_at='2026-09-19T00:00:00.000Z'").run();vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({id:crypto.randomUUID()}));});
afterEach(()=>vi.restoreAllMocks());
describe('host guidance and scheduled reports',()=>{
 it('selects the nearest current event, honors a scoped link and falls back to recent history',()=>{
  const events=[{slug:'later',startsAt:'2026-11-01',endsAt:'2026-11-02',status:'published',eventState:'on_sale'},{slug:'past',startsAt:'2026-09-01',endsAt:'2026-09-02',status:'published',eventState:'on_sale'},{slug:'next',startsAt:'2026-10-06',endsAt:'2026-10-07',status:'published',eventState:'on_sale'}];
  expect(preferredHostEvent(events,null,clock.getTime())).toBe('next');expect(preferredHostEvent(events,'later',clock.getTime())).toBe('later');expect(preferredHostEvent(events,'unassigned',clock.getTime())).toBe('next');expect(preferredHostEvent(events,null,Date.parse('2027-01-01'))).toBe('later');
 });
 it('queues one weekly report and one outbox under concurrent cron runs, then waits until next week',async()=>{
  const f=await fixture();await Promise.all([processOrganizerReports(env.DB,clock),processOrganizerReports(env.DB,clock)]);
  expect(await reports(f.id)).toHaveLength(1);await processOrganizerReports(env.DB,new Date('2026-10-06T09:00:00Z'));expect(await reports(f.id)).toHaveLength(1);
  const delivery=await env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE kind='organizer_report' AND recipient=?").bind(f.email).first();expect(delivery).toEqual({count:1});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('waits until 8am, skips old event recaps and creates one next-morning recap',async()=>{
  const fresh=await fixture('2026-10-05T02:00:00.000Z'),old=await fixture('2026-09-01T22:00:00.000Z');
  await processOrganizerReports(env.DB,new Date('2026-10-05T07:59:00Z'));expect(await reports(fresh.id)).toHaveLength(0);
  await processOrganizerReports(env.DB,clock);expect((await reports(fresh.id)).map(r=>r.kind)).toEqual(['recap']);expect(await reports(old.id)).toHaveLength(0);
  await processOrganizerReports(env.DB,new Date('2026-10-06T08:00:00Z'));expect(await reports(fresh.id)).toHaveLength(1);
 });
 it('sends a valid report once through the provider retry path',async()=>{
  const f=await fixture();await processOrganizerReports(env.DB,clock);const [r]=await reports(f.id);
  await env.DB.prepare("UPDATE organizer_reports SET expires_at=? WHERE id=?").bind(new Date(Date.now()+3600000).toISOString(),r.id).run();
  await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2000-01-01' WHERE recovery_grant_id=?").bind(r.id).run();
  await retryFailedDeliveries(env,100);await retryFailedDeliveries(env,100);
  const calls=vi.mocked(fetch).mock.calls.filter(([,init])=>String(init?.body).includes(f.email));expect(calls).toHaveLength(1);
  expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE recovery_grant_id=?').bind(r.id).first()).toEqual({status:'sent'});
 });
 it('does not backfill a weekly roundup from before rollout',async()=>{
  const f=await fixture();await env.DB.prepare("UPDATE organizer_report_rollout SET started_at='2026-10-06T00:00:00.000Z'").run();
  await processOrganizerReports(env.DB,new Date('2026-10-06T09:00:00Z'));expect(await reports(f.id)).toHaveLength(0);
 });
 it.each(['disabled','role','email','assignment','preference','expired','removed'])('suppresses a queued report after %s changes',async change=>{
  const f=await fixture();await processOrganizerReports(env.DB,clock);const [r]=await reports(f.id);
  expect(await reportDeliveryAllowed(env.DB,r.id,f.email,clock.toISOString())).toBe(true);
  const statements:Record<string,string>={disabled:"UPDATE staff_accounts SET status='disabled' WHERE id=?",role:"UPDATE staff_accounts SET role='gate' WHERE id=?",email:"UPDATE staff_accounts SET normalized_email='changed-'||id||'@example.com' WHERE id=?",assignment:'DELETE FROM staff_event_assignments WHERE account_id=?',preference:"INSERT INTO organizer_report_preferences(account_id,enabled,updated_at) VALUES (?,0,'2026-10-05')",expired:"UPDATE organizer_reports SET expires_at='2000-01-01' WHERE account_id=?",removed:"UPDATE curated_event_records SET removed_at='2026-10-05' WHERE slug=?"};
  await env.DB.prepare(statements[change]).bind(change==='removed'?f.slug:f.id).run();expect(await reportDeliveryAllowed(env.DB,r.id,f.email,clock.toISOString())).toBe(false);
  await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2000-01-01' WHERE recovery_grant_id=?").bind(r.id).run();
  await retryFailedDeliveries(env,100);expect(await env.DB.prepare('SELECT status,payload_json FROM delivery_events WHERE recovery_grant_id=?').bind(r.id).first()).toEqual({status:'suppressed',payload_json:null});
 });
 it('protects event summaries and persists an authenticated preference without exposing contact rows',async()=>{
  const f=await fixture(),other=await fixture();const cookie=adminCookieHeader(await createStaffSession(env.DB,{id:f.id}));
  const request=(slug:string)=>new Request(`https://tickets.becoreops.com/api/organizer/reports?eventSlug=${slug}`,{headers:{cookie}});
  expect((await GET(request(other.slug))).status).toBe(403);const response=await GET(request(f.slug));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(await response.json())).not.toContain('@example.com');
  const patch=(origin:string)=>PATCH(new Request('https://tickets.becoreops.com/api/organizer/reports',{method:'PATCH',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({enabled:false})}));
  expect((await patch('https://evil.example')).status).toBe(403);expect((await patch('https://tickets.becoreops.com')).status).toBe(200);
  await processOrganizerReports(env.DB,clock);expect(await reports(f.id)).toHaveLength(0);
 });
 it('keeps pending RSVP requests and interest separate from attendance; escapes names in the report',async()=>{
  const f=await fixture();
  for(const [status,kind,party] of [['confirmed','rsvp',3],['requested','rsvp',2],['interested','interest',1]] as const)await env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at,acquisition_source) VALUES (?,?,?,'Private guest',?,?,?,'2026-10-01','2026-10-01','instagram')`).bind(crypto.randomUUID(),f.slug,`${status}@example.com`,party,kind,status).run();
  await env.DB.prepare("INSERT INTO guest_entries(id,event_slug,guest_name,admission_count,kind,status,created_by,created_at) VALUES (?,?,'Manual guest',2,'guest','checked_in','test','2026-10-01')").bind(crypto.randomUUID(),f.slug).run();
  const summary=await readHostSummary(env.DB,f.slug);expect(summary).toMatchObject({pending:1,expected:5,interest:1,checkedIn:2,manualGuests:2});
  const email=hostReportEmail('<img src=x>','weekly',[summary!],clock.toISOString());expect(email.html).toContain('&lt;img');expect(email.html).toContain('/brand/becore-ticket.png');expect(email.text).toContain('3 confirmed RSVP guests');expect(email.text).not.toContain('@example.com');expect(email.text).toContain(`event=${f.slug}&range=all`);
 });
});
