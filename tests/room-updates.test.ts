import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GET as summary } from '../app/api/customer/room-updates/route';
import { GET as access } from '../app/api/rooms/[slug]/access/route';
import { POST as acknowledge } from '../app/api/rooms/[slug]/updates/read/route';
import { hashToken } from '../lib/attendee-auth';
import { notifyRoomMessage } from '../lib/notifications';
import { captureRoomUpdateSnapshot, acknowledgeRoomUpdateSnapshot } from '../lib/room-updates';

const origin = 'https://tickets.becoreops.com';
async function fixture() {
  const id = crypto.randomUUID(), token = crypto.randomUUID(), now = new Date().toISOString();
  const slug = `updates-${id}`, future = new Date(Date.now() + 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
      SELECT ?,?,?,title,venue,area,?,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',?,?,? FROM curated_event_records WHERE slug='after-dark-osu'`).bind(id,id,slug,now,future,now,now,now),
    env.DB.prepare(`INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,?,'Private Guest','active',?,?)`).bind(id,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)`).bind(id,id,await hashToken(token),future,now,now),
    env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at)
      VALUES(?,?,?,1,10000,0,10000,'GHS',?,'233000000000','card','paid',?,?)`).bind(id,id,slug,`${id}@example.com`,now,now),
    env.DB.prepare(`INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)`).bind(id,id,slug,id,now),
    env.DB.prepare(`INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'fixture','active',?)`).bind(id,id,now),
  ]);
  return { id, slug, now, future, cookie: `bct_attendee=${token}` };
}
type Guest = Awaited<ReturnType<typeof fixture>>;
async function notice(f: Guest, kind = 'room_message', eventSlug = f.slug) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO attendee_notifications(id,attendee_id,event_slug,kind,title,body,url,source_id,created_at)
    VALUES(?,?,?,?,'Private sender','Private body','/private',?,?)`).bind(id,f.id,eventSlug,kind,id,f.now).run();
  return id;
}
async function read(f?: Guest) { return summary(new Request(`${origin}/api/customer/room-updates`, { headers: f ? { cookie: f.cookie } : {} })); }
const context = (f: Guest) => ({ params: Promise.resolve({ slug: f.slug }) });
async function cursor(f: Guest) {
  const response = await access(new Request(`${origin}/api/rooms/${f.slug}/access`, { headers: { cookie: f.cookie } }), context(f));
  return (await response.json() as { updateSnapshot: string }).updateSnapshot;
}
async function ack(f: Guest, snapshot: string, requestOrigin = origin) {
  return acknowledge(new Request(`${origin}/api/rooms/${f.slug}/updates/read`, { method: 'POST', headers: { cookie: f.cookie, origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) }), context(f));
}
async function unread(f: Guest) { return (await (await read(f)).json() as { unread: number }).unread; }

describe('private count-only Room shortcut', () => {
  it('reveals no Room metadata to anonymous or forged sessions', async () => {
    const f = await fixture(); await notice(f);
    expect(await (await read()).json()).toEqual({ rooms: [], unread: 0 });
    expect(await (await read({ ...f, cookie: 'bct_attendee=forged' })).json()).toEqual({ rooms: [], unread: 0 });
  });
  it('counts beyond 100 and deduplicates ticket access without serializing private payloads', async () => {
    const f = await fixture();
    await env.DB.prepare(`INSERT INTO attendee_notifications(id,attendee_id,event_slug,kind,title,body,url,source_id,created_at)
      SELECT value,?,?,'room_message','Private sender','Private body','/private',value,? FROM json_each(?)`)
      .bind(f.id,f.slug,f.now,JSON.stringify(Array.from({length:125},()=>crypto.randomUUID()))).run();
    await notice(f, 'host_update'); await notice(f, 'purchase_confirmation'); await notice(f, 'support_update');
    const second = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',2,?,'checked_in',?)`).bind(second,f.id,f.slug,second,f.now),
      env.DB.prepare(`INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'fixture','active',?)`).bind(second,f.id,f.now),
    ]);
    const response = await read(f), body = await response.json() as { rooms: Array<Record<string, unknown>>; unread: number };
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(body.unread).toBe(126); expect(body.rooms).toHaveLength(1);
    expect(Object.keys(body.rooms[0]).sort()).toEqual(['eventSlug','expiresAt','title','unread']);
    expect(JSON.stringify(body)).not.toMatch(/Private sender|Private body|Private Guest|@example|attendeeId|ticketId/u);
  });
  it.each([
    ["UPDATE attendee_sessions SET revoked_at='2026-01-01' WHERE id=?"],
    ["UPDATE attendee_sessions SET expires_at='2026-01-01' WHERE id=?"],
    ["UPDATE attendee_profiles SET status='suspended' WHERE id=?"],
    ["UPDATE ticket_assignments SET status='revoked' WHERE attendee_id=?"],
    ["UPDATE tickets SET status='voided' WHERE id=?"],
    ["UPDATE orders SET status='refund_pending' WHERE id=?"],
    ["UPDATE orders SET status='disputed' WHERE id=?"],
    ["UPDATE orders SET status='refunded' WHERE id=?"],
    ["UPDATE curated_event_records SET event_state='cancelled' WHERE id=?"],
    ["UPDATE curated_event_records SET event_state='postponed' WHERE id=?"],
    ["UPDATE curated_event_records SET removed_at='2026-01-01' WHERE id=?"],
    ["UPDATE curated_event_records SET archived_at='2026-01-01' WHERE id=?"],
    ["UPDATE curated_event_records SET status='draft' WHERE id=?"],
    ["UPDATE curated_event_records SET schedule_status='coming_soon' WHERE id=?"],
    ["UPDATE curated_event_records SET ends_at='2026-01-01' WHERE id=?"],
  ])('removes access on %s', async sql => {
    const f = await fixture(); await notice(f); expect(await unread(f)).toBe(1);
    await env.DB.prepare(sql).bind(f.id).run();
    expect(await (await read(f)).json()).toEqual({ rooms: [], unread: 0 });
  });
  it('waits for scheduled publication and stops at the 72-hour Room boundary', async () => {
    const f = await fixture(); await notice(f);
    await env.DB.prepare("UPDATE curated_event_records SET status='scheduled',scheduled_publish_at=? WHERE id=?").bind(f.future,f.id).run();
    expect(await unread(f)).toBe(0);
    await env.DB.prepare("UPDATE curated_event_records SET scheduled_publish_at='2026-01-01' WHERE id=?").bind(f.id).run();
    expect(await unread(f)).toBe(1);
    await env.DB.prepare('UPDATE curated_event_records SET ends_at=? WHERE id=?').bind(new Date(Date.now()-72*3600_000).toISOString(),f.id).run();
    expect(await unread(f)).toBe(0);
  });
  it('excludes suspended and archived Rooms but preserves emergency-read-only announcements', async () => {
    const f = await fixture(); await notice(f,'host_update');
    await env.DB.prepare(`INSERT INTO room_settings(event_slug,emergency_read_only,updated_at,updated_by) VALUES(?,1,?,'fixture')`).bind(f.slug,f.now).run();
    expect(await unread(f)).toBe(1);
    await env.DB.prepare(`INSERT INTO room_suspensions(event_slug,attendee_id,reason,suspended_at,suspended_by) VALUES(?,?,'Fixture',?,'fixture')`).bind(f.slug,f.id,f.now).run();
    expect(await unread(f)).toBe(0);
    await env.DB.prepare('UPDATE room_suspensions SET restored_at=? WHERE event_slug=?').bind(f.now,f.slug).run();
    expect(await unread(f)).toBe(1);
    await env.DB.prepare('UPDATE room_settings SET archived_at=? WHERE event_slug=?').bind(f.now,f.slug).run();
    expect(await unread(f)).toBe(0);
  });
  it('requires confirmed RSVP admission and enabled Room access', async () => {
    const f = await fixture(); await notice(f);
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET payment_provider='rsvp' WHERE id=?").bind(f.id),
      env.DB.prepare("INSERT INTO event_registration_settings(event_slug,mode,capacity,room_access,updated_at) VALUES(?,'rsvp',100,0,?)").bind(f.slug,f.now),
      env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,order_id,created_at,updated_at) VALUES(?,?,'fixture@example.com','Guest',1,'rsvp','requested',?,?,?)").bind(f.id,f.slug,f.id,f.now,f.now),
    ]);
    expect(await unread(f)).toBe(0);
    await env.DB.prepare("UPDATE event_registrations SET status='confirmed' WHERE id=?").bind(f.id).run(); expect(await unread(f)).toBe(0);
    await env.DB.prepare('UPDATE event_registration_settings SET room_access=1 WHERE event_slug=?').bind(f.slug).run(); expect(await unread(f)).toBe(1);
  });
  it('preserves existing mute and sender/block semantics without changing push preferences', async () => {
    const f = await fixture();
    const send = (senderAttendeeId: string, announcement = false) => notifyRoomMessage(env, { eventSlug: f.slug, messageId: crypto.randomUUID(), senderAttendeeId, senderName: 'Guest', content: 'Private body', announcement });
    await send(f.id); expect(await unread(f)).toBe(0);
    await env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),f.slug,f.id,'blocked',f.now).run();
    await send('blocked'); expect(await unread(f)).toBe(0);
    await send('another'); expect(await unread(f)).toBe(1);
    await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,muted_until,updated_at) VALUES(?,?,0,0,?,?)').bind(f.id,f.slug,f.future,f.now).run();
    await send('another'); await send('admin:host',true); expect(await unread(f)).toBe(2);
    expect(await env.DB.prepare('SELECT room_messages,host_updates,muted_until FROM notification_preferences WHERE attendee_id=?').bind(f.id).first()).toEqual({room_messages:0,host_updates:0,muted_until:f.future});
  });
});

