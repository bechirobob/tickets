import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverHostAnnouncement } from '../lib/notifications';
import { queueFirstHostPost } from '../lib/room-host-first-post';

const encode = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
let vapid: { publicKey: string; privateKey: string }, keys: {p256dh:string;auth:string};
beforeEach(async () => {
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  vapid = {publicKey:encode(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey:(await crypto.subtle.exportKey('jwk',pair.privateKey)).d!};
  keys = {p256dh:vapid.publicKey,auth:encode(crypto.getRandomValues(new Uint8Array(16)).buffer)};
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

async function fixture() {
  const id = crypto.randomUUID(), slug = `push-fence-${id}`, now = new Date().toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const account = `account-${id}`, host = `host-${id}`, guest = `guest-${id}`, messageId = crypto.randomUUID();
  const subscriptionId = `device-${id}`, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at)
      VALUES(?,?,?,'Synthetic event','Venue','Accra',?,?,'Night',0,10,'on_sale','','Test','published',?,?,?)`)
      .bind(id,id,slug,now,future,now,now,now),
    env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at)
      VALUES(?,?,'Synthetic host','organizer','test','test',1,0,'active',?,?,'fixture',?)`)
      .bind(account,`${host}@example.com`,now,now,now),
    env.DB.prepare('INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,?,?)').bind(account,slug,account,now),
  ]);
  for (const who of [host,guest]) await env.DB.batch([
    env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,email_verified_at,created_at,updated_at) VALUES(?,?,'Synthetic attendee','active',?,?,?)").bind(who,`${who}@example.com`,now,now,now),
    env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES(?,?,?,1,10000,0,10000,'GHS',?,'233000000000','card','paid',?,?)").bind(who,who,slug,`${who}@example.com`,now,now),
    env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)").bind(who,who,slug,who,now),
    env.DB.prepare("INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES(?,?,'fixture','active',?)").bind(who,who,now),
  ]);
  await env.DB.prepare(`INSERT INTO push_subscriptions(id,attendee_id,endpoint,p256dh,auth,host_updates,created_at,updated_at)
    VALUES(?,?,?,?,?,1,?,?)`).bind(subscriptionId,guest,endpoint,keys.p256dh,keys.auth,now,now).run();
  const room = env.THE_ROOM.getByName(slug);
  await runInDurableObject(room, async (instance,state) => {
    instance.updatePolicy({eventSlug:slug,eventTitle:'Synthetic event',startsAt:now,endsAt:future,readOnlyAt:future,readOnly:false});
    state.storage.sql.exec("INSERT INTO messages(id,attendee_id,display_name,role,kind,content,pinned,created_at) VALUES(?,?,'Synthetic host','organizer','message','Private synthetic content',0,?)",messageId,host,now);
    state.storage.sql.exec('INSERT INTO room_host_posts(host_account_id,message_id,sender_attendee_id,created_at,completed_at) VALUES(?,?,?,?,?)',account,messageId,host,now,now);
  });
  const configured = { ...env, EMAIL_DELIVERY_QUEUE:undefined, ROOM_HOST_FIRST_POST_ENABLED:'1', ROOM_HOST_FIRST_POST_EVENT_SLUG:slug,
    ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID:account, VAPID_PUBLIC_KEY:vapid.publicKey, VAPID_PRIVATE_KEY:vapid.privateKey, VAPID_SUBJECT:'mailto:synthetic@example.com' };
  await queueFirstHostPost(configured,{eventSlug:slug,hostAccountId:account,senderAttendeeId:host,messageId,createdAt:now});
  const deliveryId = `${messageId}/${guest}`;
  const deliver = () => deliverHostAnnouncement(configured,deliveryId);
  const outcome = () => env.DB.prepare('SELECT status,lease_token AS lease FROM room_announcement_deliveries WHERE id=?').bind(deliveryId).first<{status:string;lease:string|null}>();
  return {slug,now,future,account,host,guest,messageId,subscriptionId,endpoint,room,configured,deliveryId,deliver,outcome};
}

// D1, Room storage and push encryption are real and local. Only the outbound
// fetch is mocked. Inject changes at the second source RPC, after discovery and
// encryption, so neither initial eligibility nor timing luck can mask the race.
function beforeFinalSource(f: Awaited<ReturnType<typeof fixture>>, change: () => Promise<void>) {
  let reads = 0;
  f.configured.THE_ROOM = {getByName: () => ({getMessage: async (id: string) => {
    if (++reads === 2) await change();
    return f.room.getMessage(id);
  }})} as unknown as Cloudflare.Env['THE_ROOM'];
  return () => reads;
}

