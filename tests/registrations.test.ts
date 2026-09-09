import { env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { requestRegistration, claimRegistration, readRegistration, cancelRegistration, processRegistrations, registrationSettings } from '../lib/registrations';
import { readAttendeeRoomAccess } from '../lib/attendee-auth';
import { adminCookieHeader, createStaffSession } from '../lib/admin-session';
import { POST as passes } from '../app/api/customer/tickets/route';
import { POST as checkIn } from '../app/api/admin/check-in/route';
import { POST as customerAction } from '../app/api/customer/registrations/route';
import { POST as hostAction, GET as hostList } from '../app/api/admin/registrations/route';
import { POST as recovery } from '../app/api/customer/recovery/route';
import { POST as signup } from '../app/api/registrations/route';
const origin = 'https://tickets.becoreops.com';
const slug = 'after-dark-osu';
function req(path: string, body: unknown, cookie = '') { return new Request(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
async function access(email: string, partySize = 1) {
  await requestRegistration(env.DB, { eventSlug: slug, email, guestName: 'RSVP Guest', phone: '', partySize }, origin);
  const delivery = await env.DB.prepare("SELECT payload_json AS payload FROM delivery_events WHERE kind = 'registration_access' AND recipient = ? ORDER BY created_at DESC LIMIT 1").bind(email).first<{ payload: string }>();
  const token = (JSON.parse(delivery!.payload).text as string).match(/#token=([^\s]+)/)![1];
  const reg = await env.DB.prepare('SELECT id FROM event_registrations WHERE event_slug = ? AND normalized_email = ?').bind(slug, email).first<{ id: string }>();
  return { token, id: reg!.id };
}
async function owner() {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at) VALUES (?, ?, 'RSVP Owner', 'owner', 'test', 'test', 1, 0, 'active', 0, ?, ?, 'test', ?)`)
    .bind(id, `${id}@example.com`, now, now, now).run();
  return adminCookieHeader(await createStaffSession(env.DB, { id })).split(';')[0];
}
async function configure(input: Record<string, unknown>, cookie?: string) {
  return hostAction(req('/api/admin/registrations', { eventSlug: slug, action: 'settings', mode: 'rsvp', capacity: 2, maxPartySize: 2, approvalRequired: false, roomAccess: false, ...input }, cookie ?? await owner()));
}
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ticket_gate_credentials WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id LIKE 'rsvp_%')"),
    env.DB.prepare("DELETE FROM ticket_assignments WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id LIKE 'rsvp_%')"),
    env.DB.prepare("DELETE FROM tickets WHERE order_id LIKE 'rsvp_%'"),
    env.DB.prepare("DELETE FROM orders WHERE payment_provider = 'rsvp'"),
    env.DB.prepare('DELETE FROM registration_access_grants'),
    env.DB.prepare('DELETE FROM event_registrations'),
  ]);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'registration-email' }));
  await env.DB.prepare("UPDATE curated_event_records SET status = 'published', schedule_status = 'confirmed', event_state = 'on_sale', starts_at = ?, ends_at = ? WHERE slug = ?")
    .bind(new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() + 90000000).toISOString(), slug).run();
  await env.DB.prepare("INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, updated_at) VALUES (?, 'rsvp', 2, 2, ?) ON CONFLICT(event_slug) DO UPDATE SET mode = 'rsvp', capacity = 2, max_party_size = 2, approval_required = 0, room_access = 0")
    .bind(slug, new Date().toISOString()).run();
});
afterEach(() => vi.restoreAllMocks());
describe('RSVP admission and interest registrations', () => {
  it('verifies inbox ownership before reserving a group and issues real, zero-cost QR passes', async () => {
    const pending = await access('rsvp-group@example.com', 2);
    expect((await readRegistration(env.DB, pending.id))?.status).toBe('unverified');
    expect(await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(`rsvp_${pending.id}`).first()).toBeNull();
    const claim = await claimRegistration(env.DB, pending.token);
    expect(claim.registration).toMatchObject({ status: 'confirmed', partySize: 2 });
    await expect(claimRegistration(env.DB, pending.token)).rejects.toThrow('expired or was already used');
    const wallet = await (await passes(req('/api/customer/tickets', {}, claim.cookie))).json() as { orders: Array<{ roomAccess: boolean; totalAmountMinor: number; tickets: Array<{ qrPayload: string }> }> };
    expect(wallet.orders[0]).toMatchObject({ roomAccess: false, totalAmountMinor: 0 });
    expect(wallet.orders[0].tickets).toHaveLength(2);
    expect(wallet.orders[0].tickets[0].qrPayload).toBeTruthy();
    expect(await readAttendeeRoomAccess(env.DB, claim.cookie, slug)).toBeNull();
    expect(await readAttendeeRoomAccess(env.DB, claim.cookie, slug, false)).not.toBeNull();
    expect((await configure({ roomAccess: true })).status).toBe(200);
    expect(await readAttendeeRoomAccess(env.DB, claim.cookie, slug)).not.toBeNull();
    const gateCookie = await owner();
    const scan = () => checkIn(req('/api/admin/check-in', { code: wallet.orders[0].tickets[0].qrPayload, eventSlug: slug, gate: 'Main' }, gateCookie));
    expect((await scan()).status).toBe(200);
    expect((await scan()).status).toBe(409);
    await expect(cancelRegistration(env.DB, pending.id)).rejects.toThrow('after check-in');
  });
  it('prevents overbooking under simultaneous claims and promotes the next party after cancellation', async () => {
    const first = await access('rsvp-first@example.com', 2), second = await access('rsvp-second@example.com', 2);
    const claims = await Promise.all([claimRegistration(env.DB, first.token), claimRegistration(env.DB, second.token)]);
    const registrations = await Promise.all([readRegistration(env.DB, first.id), readRegistration(env.DB, second.id)]);
    expect(registrations.map(r => r!.status).sort()).toEqual(['confirmed', 'waitlisted']);
    const confirmed = registrations.find(r => r!.status === 'confirmed')!, waiting = registrations.find(r => r!.status === 'waitlisted')!;
    expect((await configure({ capacity: 1 })).status).toBe(409);
    expect((await configure({ mode: 'paid' })).status).toBe(409);
    await cancelRegistration(env.DB, confirmed.id);
    expect((await readRegistration(env.DB, waiting.id))?.status).toBe('confirmed');
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets WHERE order_id = ? AND status = 'voided'").bind(confirmed.orderId).first()).toEqual({ count: 2 });
    const wrongCookie = claims[registrations.findIndex(r => r!.id === confirmed.id)].cookie;
    expect((await customerAction(req('/api/customer/registrations', { id: waiting.id, action: 'cancel' }, wrongCookie))).status).toBe(404);
  });
  it('requires assigned host approval and excludes anonymous roster access', async () => {
    expect((await configure({ approvalRequired: true })).status).toBe(200);
    const pending = await access('rsvp-approval@example.com');
    const claim = await claimRegistration(env.DB, pending.token);
    expect(claim.registration?.status).toBe('requested');
    expect((await hostList(new Request(`${origin}/api/admin/registrations?eventSlug=${slug}`))).status).toBe(403);
    const response = await hostAction(req('/api/admin/registrations', { eventSlug: slug, action: 'approve', id: pending.id }, await owner()));
    expect(response.status).toBe(200);
    expect((await readRegistration(env.DB, pending.id))?.status).toBe('confirmed');
  });
  it('keeps interest separate from admission and sends one announcement when dates change', async () => {
    expect((await configure({ mode: 'interest', capacity: 0 })).status).toBe(200);
    const pending = await access('rsvp-interest@example.com');
    const claim = await claimRegistration(env.DB, pending.token);
    expect(claim.registration).toMatchObject({ status: 'interested', orderId: null });
    expect(await readAttendeeRoomAccess(env.DB, claim.cookie, slug)).toBeNull();
    await processRegistrations(env, origin);
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE recipient = ? AND kind = 'registration_update'").bind('rsvp-interest@example.com').first<{ count: number }>();
    await env.DB.prepare('UPDATE curated_event_records SET starts_at = ? WHERE slug = ?').bind(new Date(Date.now() + 172800000).toISOString(), slug).run();
    await processRegistrations(env, origin); await processRegistrations(env, origin);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM delivery_events WHERE recipient = ? AND kind = 'registration_update'").bind('rsvp-interest@example.com').first()).toEqual({ count: before!.count + 1 });
    expect((await readRegistration(env.DB, pending.id))?.orderId).toBeNull();
    expect((await recovery(req('/api/customer/recovery', { email: 'rsvp-interest@example.com' }))).status).toBe(202);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM registration_access_grants WHERE registration_id = ?').bind(pending.id).first()).toEqual({ count: 2 });
    expect((await configure({})).status).toBe(200);
    const join = await customerAction(req('/api/customer/registrations', { action: 'join', id: pending.id, partySize: 2 }, claim.cookie));
    expect(join.status).toBe(200); expect((await readRegistration(env.DB, pending.id))?.status).toBe('confirmed');
  });
  it('does not let duplicate signup overwrite the confirmed guest or consume a second place', async () => {
    const pending = await access('rsvp-duplicate@example.com');
    await claimRegistration(env.DB, pending.token);
    await requestRegistration(env.DB, { eventSlug: slug, email: 'rsvp-duplicate@example.com', guestName: 'Changed Name', phone: '', partySize: 2 }, origin);
    expect(await readRegistration(env.DB, pending.id)).toMatchObject({ guestName: 'RSVP Guest', partySize: 1, status: 'confirmed' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM tickets WHERE order_id = ?').bind(`rsvp_${pending.id}`).first()).toEqual({ count: 1 });
  });
  it('accepts a grant only once under concurrent replay and rejects malformed or cross-origin signup', async () => {
    const pending = await access('rsvp-replay@example.com');
    const results = await Promise.allSettled([claimRegistration(env.DB, pending.token), claimRegistration(env.DB, pending.token)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await signup(req('/api/registrations', { acceptedTerms: true, email: 42 }))).status).toBe(400);
    expect((await signup(new Request(`${origin}/api/registrations`, { method: 'POST', headers: { origin: 'https://other.example' }, body: '{}' }))).status).toBe(403);
  });
  it('uses interest for an undated event without changing its paid ticket tiers', async () => {
    await env.DB.prepare('DELETE FROM event_registration_settings WHERE event_slug = ?').bind(slug).run();
    await env.DB.prepare("UPDATE curated_event_records SET schedule_status = 'coming_soon' WHERE slug = ?").bind(slug).run();
    expect((await registrationSettings(env.DB, slug))?.mode).toBe('interest');
    const pending = await access('rsvp-undated@example.com');
    expect((await claimRegistration(env.DB, pending.token)).registration?.status).toBe('interested');
  });
});