describe('visible Room snapshot acknowledgment', () => {
  it('leaves future arrivals, other events, other guests and unrelated notices untouched', async () => {
    const f = await fixture(), other = await fixture();
    const first = await notice(f), host = await notice(f,'host_update');
    const outside = [await notice(f,'room_message',other.slug),await notice(f,'support_update'),await notice(other)];
    const snapshot = await cursor(f); expect(snapshot).toBeTruthy();
    // Same timestamp: a wall-clock cutoff would incorrectly consume this row.
    const future = await notice(f); outside.push(future);
    expect((await ack(f,snapshot)).status).toBe(200);
    expect(await unread(f)).toBe(1);
    const reads = (await env.DB.prepare('SELECT id,read_at FROM attendee_notifications WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([first,host,...outside])).all<{id:string;read_at:string|null}>()).results;
    expect(reads.filter(row=>row.read_at).map(row=>row.id).sort()).toEqual([first,host].sort());
    const before = reads.filter(row=>row.read_at); expect((await ack(f,snapshot)).status).toBe(200);
    expect((await env.DB.prepare('SELECT id,read_at FROM attendee_notifications WHERE id IN (?,?)').bind(first,host).all()).results).toEqual(before);
  });
  it('rejects tampering, another session/event, cross-origin requests and revoked access', async () => {
    const f = await fixture(), other = await fixture(); await notice(f); await notice(other);
    const snapshot = await cursor(f);
    expect((await ack(f,`${snapshot}x`)).status).toBe(400);
    expect((await ack(other,snapshot)).status).toBe(400);
    expect((await ack(f,snapshot,'https://other.example')).status).toBe(403);
    expect(await acknowledgeRoomUpdateSnapshot(env.DB,f.cookie,other.slug,snapshot)).toBe(false);
    await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(f.now,f.id).run();
    expect((await ack(f,snapshot)).status).toBe(401);
    expect(await env.DB.prepare('SELECT read_at FROM attendee_notifications WHERE attendee_id=?').bind(f.id).first()).toEqual({read_at:null});
  });
  it('does not acknowledge rows reused after the captured sentinel is deleted', async () => {
    const f = await fixture(); const old = await notice(f);
    const row = await env.DB.prepare('SELECT rowid AS row FROM attendee_notifications WHERE id=?').bind(old).first<{row:number}>();
    const snapshot = await captureRoomUpdateSnapshot(env.DB,f.cookie,f.slug,f.id);
    await env.DB.prepare('DELETE FROM attendee_notifications WHERE id=?').bind(old).run();
    const next = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO attendee_notifications(rowid,id,attendee_id,event_slug,kind,title,body,url,created_at) VALUES(?,?,?,?,'room_message','Title','Body','/room',?)`).bind(row!.row,next,f.id,f.slug,f.now).run();
    expect((await ack(f,snapshot!)).status).toBe(200);
    expect(await env.DB.prepare('SELECT read_at FROM attendee_notifications WHERE id=?').bind(next).first()).toEqual({read_at:null});
  });
});
