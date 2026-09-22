import { PATCH as updatePreference } from '../app/api/customer/notifications/preferences/[slug]/route';
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as readFlashes } from '../app/api/rooms/[slug]/flashes/route';
import { GET as readVip } from '../app/api/rooms/[slug]/vip/route';
import { GET as readAccess } from '../app/api/rooms/[slug]/access/route';
import { hashToken, readAttendeeRoomAccess, readAttendeeRoomSocketAccess } from '../lib/attendee-auth';
import { deliverHostAnnouncement, notifyRoomMessage } from '../lib/notifications';
import { POST as subscribe } from '../app/api/customer/notifications/subscription/route';
import { resolveRoomPolicy } from '../lib/room-policy';

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
  it('loads current socket policy with authorization and excludes unavailable Room schedules', async () => {
    const f = await fixture();
    expect((await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug))?.policy).toEqual(await resolveRoomPolicy(env.DB,f.slug));
    expect(await readAttendeeRoomAccess(env.DB,f.cookie,f.slug)).not.toHaveProperty('roomPolicyJson');
    await env.DB.prepare('INSERT INTO room_settings(event_slug,emergency_read_only,slow_mode_seconds,updated_at,updated_by) VALUES (?,1,15,?,?)').bind(f.slug,f.now,'fixture').run();
    const updated = (await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug))?.policy;
    expect(updated).toEqual(await resolveRoomPolicy(env.DB,f.slug));
    expect(updated).toMatchObject({ readOnly: true, emergencyReadOnly: true, slowModeSeconds: 15 });
    await env.DB.prepare("UPDATE curated_event_records SET schedule_status='coming_soon' WHERE slug=?").bind(f.slug).run();
    expect((await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug))?.policy).toBeNull();
    await env.DB.prepare("UPDATE curated_event_records SET schedule_status='confirmed',status='draft' WHERE slug=?").bind(f.slug).run();
    expect((await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug))?.policy).toBeNull();
  });

  it('loads only the connecting guest’s event blocks and denies suspended or revoked sockets', async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),f.slug,f.attendeeId,'blocked-here',f.now),
      env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),'another-event',f.attendeeId,'other-event-block',f.now),
      env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),f.slug,'another-guest','other-guest-block',f.now),
    ]);
    expect(await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug)).toMatchObject({ access: { attendeeId: f.attendeeId }, blockedAttendeeIds: ['blocked-here'] });
    expect(await readAttendeeRoomAccess(env.DB,f.cookie,f.slug)).not.toHaveProperty('blockedIdsJson');
    await env.DB.prepare("INSERT INTO room_suspensions(event_slug,attendee_id,reason,suspended_at,suspended_by) VALUES (?,?,'Test',?,'fixture')").bind(f.slug,f.attendeeId,f.now).run();
    expect(await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug)).toBeNull();
    await env.DB.prepare('UPDATE room_suspensions SET restored_at=? WHERE event_slug=? AND attendee_id=?').bind(f.now,f.slug,f.attendeeId).run();
    expect(await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug)).not.toBeNull();
    await env.DB.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE attendee_id=?').bind(f.now,f.attendeeId).run();
    expect(await readAttendeeRoomSocketAccess(env.DB,f.cookie,f.slug)).toBeNull();
  });

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


