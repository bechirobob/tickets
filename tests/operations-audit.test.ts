import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createStaffSession, readAdminSession, type StaffRole } from '../lib/admin-session';
import { GET as events, PATCH as editEvent } from '../app/api/admin/events/route';
import { GET as operations, POST as operate } from '../app/api/admin/operations/route';
import { GET as accounts } from '../app/api/admin/accounts/route';
import { GET as orders, POST as orderAction } from '../app/api/admin/orders/route';
import { GET as support } from '../app/api/admin/support/route';
import { GET as rooms } from '../app/api/admin/rooms/route';
import { GET as promoters } from '../app/api/admin/promoters/route';
import { POST as gate, GET as manifest } from '../app/api/admin/check-in/route';
import { createApprovalRequest, decideApproval, requestMassRefund } from '../lib/operational-finance';
import { createGateToken, hashGateToken } from '../lib/gate-pass';
const origin = 'https://tickets.becoreops.com';
const now = () => new Date().toISOString();
async function staff(role: StaffRole = 'owner') {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO staff_accounts (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations, must_change_password, status, password_changed_at, created_at, created_by, updated_at) VALUES (?, ?, 'Audit person', ?, 'test', 'test', 600000, 0, 'active', ?, ?, 'test', ?)`).bind(id, `${id}@example.com`, role, now(), now(), now()).run();
  return `bct_staff=${await createStaffSession(env.DB, { id })}`;
}
function req(path: string, cookie: string, body?: object, method = 'POST') {
  return new Request(`${origin}/api/admin/${path}`, { method: body ? method : 'GET', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function seed() {
  const slug = `audit-${crypto.randomUUID()}`;
  const start = new Date(Date.now() + 7 * 86400000).toISOString();
  const end = new Date(Date.now() + 8 * 86400000).toISOString();
  await env.DB.prepare(`INSERT INTO curated_event_records (id, submission_id, slug, title, venue, venue_map_url, area, starts_at, ends_at, vibe, price_from_minor, capacity, age_restriction, lineup, event_state, image_url, curation_note, status, published_at, created_at, updated_at) VALUES (?, ?, ?, 'Audit Night', 'Audit Venue', 'https://maps.google.com/?q=Accra', 'Accra', ?, ?, 'Late night', 10000, 20, '18+', 'Audit DJ', 'on_sale', 'https://example.com/art.jpg', 'A complete event used to exercise owner operations.', 'published', ?, ?, ?)`).bind(slug, slug, slug, start, end, now(), now(), now()).run();
  await env.DB.prepare(`INSERT INTO event_ticket_tiers (id, event_slug, code, name, description, price_minor, admissions_per_unit, capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at) VALUES (?, ?, 'general', 'General', 'One admission', 10000, 1, 20, 10, 'available', 0, ?, ?)`).bind(`${slug}-tier`, slug, now(), now()).run();
  await env.DB.prepare("UPDATE curated_event_records SET tagline = ? WHERE slug = ?").bind(`An original line ${slug}`, slug).run();
  return slug;
}
async function eventDraft(cookie: string, slug: string) {
  const data = await (await events(req('events', cookie))).json() as { events: Array<Record<string, unknown>> };
  return data.events.find(event => event.slug === slug)!;
}
async function booking(slug: string, provider = 'paystack', status = 'issued') {
  const id = crypto.randomUUID();
  const code = createGateToken();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, payment_provider, status, created_at, paid_at) VALUES (?, ?, ?, 'general', 1, ?, 0, ?, 'GHS', ?, '233000000000', 'mobile_money:mtn', ?, 'paid', ?, ?)`).bind(id, code, slug, provider === 'rsvp' ? 0 : 10000, provider === 'rsvp' ? 0 : 10000, `${id}@example.com`, provider, now(), now()),
    env.DB.prepare(`INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', ?, ?, ?)`).bind(id, id, slug, await hashGateToken(code), status, now()),
    env.DB.prepare(`INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at) VALUES (?, ?, 'Audit guest', ?, 'active', ?, ?)`).bind(id, `${id}@example.com`, now(), now(), now()),
  ]);
  return { id, code };
}

