import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { queueOwnerApprovalAlerts } from '../lib/owner-approval-alerts';
import { retryFailedDeliveries } from '../lib/email-delivery';
import { submitHostApplication, confirmHostApplication } from '../lib/host-applications';
import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { GET } from '../app/api/admin/host-applications/route';

const configured = () => ({ ...env, OPS_ALERT_EMAIL: 'owner@example.com' });
async function host() {
  const email = `${crypto.randomUUID()}@example.com`;
  await submitHostApplication(env.DB, { brandName: '<New & Host>', contactName: 'Host Person', email, phone: '+233240000000', socialUrl: 'https://example.com', about: '' });
  const row = await env.DB.prepare(`SELECT a.id,d.payload_json AS payload FROM host_applications a JOIN delivery_events d ON d.recovery_grant_id=a.verification_hash WHERE a.email=?`).bind(email).first<{id:string;payload:string}>();
  return { id: row!.id, token: JSON.parse(row!.payload).text.match(/#token=([\w-]{43})/)[1] };
}
async function event(status = 'submitted') {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO party_submissions(id,organizer_name,contact_name,contact_email,contact_phone,title,concept,venue_name,area,starts_at,ends_at,vibe,lineup,capacity,price_from_minor,age_restriction,status,created_at,updated_at)
    VALUES (?,'Test Organizer','Test Contact','host@example.com','1234567','New Event','Concept','Venue','Osu',?,?,'Day party','DJ',100,10000,'18+',?,?,?)`).bind(id,now,now,status,now,now).run();
  return id;
}
async function delivery(kind:string,id:string) {
  return env.DB.prepare('SELECT recipient,status,payload_json AS payload FROM delivery_events WHERE id=?').bind(`owner-approval/${kind}/${id}`).first<{recipient:string;status:string;payload:string}>();
}
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM owner_approval_outbox').run();
  await env.DB.prepare("DELETE FROM delivery_events WHERE kind='owner_approval_request'").run();
});
afterEach(() => vi.restoreAllMocks());

describe('owner approval alerts', () => {
  it('only alerts after host email confirmation, escapes content and links the exact application', async () => {
    const h = await host();
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(0);
    await confirmHostApplication(env.DB,h.token);
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(1);
    const result = await delivery('host',h.id), payload = JSON.parse(result!.payload);
    expect(result!.recipient).toBe('owner@example.com');
    expect(payload.html).toContain('&lt;New &amp; Host&gt;');
    expect(payload.html).not.toContain('<New & Host>');
    expect(payload.text).toContain(`/admin/hosts?application=${h.id}`);
    expect(payload.text).not.toContain(h.token);
    await expect(confirmHostApplication(env.DB,h.token)).rejects.toThrow();
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(0);
  });
  it('queues new events and submitted drafts, never saved drafts', async () => {
    const live = await event(), draft = await event('draft');
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(1);
    expect(JSON.parse((await delivery('event',live))!.payload).text).toContain(`/admin?submission=${live}`);
    expect(await delivery('event',draft)).toBeNull();
    await env.DB.prepare("UPDATE party_submissions SET status='submitted' WHERE id=?").bind(draft).run();
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(1);
  });
  it('concurrent drain/replay creates one delivery per request', async () => {
    const id = await event();
    await Promise.all([queueOwnerApprovalAlerts(configured()),queueOwnerApprovalAlerts(configured())]);
    await env.DB.prepare("INSERT INTO owner_approval_outbox(kind,target_id) VALUES ('event',?)").bind(id).run();
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE kind='owner_approval_request'").first()).toEqual({n:1});
  });
  it('retains committed requests while recipient is missing and skips already-decided forms', async () => {
    const id = await event();
    expect((await queueOwnerApprovalAlerts({...env,OPS_ALERT_EMAIL:''})).queued).toBe(0);
    expect(await env.DB.prepare('SELECT target_id FROM owner_approval_outbox').first()).toEqual({target_id:id});
    await env.DB.prepare("UPDATE party_submissions SET status='rejected' WHERE id=?").bind(id).run();
    expect((await queueOwnerApprovalAlerts(configured())).queued).toBe(0);
    expect(await env.DB.prepare('SELECT 1 FROM owner_approval_outbox').first()).toBeNull();
  });
  it('rolls the alert back with a failed form transaction', async () => {
    const h = await host();
    await expect(env.DB.batch([
      env.DB.prepare("UPDATE host_applications SET status='pending',email_verified_at=? WHERE id=?").bind(new Date().toISOString(),h.id),
      env.DB.prepare("INSERT INTO owner_approval_outbox(kind,target_id) VALUES ('invalid','invalid')"),
    ])).rejects.toThrow();
    expect(await env.DB.prepare('SELECT 1 FROM owner_approval_outbox WHERE target_id=?').bind(h.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT status FROM host_applications WHERE id=?').bind(h.id).first()).toEqual({status:'awaiting_email'});
  });
  it('retries provider failure and records successful sending without touching form state', async () => {
    const id=await event(); await queueOwnerApprovalAlerts(configured());
    const send=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({message:'unavailable'},{status:503}));
    await retryFailedDeliveries(configured(),100,'standard');
    expect((await delivery('event',id))!.status).toBe('failed');
    await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2000-01-01' WHERE id=?").bind(`owner-approval/event/${id}`).run();
    send.mockResolvedValue(Response.json({id:'mail-accepted'}));
    await retryFailedDeliveries(configured(),100,'standard');
    expect((await delivery('event',id))!.status).toBe('sent');
    const ownerCalls=send.mock.calls.filter(([,init])=>String(init?.body).includes('owner@example.com'));
    expect(ownerCalls).toHaveLength(2);
    for(const [,init] of ownerCalls) expect(new Headers(init?.headers).get('idempotency-key')).toBe(`owner-approval/event/${id}`);
    expect(await env.DB.prepare('SELECT status FROM party_submissions WHERE id=?').bind(id).first()).toEqual({status:'submitted'});
  });
  it('keeps quota failures retryable without consuming attempts', async () => {
    const id=await event();await queueOwnerApprovalAlerts(configured());
    vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({name:'daily_quota_exceeded',message:'Daily quota'},{status:429}));
    await retryFailedDeliveries(configured(),100,'standard');
    const row=await env.DB.prepare('SELECT status,attempt_count,next_attempt_at FROM delivery_events WHERE id=?').bind(`owner-approval/event/${id}`).first<{status:string;attempt_count:number;next_attempt_at:string}>();
    expect(row).toMatchObject({status:'failed',attempt_count:0});expect(Date.parse(row!.next_attempt_at)).toBeGreaterThan(Date.now());
  });
  it('exact host review lookup requires owner permission and finds a decided application regardless of queue', async () => {
    const h=await host();await confirmHostApplication(env.DB,h.token);
    await env.DB.prepare("UPDATE host_applications SET status='rejected' WHERE id=?").bind(h.id).run();
    const url=`https://tickets.becoreops.com/api/admin/host-applications?id=${h.id}`;
    expect((await GET(new Request(url))).status).toBe(403);
    for(const role of ['organizer','owner']) {
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES (?,?,'Tester',?,'unused','unused',600000,0,'active',?,?,'test',?)`).bind(id,`${id}@example.com`,role,now,now,now).run();
      const cookie=adminCookieHeader(await createStaffSession(env.DB,{id}));
      const response=await GET(new Request(url,{headers:{cookie}}));
      expect(response.status).toBe(role==='owner'?200:403);
      if(role==='owner')expect((await response.json() as {items:unknown[]}).items).toMatchObject([{id:h.id,status:'rejected'}]);
    }
  });
});
