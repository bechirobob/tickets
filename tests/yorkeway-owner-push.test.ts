import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { generateRequestDetails } from 'web-push-neo';
import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { POST, DELETE } from '../app/api/organizer/notifications/subscription/route';
import { captureYorkewaySignup } from '../lib/yorkeway-early-access';
import { deliverYorkewayOwnerPush, retryYorkewayOwnerPush } from '../lib/yorkeway-owner-push';

vi.mock('web-push-neo', () => ({ generateRequestDetails: vi.fn(async (subscription: { endpoint: string }) => ({ endpoint: subscription.endpoint, method: 'POST', headers: {}, body: 'encrypted' })) }));
const origin = 'https://tickets.becoreops.com', endpoint = 'https://fcm.googleapis.com/fcm/send/yorkeway-owner-fixture';
const keys = { p256dh: btoa(String.fromCharCode(4) + 'a'.repeat(64)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''), auth: btoa('a'.repeat(16)).replace(/=+$/u, '') };
let accountId: string, cookie: string;
type Job = { id: string; signup_id: string; account_id: string; attempts: number; outcome: string | null };
const originalQueue = env.EMAIL_DELIVERY_QUEUE;
function request(method: string, auth = cookie, device = endpoint) {
  return new Request(origin + '/api/organizer/notifications/subscription', { method, headers: { cookie: auth, origin, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: device, keys }) });
}
async function staff(role = 'owner') {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,?,?,'test','test',1,0,'active',?,?,'test',?)`).bind(id, id + '@example.com', role, role, now, now, now).run();
  return { id, cookie: adminCookieHeader(await createStaffSession(env.DB, { id })).split(';')[0] };
}
async function jobs() {
  return (await env.DB.prepare('SELECT id,signup_id,account_id,attempts,outcome FROM yorkeway_owner_push_deliveries ORDER BY id').all<Job>()).results;
}
async function signup(address = crypto.randomUUID() + '@example.com') {
  await captureYorkewaySignup(env.DB, { email: address, name: 'Private Signup Guest' });
  return address;
}
async function captured() { await signup(); return (await jobs())[0]; }
async function changeEligibility(change: string) {
  if (['organizer', 'support', 'finance', 'gate', 'moderator', 'curator'].includes(change)) await env.DB.prepare('UPDATE staff_accounts SET role=? WHERE id=?').bind(change, accountId).run();
  if (change === 'disabled') await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(accountId).run();
  if (change === 'password') await env.DB.prepare('UPDATE staff_accounts SET must_change_password=1 WHERE id=?').bind(accountId).run();
  if (change === 'logout') await env.DB.prepare("UPDATE staff_sessions SET revoked_at='2020-01-01' WHERE account_id=?").bind(accountId).run();
  if (change === 'expired') await env.DB.prepare("UPDATE staff_sessions SET expires_at='2020-01-01' WHERE account_id=?").bind(accountId).run();
  if (change === 'optout') await DELETE(request('DELETE'));
  if (change === 'consent') await env.DB.prepare("UPDATE organizer_push_subscriptions SET consent_id='renewed' WHERE account_id=?").bind(accountId).run();
}
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM yorkeway_owner_push_deliveries').run();
  await env.DB.prepare('DELETE FROM organizer_push_subscriptions').run();
  const owner = await staff(); accountId = owner.id; cookie = owner.cookie;
  env.VAPID_PUBLIC_KEY = 'test'; env.VAPID_PRIVATE_KEY = 'test'; env.VAPID_SUBJECT = 'mailto:test@example.com';
  delete env.EMAIL_DELIVERY_QUEUE;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
  expect((await POST(request('POST'))).status).toBe(200);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  delete env.VAPID_PUBLIC_KEY; delete env.VAPID_PRIVATE_KEY; delete env.VAPID_SUBJECT;
  if (originalQueue) env.EMAIL_DELIVERY_QUEUE = originalQueue; else delete env.EMAIL_DELIVERY_QUEUE;
});
it('captures only opted-in owners, not organizers or other staff, once per device', async () => {
  const host = await staff('organizer');
  expect((await POST(request('POST', host.cookie, endpoint + '-host'))).status).toBe(200);
  const second = await staff();
  expect((await POST(request('POST', second.cookie, endpoint + '-owner'))).status).toBe(200);
  await signup();
  expect((await jobs()).map(row => row.account_id).sort()).toEqual([accountId, second.id].sort());
});
it('duplicate and simultaneous submissions preserve one signup, welcome and owner alert', async () => {
  const address = crypto.randomUUID() + '@example.com';
  await Promise.all(Array.from({ length: 5 }, () => signup(address)));
  expect(await jobs()).toHaveLength(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM yorkeway_early_access WHERE email=?').bind(address).first()).toEqual({ n: 1 });
  expect((await env.DB.prepare('SELECT kind,recipient FROM delivery_events WHERE recipient IN (?,?)').bind(address, accountId + '@example.com').all()).results).toEqual([{ kind: 'yorkeway_welcome', recipient: address }]);
  expect(fetch).not.toHaveBeenCalled();
});
it('never backfills older signups when a device is enabled or a duplicate is submitted', async () => {
  await DELETE(request('DELETE')); const address = await signup();
  expect(await jobs()).toHaveLength(0);
  await POST(request('POST')); await signup(address); await retryYorkewayOwnerPush(env);
  expect(await jobs()).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  await signup(); expect(await jobs()).toHaveLength(1);
});
it('rolls signup and welcome back when durable owner capture fails', async () => {
  const address = crypto.randomUUID() + '@example.com';
  await env.DB.exec("CREATE TRIGGER yorkeway_push_test_failure BEFORE INSERT ON yorkeway_owner_push_deliveries BEGIN SELECT RAISE(ABORT,'Synthetic owner outbox failure'); END;");
  try {
    await expect(signup(address)).rejects.toThrow();
    expect(await env.DB.prepare('SELECT id FROM yorkeway_early_access WHERE email=?').bind(address).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(address).first()).toBeNull();
    expect(await jobs()).toHaveLength(0);
  } finally { await env.DB.exec('DROP TRIGGER yorkeway_push_test_failure;'); }
  await signup(address); expect(await jobs()).toHaveLength(1);
});
it.each(['organizer', 'support', 'finance', 'gate', 'moderator', 'curator', 'disabled', 'password', 'logout', 'expired', 'optout'])('does not capture for an ineligible %s owner device', async change => {
  await changeEligibility(change); await signup(); expect(await jobs()).toHaveLength(0);
});
it('sends once under concurrent claims, with no subscriber details and only the authenticated audience link', async () => {
  const job = await captured();
  await Promise.all([deliverYorkewayOwnerPush(env, job.id), deliverYorkewayOwnerPush(env, job.id)]);
  await deliverYorkewayOwnerPush(env, job.id);
  expect(fetch).toHaveBeenCalledTimes(1); expect((await jobs())[0].outcome).toBe('accepted');
  const payload = JSON.parse(vi.mocked(generateRequestDetails).mock.calls[0][1] as string);
  expect(payload).toMatchObject({ kind: 'yorkeway_owner_signup', title: 'New Yorke Way signup', url: '/admin/yorkeway-audience' });
  expect(JSON.stringify(payload)).not.toMatch(/Private Signup Guest|@example|withdrawal|consent_text/u);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(accountId + '@example.com').first()).toBeNull();
});
it.each(['organizer', 'support', 'finance', 'gate', 'moderator', 'curator', 'disabled', 'password', 'logout', 'expired', 'optout', 'consent'])('revalidates queued owner alert after %s changes', async change => {
  const job = await captured(); await changeEligibility(change);
  await deliverYorkewayOwnerPush(env, job.id);
  expect(fetch).not.toHaveBeenCalled(); expect((await jobs())[0].outcome).toBe('ineligible');
});
it.each(['organizer', 'logout', 'expired', 'password', 'optout', 'consent'])('revalidates %s while encryption yields', async change => {
  const job = await captured();
  vi.mocked(generateRequestDetails).mockImplementationOnce(async () => {
    await changeEligibility(change);
    return { endpoint, method: 'POST', headers: {}, body: new Uint8Array([1]) };
  });
  await deliverYorkewayOwnerPush(env, job.id);
  expect(generateRequestDetails).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  expect((await jobs())[0].outcome).toBe('ineligible');
});
it('suppresses a queued alert if the subscriber withdraws', async () => {
  const job = await captured();
  await env.DB.prepare("UPDATE yorkeway_early_access SET status='withdrawn',withdrawn_at=? WHERE id=?").bind(new Date().toISOString(), job.signup_id).run();
  await deliverYorkewayOwnerPush(env, job.id);
  expect(fetch).not.toHaveBeenCalled(); expect((await jobs())[0].outcome).toBe('ineligible');
});
it('revokes an expired endpoint and stops retrying it', async () => {
  const job = await captured(); vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 410 }));
  await deliverYorkewayOwnerPush(env, job.id); await retryYorkewayOwnerPush(env);
  expect(fetch).toHaveBeenCalledTimes(1); expect((await jobs())[0].outcome).toBe('expired');
  expect(await env.DB.prepare('SELECT id FROM organizer_push_subscriptions WHERE revoked_at IS NULL').first()).toBeNull();
});
it('bounds retries and recovers a transient provider failure using the original durable job', async () => {
  const job = await captured(); vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
  await deliverYorkewayOwnerPush(env, job.id);
  expect((await jobs())[0]).toMatchObject({ id: job.id, attempts: 1, outcome: null });
  await env.DB.prepare('UPDATE yorkeway_owner_push_deliveries SET lease_until=NULL WHERE id=?').bind(job.id).run();
  await retryYorkewayOwnerPush(env); await retryYorkewayOwnerPush(env);
  expect(fetch).toHaveBeenCalledTimes(2); expect((await jobs())[0]).toMatchObject({ id: job.id, attempts: 2, outcome: 'accepted' });
});
it('stops permanent provider failures after three attempts without an email fallback', async () => {
  const job = await captured(); vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  for (let n = 0; n < 4; n++) {
    await env.DB.prepare('UPDATE yorkeway_owner_push_deliveries SET lease_until=NULL WHERE id=?').bind(job.id).run();
    await retryYorkewayOwnerPush(env);
  }
  expect(fetch).toHaveBeenCalledTimes(3); expect((await jobs())[0]).toMatchObject({ attempts: 3, outcome: 'failed' });
  expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(accountId + '@example.com').first()).toBeNull();
});
it('queue failure preserves durable work and scheduler queues only the existing alert', async () => {
  const job = await captured(), send = vi.fn().mockRejectedValueOnce(new Error('Synthetic queue outage')).mockResolvedValue(undefined);
  env.EMAIL_DELIVERY_QUEUE = { send } as unknown as NonNullable<Cloudflare.Env['EMAIL_DELIVERY_QUEUE']>;
  await expect(retryYorkewayOwnerPush(env)).rejects.toThrow('Synthetic queue outage');
  expect((await jobs())[0]).toMatchObject({ id: job.id, attempts: 0, outcome: null });
  await retryYorkewayOwnerPush(env);
  expect(send).toHaveBeenLastCalledWith({ deliveryId: 'yorkeway-owner:' + job.id });
  expect(fetch).not.toHaveBeenCalled(); expect(await jobs()).toHaveLength(1);
});
it('expires old work without contacting the provider or replaying historical signups', async () => {
  const job = await captured();
  await env.DB.prepare("UPDATE yorkeway_owner_push_deliveries SET created_at='2000-01-01' WHERE id=?").bind(job.id).run();
  await retryYorkewayOwnerPush(env);
  expect(fetch).not.toHaveBeenCalled(); expect((await jobs())[0].outcome).toBe('expired');
});

it('immediate enqueue failure does not lose the signup, welcome or owner alert', async () => {
  const sendBatch = vi.fn().mockRejectedValue(new Error('Synthetic enqueue outage')), send = vi.fn().mockResolvedValue(undefined);
  env.EMAIL_DELIVERY_QUEUE = { sendBatch, send } as unknown as NonNullable<Cloudflare.Env['EMAIL_DELIVERY_QUEUE']>;
  const address = await signup(), job = (await jobs())[0];
  expect(sendBatch).toHaveBeenCalledTimes(1); expect(job.outcome).toBeNull();
  expect(await env.DB.prepare('SELECT status FROM yorkeway_early_access WHERE email=?').bind(address).first()).toEqual({ status: 'subscribed' });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE recipient=? AND kind='yorkeway_welcome'").bind(address).first()).toEqual({ n: 1 });
  await retryYorkewayOwnerPush(env);
  expect(send).toHaveBeenCalledWith({ deliveryId: 'yorkeway-owner:' + job.id });
  expect(fetch).not.toHaveBeenCalled();
});
it('does not capture a new alert for suppressed or previously withdrawn addresses', async () => {
  const suppressed = crypto.randomUUID() + '@example.com', stamp = new Date().toISOString();
  await env.DB.prepare('INSERT INTO marketing_contacts(email,provider_id,unsubscribed,updated_at) VALUES(?,?,1,?)').bind(suppressed, crypto.randomUUID(), stamp).run();
  await signup(suppressed); expect(await jobs()).toHaveLength(0);
  const withdrawn = await signup(), job = (await jobs())[0];
  await env.DB.prepare("UPDATE yorkeway_early_access SET status='withdrawn',withdrawn_at=? WHERE id=?").bind(stamp, job.signup_id).run();
  await signup(withdrawn); expect(await jobs()).toHaveLength(1);
});
it('never attempts an untrusted endpoint or substitutes owner email when push keys are missing', async () => {
  const job = await captured();
  await env.DB.prepare("UPDATE organizer_push_subscriptions SET endpoint='https://evil.example/push' WHERE account_id=?").bind(accountId).run();
  await deliverYorkewayOwnerPush(env, job.id);
  expect(fetch).not.toHaveBeenCalled(); expect((await jobs())[0].outcome).toBe('invalid_endpoint');
  await env.DB.prepare('UPDATE organizer_push_subscriptions SET endpoint=? WHERE account_id=?').bind(endpoint, accountId).run();
  await signup(); const next = (await jobs()).find(row => row.id !== job.id)!;
  delete env.VAPID_PRIVATE_KEY;
  await deliverYorkewayOwnerPush(env, next.id);
  expect(fetch).not.toHaveBeenCalled();
  expect(await env.DB.prepare('SELECT id FROM delivery_events WHERE recipient=?').bind(accountId + '@example.com').first()).toBeNull();
});
