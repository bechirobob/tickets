import { generateRequestDetails, type PushSubscription } from "web-push-neo";
import { validPushEndpoint } from './push-subscription';

type NotificationKind = "room_message" | "host_update" | "ticket_transfer" | "gate_update" | "event_reminder" | "test" | "waitlist_offer" | "payment_recovery" | "event_status" | "support_update" | "purchase_confirmation" | "registration_update";

type PushRow = {
  attendeeId: string;
  subscriptionId: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export type NotificationPayload = {
  eventSlug?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  sourceId?: string | null;
  tag?: string;
};

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function deliverPush(env: Cloudflare.Env, row: PushRow, payload: NotificationPayload): Promise<boolean> {
  if (!row.subscriptionId || !row.endpoint || !row.p256dh || !row.auth) return false;
  if (!validPushEndpoint(row.endpoint)) return false;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return false;
  const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } satisfies PushSubscription;
  try {
    const details = await generateRequestDetails(subscription, JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      eventSlug: payload.eventSlug ?? null,
      kind: payload.kind,
      tag: payload.tag ?? `bct-${payload.kind}`,
    }), {
      vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
      TTL: payload.kind === "room_message" ? 15 * 60 : 24 * 60 * 60,
      urgency: payload.kind === "room_message" ? "normal" : "high",
      topic: (payload.tag ?? `bct-${payload.kind}`).replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 32),
      signal: AbortSignal.timeout(7_000),
    });
    const response = await fetch(details.endpoint, { method: details.method, headers: details.headers, body: details.body, redirect: 'error', signal: AbortSignal.timeout(7_000) });
    if (!response.ok) throw Object.assign(new Error('Push delivery failed'), { statusCode: response.status });
    await env.DB.prepare("UPDATE push_subscriptions SET last_success_at = ?, failure_count = 0, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), row.subscriptionId).run();
    return true;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
    await env.DB.prepare(`
      UPDATE push_subscriptions
      SET failure_count = failure_count + 1,
          revoked_at = CASE WHEN ? IN (404, 410) THEN ? ELSE revoked_at END,
          updated_at = ?
      WHERE id = ?
    `).bind(status, new Date().toISOString(), new Date().toISOString(), row.subscriptionId).run();
    console.error(JSON.stringify({ message: "push delivery failed", status, subscriptionId: row.subscriptionId }));
    return false;
  }
}