describe('Operations Center audit regressions', () => {
  it('enforces each workspace API against every staff role', async () => {
    const routes: Array<[string, (r: Request) => Promise<Response>, StaffRole[]]> = [
      ['events', events, ['owner','curator']], ['operations', operations, ['owner','curator','finance']],
      ['accounts', accounts, ['owner']], ['orders', orders, ['owner','finance']],
      ['support', support, ['owner','support']], ['rooms', rooms, ['owner','moderator']], ['promoters', promoters, ['owner','curator']],
    ];
    for (const role of ['owner','curator','finance','support','organizer','gate','moderator'] as StaffRole[]) {
      const cookie = await staff(role);
      for (const [path, handler, allowed] of routes) {
        const response = await handler(req(path, cookie));
        expect(response.status, `${role}: ${path}`).toBe(allowed.includes(role) ? 200 : path === 'rooms' ? 401 : 403);
      }
    }
  });
  it('requires approval for cancellation and never revives voided tickets during edits', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug, 'paystack', 'voided');
    const draft = await eventDraft(cookie, slug);
    expect((await editEvent(req('events', cookie, { ...draft, eventState: 'cancelled' }, 'PATCH'))).status).toBe(400);
    expect((await editEvent(req('events', cookie, { ...draft, title: 'Edited Audit Night' }, 'PATCH'))).status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM tickets WHERE id = ?').bind(ticket.id).first()).toEqual({ status: 'voided' });
  });
  it('preserves valid tickets during postponement, blocks gate entry and restores admission after rescheduling', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug);
    const draft = await eventDraft(cookie, slug);
    expect((await editEvent(req('events', cookie, { ...draft, eventState: 'postponed' }, 'PATCH'))).status).toBe(200);
    const paused = await manifest(req(`check-in?eventSlug=${slug}&manifest=1`, cookie));
    expect(await paused.json()).toMatchObject({ manifest: [] });
    expect((await gate(req('check-in', cookie, { code: ticket.code, eventSlug: slug }))).status).toBe(409);
    expect((await editEvent(req('events', cookie, { ...draft, eventState: 'rescheduled' }, 'PATCH'))).status).toBe(200);
    expect((await gate(req('check-in', cookie, { code: ticket.code, eventSlug: slug }))).status).toBe(200);
  });
  it('binds offline replay to the event and ticket being scanned', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug); const otherSlug = await seed();
    const clientScanId = crypto.randomUUID();
    expect((await gate(req('check-in', cookie, { code: ticket.code, eventSlug: slug, clientScanId }))).status).toBe(200);
    expect((await gate(req('check-in', cookie, { code: ticket.code, eventSlug: otherSlug, clientScanId }))).status).toBe(409);
  });
  it('keeps announced date status editable and rejects tier ownership and duplicate tier IDs', async () => {
    const cookie = await staff(); const slug = await seed();
    await env.DB.prepare("UPDATE curated_event_records SET schedule_status = 'coming_soon' WHERE slug = ?").bind(slug).run();
    const draft = await eventDraft(cookie, slug); const tiers = draft.tiers as object[];
    expect((await editEvent(req('events', cookie, { ...draft, scheduleStatus: 'confirmed' }, 'PATCH'))).status).toBe(200);
    expect(await env.DB.prepare('SELECT schedule_status AS status FROM curated_event_records WHERE slug = ?').bind(slug).first()).toEqual({ status: 'confirmed' });
    expect((await editEvent(req('events', cookie, { ...draft, scheduleStatus: 'confirmed', tiers: [tiers[0], { ...tiers[0], code: 'second' }] }, 'PATCH'))).status).toBe(400);
    expect((await editEvent(req('events', cookie, { ...draft, scheduleStatus: 'confirmed', tiers: [{ ...tiers[0], id: 'unrelated-tier' }] }, 'PATCH'))).status).toBe(400);
  });
  it('shows return requests and excludes stale devices and free RSVPs from paid order counts', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug); await booking(slug, 'rsvp');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ticket_return_requests (id, ticket_id, attendee_id, order_id, event_slug, face_value_minor, currency, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, 10000, 'GHS', ?, ?)`).bind(ticket.id, ticket.id, ticket.id, ticket.id, slug, now(), now()),
      env.DB.prepare(`INSERT INTO gate_devices (id, event_slug, gate, account_id, account_email, pending_offline_scans, last_seen_at) VALUES (?, ?, 'Main gate', 'test', 'test@example.com', 5, ?)`).bind(slug, slug, new Date(Date.now() - 3600000).toISOString()),
    ]);
    const data = await (await operations(req('operations', cookie))).json() as { returns: Array<{ ticketId: string }>; metrics: Array<Record<string, unknown>> };
    expect(data.returns).toContainEqual(expect.objectContaining({ ticketId: ticket.id }));
    expect(data.metrics.find(item => item.slug === slug)).toMatchObject({ activeDevices: 0, pendingOffline: 0, paidOrders: 1 });
  });
  it('rejects self approval and only executes one concurrent decision', async () => {
    const requester = (await readAdminSession(await staff()))!; const approver = (await readAdminSession(await staff()))!; const slug = await seed();
    const approval = await createApprovalRequest(env.DB, requester, { kind: 'event_cancellation', eventSlug: slug, payload: { reason: 'Venue no longer available' } });
    await expect(decideApproval(env, requester, { approvalId: approval.id, decision: 'approve' })).rejects.toThrow('requested');
    const results = await Promise.allSettled([decideApproval(env, approver, { approvalId: approval.id, decision: 'approve' }), decideApproval(env, approver, { approvalId: approval.id, decision: 'reject' })]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const result = await env.DB.prepare('SELECT status FROM approval_requests WHERE id = ?').bind(approval.id).first<{ status: string }>();
    expect(['completed','rejected']).toContain(result?.status);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_audit_events WHERE target_id = ? AND action IN ('approval.completed', 'approval.rejected')").bind(approval.id).first()).toEqual({ count: 1 });
  });
  it('does not interpret a missing approval decision as approve', async () => {
    const cookie = await staff();
    expect((await operate(req('operations', cookie, { action: 'approval', approvalId: 'missing' }))).status).toBe(400);
    expect((await operate(new Request(`${origin}/api/admin/operations`, { method: 'POST', headers: { cookie, origin }, body: 'broken' }))).status).toBe(400);
  });
  it('permits a paid refund batch when the event also contains free RSVP orders', async () => {
    const actor = (await readAdminSession(await staff()))!; const slug = await seed(); await booking(slug); await booking(slug, 'rsvp');
    await expect(requestMassRefund(env.DB, actor, slug, 'Cancelled by the organiser')).resolves.toMatchObject({ totalOrders: 1 });
  });
  it('rejects payment verification for RSVP and receipt delivery for unpaid orders', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug, 'rsvp');
    expect((await orderAction(req('orders', cookie, { action: 'verify', orderId: ticket.id }))).status).toBe(400);
    await env.DB.prepare("UPDATE orders SET status = 'payment_pending' WHERE id = ?").bind(ticket.id).run();
    expect((await orderAction(req('orders', cookie, { action: 'resend', orderId: ticket.id }))).status).toBe(404);
  });
  it('paginates support by conversation without truncating a long thread', async () => {
    const cookie = await staff(); const slug = await seed(); const ticket = await booking(slug);
    for (let i = 0; i < 21; i++) await env.DB.prepare(`INSERT INTO support_cases (id, attendee_id, event_slug, order_id, kind, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'general', ?, 'waiting_support', ?, ?)`).bind(`${slug}-${i}`, ticket.id, slug, ticket.id, `Case ${i}`, now(), now()).run();
    const thread = `${slug}-20`;
    for (let offset = 0; offset < 610; offset += 50) await env.DB.batch(Array.from({ length: Math.min(50, 610 - offset) }, (_, i) => env.DB.prepare(`INSERT INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES (?, ?, 'attendee', ?, ?, ?)`).bind(`${thread}-${offset+i}`, thread, ticket.id, `Message ${offset+i}`, now())));
    const first = await (await support(req('support', cookie))).json() as { total: number; cases: Array<{ id: string; messages: unknown[] }> };
    expect(first.total).toBe(21); expect(first.cases).toHaveLength(20);
    expect(first.cases.find(item => item.id === thread)?.messages).toHaveLength(610);
    const next = await (await support(req('support?page=2', cookie))).json() as { cases: Array<{ id: string }> };
    expect(next.cases).toHaveLength(1); expect(first.cases.some(item => item.id === next.cases[0].id)).toBe(false);
  });
});