describe('first-host push dispatch fence', () => {
  it('preserves opted-in delivery and concurrent queue deduplication', async () => {
    const f = await fixture();
    await Promise.all([f.deliver(),f.deliver()]);
    await f.deliver();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await f.outcome()).toEqual({status:'complete',lease:null});
  });

  it('rechecks the source after subscription discovery and asynchronous encryption', async () => {
    const f = await fixture();
    const reads = beforeFinalSource(f,async () => {
      await f.room.removeMessage(f.messageId);
    });
    await f.deliver();
    expect(reads()).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(await f.outcome()).toEqual({status:'complete',lease:null});
  });

  it('rejects a stale source read when cancellation commits before the final D1 claim', async () => {
    const f = await fixture();
    let reads = 0;
    f.configured.THE_ROOM = { getByName: () => ({ getMessage: async (id: string) => {
      const source = await f.room.getMessage(id);
      if (++reads === 2) await f.room.removeMessage(id);
      return source;
    } }) } as unknown as Cloudflare.Env['THE_ROOM'];
    await f.deliver();
    expect(reads).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(await f.outcome()).toEqual({status:'complete',lease:null});
  });

  it.each(['receipt-cancelled','lease-lost','lease-expired','job-complete','voided-pass','revoked-assignment','host-unassigned','host-disabled','host-off','muted','blocked','device-revoked','device-opted-out','device-rekeyed','flag-off','scope-changed'] as const)
    ('rejects %s committed during push preparation', async reason => {
      const f = await fixture();
      const reads = beforeFinalSource(f,async () => {
        if (reason==='receipt-cancelled') await env.DB.prepare('UPDATE room_host_first_posts SET cancelled_at=? WHERE message_id=?').bind(f.now,f.messageId).run();
        if (reason==='lease-lost') await env.DB.prepare("UPDATE room_announcement_deliveries SET lease_token='new-owner' WHERE id=?").bind(f.deliveryId).run();
        if (reason==='lease-expired') await env.DB.prepare("UPDATE room_announcement_deliveries SET lease_until='2000-01-01' WHERE id=?").bind(f.deliveryId).run();
        if (reason==='job-complete') await env.DB.prepare("UPDATE room_announcement_deliveries SET status='complete',lease_token=NULL WHERE id=?").bind(f.deliveryId).run();
        if (reason==='voided-pass') await env.DB.prepare("UPDATE tickets SET status='voided' WHERE id=?").bind(f.guest).run();
        if (reason==='revoked-assignment') await env.DB.prepare("UPDATE ticket_assignments SET status='revoked' WHERE ticket_id=?").bind(f.guest).run();
        if (reason==='host-unassigned') await env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(f.account).run();
        if (reason==='host-disabled') await env.DB.prepare("UPDATE staff_accounts SET status='disabled' WHERE id=?").bind(f.account).run();
        if (reason==='host-off'||reason==='muted') await env.DB.prepare('INSERT INTO notification_preferences(attendee_id,event_slug,room_messages,host_updates,muted_until,updated_at) VALUES(?,?,1,?,?,?)').bind(f.guest,f.slug,reason==='host-off'?0:1,reason==='muted'?f.future:null,f.now).run();
        if (reason==='blocked') await env.DB.prepare('INSERT INTO room_blocks(id,event_slug,blocker_attendee_id,blocked_attendee_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),f.slug,f.guest,f.host,f.now).run();
        if (reason==='device-revoked') await env.DB.prepare('UPDATE push_subscriptions SET revoked_at=? WHERE id=?').bind(f.now,f.subscriptionId).run();
        if (reason==='device-opted-out') await env.DB.prepare('UPDATE push_subscriptions SET host_updates=0 WHERE id=?').bind(f.subscriptionId).run();
        if (reason==='device-rekeyed') await env.DB.prepare("UPDATE push_subscriptions SET p256dh='replacement-key' WHERE id=?").bind(f.subscriptionId).run();
        if (reason==='flag-off') f.configured.ROOM_HOST_FIRST_POST_ENABLED='0';
        if (reason==='scope-changed') f.configured.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID='different-host';
      });
      await f.deliver();
      expect(reads()).toBe(2);
      expect(fetch).not.toHaveBeenCalled();
      if (reason==='lease-lost') expect(await f.outcome()).toEqual({status:'processing',lease:'new-owner'});
      expect(await env.DB.prepare('SELECT failure_count AS n FROM push_subscriptions WHERE id=?').bind(f.subscriptionId).first()).toEqual({n:0});
    });

  it('does not claim recall after the authorized provider handoff has begun', async () => {
    const f = await fixture();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await f.room.removeMessage(f.messageId);
      return new Response(null,{status:201});
    });
    await f.deliver();
    await f.deliver();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await f.outcome()).toEqual({status:'complete',lease:null});
  });

  it('preserves ordinary host announcements without the first-host source or identity fence', async () => {
    const f = await fixture();
    await env.DB.batch([
      env.DB.prepare("UPDATE room_announcement_deliveries SET payload_json=json_set(payload_json,'$.kind','host_update') WHERE id=?").bind(f.deliveryId),
      env.DB.prepare('DELETE FROM room_host_first_posts WHERE message_id=?').bind(f.messageId),
      env.DB.prepare('DELETE FROM staff_event_assignments WHERE account_id=?').bind(f.account),
    ]);
    f.configured.ROOM_HOST_FIRST_POST_ENABLED='0';
    f.configured.THE_ROOM = {getByName: () => {throw new Error('Ordinary announcements must not use the first-host source fence.');}} as unknown as Cloudflare.Env['THE_ROOM'];
    await f.deliver();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await f.outcome()).toEqual({status:'complete',lease:null});
  });
});
