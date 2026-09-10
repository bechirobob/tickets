import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GET as readFlashes } from '../app/api/rooms/[slug]/flashes/route';
import { GET as readVip } from '../app/api/rooms/[slug]/vip/route';
import { GET as readAccess } from '../app/api/rooms/[slug]/access/route';
import { hashToken, readAttendeeRoomAccess } from '../lib/attendee-auth';
import { notifyRoomMessage } from '../lib/notifications';
import { POST as subscribe } from '../app/api/customer/notifications/subscription/route';

async function fixture() {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const slug = `room-boundary-${id}`, attendeeId = `attendee-${id}`, orderId = `order-${id}`;
  const token = `session-${id}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
      SELECT ?,?,?,title,venue,area,?,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,future,now,now,now),
    env.DB.prepare(`INSERT INTO attendee_profiles (id,normalized_email,display_name,status,created_at,updated_at) VALUES (?,?,'Guest','active',?,?)`).bind(attendeeId,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)`).bind(id,attendeeId,await hashToken(token),future,now,now),
    env.DB.prepare(`INSERT INTO orders (id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at)
      VALUES (?,?,?,1,10000,0,10000,'GHS',?,'233000000000','card','paid',?,?)`).bind(orderId,id,slug,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO tickets (id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',?,'issued',?)`).bind(id,orderId,slug,id,now),
    env.DB.prepare(`INSERT INTO ticket_assignments (ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'fixture','active',?)`).bind(id,attendeeId,now),
  ]);
  return { slug, attendeeId, orderId, cookie: `bct_attendee=${token}`, now };
}

describe('Room access boundaries', () => {
  it('caps devices atomically and permits refreshing an existing subscription', async () => {
    const f = await fixture(), origin = 'https://tickets.becoreops.com';
    const keys = { p256dh: btoa(String.fromCharCode(4) + 'a'.repeat(64)).replace(/=+$/u,''), auth: btoa('a'.repeat(16)).replace(/=+$/u,'') };
    const send = (endpoint: string) => subscribe(new Request(`${origin}/api/customer/notifications/subscription`, { method: 'POST', headers: { origin, cookie: f.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, keys }) }));
    expect((await send('https://127.0.0.1/private')).status).toBe(400);
    const endpoints = Array.from({length:14}, (_,i)=>`https://fcm.googleapis.com/fcm/send/${f.attendeeId}-${i}`);
    const results = await Promise.all(endpoints.map(send));
    expect(results.filter(result=>result.status === 201)).toHaveLength(12);
    expect(results.filter(result=>result.status === 409)).toHaveLength(2);
    expect((await send(endpoints[results.findIndex(result=>result.status === 201)])).status).toBe(201);
  });
  it('enforces suspension on photo, VIP and access endpoints while retaining purchase access', async () => {
    const f = await fixture();
    const request = new Request(`https://tickets.becoreops.com/api/rooms/${f.slug}/access`, { headers: { cookie: f.cookie } });
    const context = { params: Promise.resolve({ slug: f.slug }) };
    expect((await readAccess(request, context)).status).toBe(200);
    await env.DB.prepare(`INSERT INTO room_suspensions (event_slug,attendee_id,reason,suspended_at,suspended_by) VALUES (?,?,'Moderation',?,'fixture')`).bind(f.slug,f.attendeeId,f.now).run();
    expect((await readAccess(request, context)).status).toBe(401);
    expect((await readFlashes(request, context)).status).toBe(401);
    expect((await readVip(request, context)).status).toBe(401);
    expect(await readAttendeeRoomAccess(env.DB, f.cookie, f.slug, false)).toMatchObject({ attendeeId: f.attendeeId });
    await env.DB.prepare('UPDATE room_suspensions SET restored_at=? WHERE event_slug=? AND attendee_id=?').bind(f.now,f.slug,f.attendeeId).run();
    expect((await readAccess(request, context)).status).toBe(200);
  });

  it.each(['refund_pending', 'disputed', 'refunded', 'requires_refund'])('does not send private Room content to a %s purchase', async (status) => {
    const f = await fixture();
    // Even if a ticket row has not yet been voided, the payment state is authoritative.
    await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind(status,f.orderId).run();
    await notifyRoomMessage(env, { eventSlug: f.slug, messageId: crypto.randomUUID(), senderAttendeeId: 'another-guest', senderName: 'Guest', content: 'Private Room content' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM attendee_notifications WHERE attendee_id=?').bind(f.attendeeId).first()).toEqual({ count: 0 });
  });
});