async function persistAndPush(env: Cloudflare.Env, recipients: PushRow[], payload: NotificationPayload): Promise<number> {
  const now = new Date().toISOString();
  const uniqueAttendees = [...new Set(recipients.map((row) => row.attendeeId))];
  for (const batch of chunks(uniqueAttendees, 50)) {
    // One statement per audience chunk, not one D1 query per guest. This keeps
    // a 400-person Room fanout below per-invocation query limits.
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attendee_notifications
        (id, attendee_id, event_slug, kind, title, body, url, source_id, created_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.attendeeId'), ?, ?, ?, ?, ?, ?, ?
      FROM json_each(?)
    `).bind(
      payload.eventSlug ?? null, payload.kind, payload.title.slice(0, 120),
      payload.body.slice(0, 280), payload.url.slice(0, 300), payload.sourceId ?? null, now,
      JSON.stringify(batch.map(attendeeId => ({ id: crypto.randomUUID(), attendeeId }))),
    ).run();
  }
  let delivered = 0;
  for (const batch of chunks(recipients.filter((row) => row.subscriptionId), 20)) {
    const results = await Promise.all(batch.map((row) => deliverPush(env, row, payload)));
    delivered += results.filter(Boolean).length;
  }
  return delivered;
}

export async function notifyRoomMessage(env: Cloudflare.Env, input: {
  eventSlug: string;
  messageId: string;
  senderAttendeeId: string;
  senderName: string;
  content: string;
  announcement?: boolean;
}): Promise<void> {
  if (input.announcement) { await queueHostAnnouncement(env, input); return; }
  const now = new Date().toISOString();
  const preferenceColumn = "room_messages";
  const rows = await env.DB.prepare(`
    SELECT DISTINCT assignment.attendee_id AS attendeeId,
           subscription.id AS subscriptionId, subscription.endpoint,
           subscription.p256dh, subscription.auth
    FROM ticket_assignments assignment
    JOIN tickets ticket ON ticket.id = assignment.ticket_id
    JOIN attendee_profiles profile ON profile.id = assignment.attendee_id AND profile.status = 'active'
    LEFT JOIN notification_preferences preference
      ON preference.attendee_id = assignment.attendee_id AND preference.event_slug = ticket.event_slug
    LEFT JOIN push_subscriptions subscription
      ON subscription.attendee_id = assignment.attendee_id AND subscription.revoked_at IS NULL AND subscription.room_updates = 1
    WHERE ticket.event_slug = ? AND assignment.status = 'active'
      AND ticket.status IN ('issued', 'checked_in')
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = ticket.order_id AND o.status = 'paid' AND (o.payment_provider <> 'rsvp' OR EXISTS (SELECT 1 FROM event_registrations r JOIN event_registration_settings rs ON rs.event_slug = r.event_slug WHERE r.order_id = o.id AND r.status = 'confirmed' AND rs.room_access = 1)))
      AND NOT EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = ticket.event_slug AND (e.removed_at IS NOT NULL OR e.event_state IN ('cancelled', 'postponed')))
      AND assignment.attendee_id <> ?
      AND NOT EXISTS (
        SELECT 1 FROM room_suspensions suspension
        WHERE suspension.event_slug = ticket.event_slug
          AND suspension.attendee_id = assignment.attendee_id AND suspension.restored_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM room_blocks block
        WHERE block.event_slug = ticket.event_slug
          AND block.blocker_attendee_id = assignment.attendee_id AND block.blocked_attendee_id = ?
      )
      AND COALESCE(preference.${preferenceColumn}, 1) = 1
      AND (preference.muted_until IS NULL OR preference.muted_until <= ?)
    LIMIT 2500
  `).bind(input.eventSlug, input.senderAttendeeId, input.senderAttendeeId, now).all<PushRow>();
  if (!rows.results.length) return;
  const body = input.content.length > 110 ? `${input.content.slice(0, 107)}…` : input.content;
  await persistAndPush(env, rows.results, {
    eventSlug: input.eventSlug,
    kind: input.announcement ? "host_update" : "room_message",
    title: input.announcement ? "The Host has spoken" : `${input.senderName} is in The Room`,
    body,
    url: `/room/${encodeURIComponent(input.eventSlug)}?from=notification`,
    sourceId: input.messageId,
    tag: `room-${input.eventSlug}`,
  });
}

export async function notifyAttendee(env: Cloudflare.Env, attendeeId: string, payload: NotificationPayload): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT ? AS attendeeId, id AS subscriptionId, endpoint, p256dh, auth
    FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL LIMIT 12
  `).bind(attendeeId, attendeeId).all<PushRow>();
  await persistAndPush(env, rows.results.length ? rows.results : [{ attendeeId, subscriptionId: null, endpoint: null, p256dh: null, auth: null }], payload);
}

export async function notifyAttendeeDevice(env: Cloudflare.Env, attendeeId: string, endpoint: string, payload: NotificationPayload): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT attendee_id AS attendeeId, id AS subscriptionId, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE attendee_id = ? AND endpoint = ? AND revoked_at IS NULL LIMIT 1
  `).bind(attendeeId, endpoint).first<PushRow>();
  if (!row) return false;
  return (await persistAndPush(env, [row], payload)) === 1;
}

export async function notifyEventAttendees(env: Cloudflare.Env, eventSlug: string, payload: NotificationPayload): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT DISTINCT assignment.attendee_id AS attendeeId,
      subscription.id AS subscriptionId, subscription.endpoint, subscription.p256dh, subscription.auth
    FROM ticket_assignments assignment JOIN tickets ticket ON ticket.id = assignment.ticket_id
    LEFT JOIN push_subscriptions subscription ON subscription.attendee_id = assignment.attendee_id AND subscription.revoked_at IS NULL
    WHERE assignment.status = 'active' AND ticket.event_slug = ?
      AND ticket.status IN ('issued', 'checked_in', 'voided', 'refunded') LIMIT 2500
  `).bind(eventSlug).all<PushRow>();
  if (rows.results.length) await persistAndPush(env, rows.results, { ...payload, eventSlug });
}