describe('Host announcements for confirmed guests', () => {
  const original = {VAPID_PUBLIC_KEY:env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY:env.VAPID_PRIVATE_KEY,VAPID_SUBJECT:env.VAPID_SUBJECT};
  const encode=(buffer:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
  let keys:{p256dh:string;auth:string};
  beforeEach(async()=>{
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    env.VAPID_PUBLIC_KEY=encode(await crypto.subtle.exportKey('raw',pair.publicKey));
    env.VAPID_PRIVATE_KEY=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d!;
    env.VAPID_SUBJECT='mailto:test@example.com';
    keys={p256dh:env.VAPID_PUBLIC_KEY,auth:encode(crypto.getRandomValues(new Uint8Array(16)).buffer)};
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:201}));
  });
  afterEach(()=>{Object.assign(env,original);vi.restoreAllMocks();});
  async function device(f:Awaited<ReturnType<typeof fixture>>, flags:Record<string,boolean>={hostUpdates:true}) {
    return subscribe(new Request('https://tickets.becoreops.com/api/customer/notifications/subscription',{method:'POST',headers:{origin:'https://tickets.becoreops.com',cookie:f.cookie,'content-type':'application/json'},body:JSON.stringify({endpoint:`https://fcm.googleapis.com/fcm/send/${f.attendeeId}`,keys,...flags})}));
  }
  function input(f:Awaited<ReturnType<typeof fixture>>,announcement=true){return {eventSlug:f.slug,messageId:crypto.randomUUID(),senderAttendeeId:'admin:host',senderName:'Host',content:'Garden entrance tonight. Your people are waiting.',announcement};}
  it('announces before a guest opens the Room, with explicit host consent and independent chat settings',async()=>{
    const f=await fixture();expect((await device(f,{confirmationUpdates:true})).status).toBe(201);
    const first=input(f);await notifyRoomMessage(env,first);await deliverHostAnnouncement(env,`${first.messageId}/${f.attendeeId}`);
    expect(fetch).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT kind,title,url FROM attendee_notifications WHERE attendee_id=?').bind(f.attendeeId).first()).toMatchObject({kind:'host_update',title:expect.stringContaining('Host announcement'),url:expect.stringContaining(`announcement=${first.messageId}`)});
    expect((await device(f)).status).toBe(201);
    expect(await env.DB.prepare('SELECT confirmation_updates AS confirmations,host_updates AS hosts,room_updates AS rooms FROM push_subscriptions WHERE attendee_id=?').bind(f.attendeeId).first()).toEqual({confirmations:1,hosts:1,rooms:0});
    await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,updated_at) VALUES(?,?,0,1,?)').bind(f.attendeeId,f.slug,f.now).run();
    const next=input(f);await notifyRoomMessage(env,next);await notifyRoomMessage(env,next);
    await Promise.all([deliverHostAnnouncement(env,`${next.messageId}/${f.attendeeId}`),deliverHostAnnouncement(env,`${next.messageId}/${f.attendeeId}`)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_notifications WHERE source_id=?').bind(next.messageId).first()).toEqual({n:1});
    await notifyRoomMessage(env,input(f,false));expect(fetch).toHaveBeenCalledTimes(1);
    await env.DB.prepare('UPDATE notification_preferences SET host_updates=0 WHERE attendee_id=?').bind(f.attendeeId).run();
    const muted=input(f);await notifyRoomMessage(env,muted);await deliverHostAnnouncement(env,`${muted.messageId}/${f.attendeeId}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT id FROM attendee_notifications WHERE source_id=?').bind(muted.messageId).first()).not.toBeNull();
  });
  it.each(['refunded','suspended','cancelled','transferred'] as const)('rechecks %s access before a queued announcement sends',async(reason)=>{
    const f=await fixture();await device(f);const notice=input(f);await notifyRoomMessage(env,notice);
    if(reason==='refunded')await env.DB.prepare("UPDATE orders SET status='refunded' WHERE id=?").bind(f.orderId).run();
    if(reason==='suspended')await env.DB.prepare("INSERT INTO room_suspensions(event_slug,attendee_id,reason,suspended_at,suspended_by) VALUES(?,?,'Test',?,'test')").bind(f.slug,f.attendeeId,f.now).run();
    if(reason==='cancelled')await env.DB.prepare("UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?").bind(f.slug).run();
    if(reason==='transferred')await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE attendee_id=?").bind(f.attendeeId).run();
    await deliverHostAnnouncement(env,`${notice.messageId}/${f.attendeeId}`);expect(fetch).not.toHaveBeenCalled();
  });
  it('requires approved RSVP admission and Room access before announcing',async()=>{
    const f=await fixture();await device(f);
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET payment_provider='rsvp' WHERE id=?").bind(f.orderId),
      env.DB.prepare("INSERT INTO event_registration_settings(event_slug,mode,capacity,approval_required,room_access,updated_at) VALUES(?,'rsvp',100,1,0,?)").bind(f.slug,f.now),
      env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,order_id,created_at,updated_at) VALUES(?,?,'rsvp@example.com','Guest',1,'rsvp','requested',?,?,?)").bind(f.slug,f.slug,f.orderId,f.now,f.now),
    ]);
    await notifyRoomMessage(env,input(f));
    await env.DB.prepare("UPDATE event_registrations SET status='confirmed' WHERE id=?").bind(f.slug).run();await notifyRoomMessage(env,input(f));
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).first()).toEqual({n:0});
    await env.DB.prepare('UPDATE event_registration_settings SET room_access=1 WHERE event_slug=?').bind(f.slug).run();
    const notice=input(f);await notifyRoomMessage(env,notice);await deliverHostAnnouncement(env,`${notice.messageId}/${f.attendeeId}`);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('recovers interrupted work and retries rejected push without duplicating the inbox',async()=>{
    const f=await fixture();await device(f);const notice=input(f),id=`${notice.messageId}/${f.attendeeId}`;await notifyRoomMessage(env,notice);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:503}));await deliverHostAnnouncement(env,id);
    expect(await env.DB.prepare('SELECT status,attempts FROM room_announcement_deliveries WHERE id=?').bind(id).first()).toEqual({status:'pending',attempts:1});
    await env.DB.prepare("UPDATE room_announcement_deliveries SET status='processing',lease_until='2020-01-01' WHERE id=?").bind(id).run();
    await deliverHostAnnouncement(env,id);await deliverHostAnnouncement(env,id);expect(fetch).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT status,attempts FROM room_announcement_deliveries WHERE id=?').bind(id).first()).toEqual({status:'complete',attempts:2});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_notifications WHERE source_id=?').bind(notice.messageId).first()).toEqual({n:1});
  });
  it('persists an announcement for 400 guests without one synchronous push fanout',async()=>{
    const f=await fixture();const guests=JSON.stringify(Array.from({length:399},()=>crypto.randomUUID()));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) SELECT value,value||'@example.com','Guest','active',?,? FROM json_each(?)").bind(f.now,f.now,guests),
      env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) SELECT value,?,?,'general',key+2,value,'issued',? FROM json_each(?)").bind(f.orderId,f.slug,f.now,guests),
      env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) SELECT value,value,'fixture','active',? FROM json_each(?)").bind(f.now,guests),
    ]);
    const notice=input(f);await notifyRoomMessage(env,notice);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE event_slug=?').bind(f.slug).first()).toEqual({n:400});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_notifications WHERE source_id=?').bind(notice.messageId).first()).toEqual({n:400});
    expect(fetch).not.toHaveBeenCalled();
  });
});


it('preserves a timed Room mute when changing one preference and resumes only on request',async()=>{
  const f=await fixture(),origin='https://tickets.becoreops.com',until=new Date(Date.now()+3600000).toISOString();
  await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,muted_until,updated_at) VALUES(?,?,1,1,?,?)').bind(f.attendeeId,f.slug,until,f.now).run();
  const update=(body:unknown)=>updatePreference(new Request(`${origin}/api/customer/notifications/preferences/${f.slug}`,{method:'PATCH',headers:{origin,cookie:f.cookie,'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({slug:f.slug})});
  expect(await(await update({roomMessages:false})).json()).toEqual({roomMessages:false,hostUpdates:true,mutedUntil:until});
  expect(await(await update({mute:'off'})).json()).toEqual({roomMessages:false,hostUpdates:true,mutedUntil:null});
  expect((await update({hostUpdates:'yes'})).status).toBe(400);
});