// Confirmation preferences are separate from Room alerts. Only devices whose
// owner explicitly enabled confirmations can replace the email fallback.
export async function confirmationNotice(env: Cloudflare.Env, attendeeId: string, payload: NotificationPayload, push = true): Promise<number> {
  const rows = push ? await env.DB.prepare(`
    SELECT ? AS attendeeId, id AS subscriptionId, endpoint, p256dh, auth
    FROM push_subscriptions WHERE attendee_id = ? AND revoked_at IS NULL AND confirmation_updates = 1
      AND EXISTS (SELECT 1 FROM attendee_profiles p JOIN attendee_sessions s ON s.attendee_id = p.id
        WHERE p.id = push_subscriptions.attendee_id AND p.status = 'active' AND s.revoked_at IS NULL AND s.expires_at > ?)
    LIMIT 12
  `).bind(attendeeId, attendeeId, new Date().toISOString()).all<PushRow>() : { results: [] };
  return persistAndPush(env, rows.results.length ? rows.results : [{ attendeeId, subscriptionId: null, endpoint: null, p256dh: null, auth: null }], payload);
}

// Host notices are delivered per guest so a full event cannot exhaust one
// Worker's push subrequests or D1 query allowance. The inbox is durable first.
const hostAudience = `FROM ticket_assignments a JOIN tickets t ON t.id=a.ticket_id
  JOIN orders o ON o.id=t.order_id AND o.status='paid'
  JOIN attendee_profiles p ON p.id=a.attendee_id AND p.status='active'
  JOIN curated_event_records e ON e.slug=t.event_slug AND e.removed_at IS NULL AND e.status IN ('published','scheduled') AND e.schedule_status='confirmed'
  WHERE t.event_slug=? AND a.status='active' AND t.status IN ('issued','checked_in')
    AND e.event_state NOT IN ('cancelled','postponed')
    AND (o.payment_provider<>'rsvp' OR EXISTS (SELECT 1 FROM event_registrations r JOIN event_registration_settings rs ON rs.event_slug=r.event_slug WHERE r.order_id=o.id AND r.status='confirmed' AND rs.room_access=1))
    AND a.attendee_id<>?
    AND NOT EXISTS (SELECT 1 FROM room_suspensions s WHERE s.event_slug=t.event_slug AND s.attendee_id=a.attendee_id AND s.restored_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM room_blocks b WHERE b.event_slug=t.event_slug AND b.blocker_attendee_id=a.attendee_id AND b.blocked_attendee_id=?)`;

async function queueHostAnnouncement(env: Cloudflare.Env, input: {eventSlug:string;messageId:string;senderAttendeeId:string;content:string}) {
  const audience = await env.DB.prepare(`SELECT DISTINCT a.attendee_id AS attendeeId, e.title AS eventTitle ${hostAudience}`)
    .bind(input.eventSlug,input.senderAttendeeId,input.senderAttendeeId).all<{attendeeId:string;eventTitle:string}>();
  if (!audience.results.length) return;
  const now=new Date().toISOString();
  const payload:NotificationPayload={eventSlug:input.eventSlug,kind:'host_update',title:`Host announcement · ${audience.results[0].eventTitle}`.slice(0,120),
    body:input.content.slice(0,280),url:`/room/${encodeURIComponent(input.eventSlug)}?from=notification&announcement=${encodeURIComponent(input.messageId)}`,
    sourceId:input.messageId,tag:`host-${input.messageId.replace(/[^A-Za-z0-9_-]/gu,'').slice(-26)}`};
  for (const batch of chunks(audience.results,50)) {
    const recipients=JSON.stringify(batch.map(row=>({attendeeId:row.attendeeId,id:`${input.messageId}/${row.attendeeId}`})));
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO attendee_notifications(id,attendee_id,event_slug,kind,title,body,url,source_id,created_at)
        SELECT lower(hex(randomblob(16))),json_extract(value,'$.attendeeId'),?,'host_update',?,?,?,?,? FROM json_each(?)`)
        .bind(input.eventSlug,payload.title,payload.body,payload.url,input.messageId,now,recipients),
      env.DB.prepare(`INSERT OR IGNORE INTO room_announcement_deliveries(id,attendee_id,event_slug,sender_id,payload_json,next_attempt_at,created_at,updated_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.attendeeId'),?,?,?,?,?,? FROM json_each(?)`)
        .bind(input.eventSlug,input.senderAttendeeId,JSON.stringify(payload),now,now,now,recipients),
    ]);
  }
  if (env.EMAIL_DELIVERY_QUEUE) for(const batch of chunks(audience.results,100)) {
    try { await env.EMAIL_DELIVERY_QUEUE.sendBatch(batch.map(row=>({body:{deliveryId:`host-announcement:${input.messageId}/${row.attendeeId}`}}))); }
    catch { console.error('Host announcement saved for scheduled delivery.'); }
  }
}

export async function deliverHostAnnouncement(env:Cloudflare.Env,id:string) {
  const now=new Date().toISOString(),lease=crypto.randomUUID();
  const row=await env.DB.prepare(`UPDATE room_announcement_deliveries SET status='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?))
    RETURNING attendee_id AS attendeeId,event_slug AS eventSlug,sender_id AS senderId,payload_json AS payload,attempts,created_at AS createdAt`)
    .bind(lease,new Date(Date.now()+120000).toISOString(),now,id,now,now).first<{attendeeId:string;eventSlug:string;senderId:string;payload:string;attempts:number;createdAt:string}>();
  if(!row)return;
  const eligible=Date.now()-Date.parse(row.createdAt)<86400000 && await env.DB.prepare(`SELECT 1 ${hostAudience} AND a.attendee_id=?
    AND NOT EXISTS (SELECT 1 FROM notification_preferences n WHERE n.attendee_id=a.attendee_id AND n.event_slug=t.event_slug AND (n.host_updates=0 OR n.muted_until>?)) LIMIT 1`)
    .bind(row.eventSlug,row.senderId,row.senderId,row.attendeeId,now).first();
  const subscriptions=eligible ? await env.DB.prepare(`SELECT attendee_id AS attendeeId,id AS subscriptionId,endpoint,p256dh,auth FROM push_subscriptions
    WHERE attendee_id=? AND revoked_at IS NULL AND host_updates=1 LIMIT 12`).bind(row.attendeeId).all<PushRow>() : {results:[]};
  const results=await Promise.all(subscriptions.results.map(device=>deliverPush(env,device,JSON.parse(row.payload) as NotificationPayload)));
  const retry=results.length>0 && !results.some(Boolean) && row.attempts<3;
  await env.DB.prepare(`UPDATE room_announcement_deliveries SET status=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
    .bind(retry?'pending':'complete',new Date(Date.now()+300000).toISOString(),now,id,lease).run();
}

export async function retryHostAnnouncements(env:Cloudflare.Env) {
  if(!env.EMAIL_DELIVERY_QUEUE)return;
  const now=new Date().toISOString();
  const rows=await env.DB.prepare(`SELECT id FROM room_announcement_deliveries WHERE (status='pending' AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY created_at LIMIT 100`)
    .bind(now,now).all<{id:string}>();
  if(rows.results.length)await env.EMAIL_DELIVERY_QUEUE.sendBatch(rows.results.map(row=>({body:{deliveryId:`host-announcement:${row.id}`}})));
  await env.DB.prepare("DELETE FROM room_announcement_deliveries WHERE status='complete' AND created_at<?").bind(new Date(Date.now()-7*86400000).toISOString()).run();
}
