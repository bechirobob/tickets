import { hostAudience, type NotificationPayload } from './notifications';
import { roomHostEmail } from './room-host-email';
import { sendTransactional, transactionalConfigured, transactionalProvider, validTransactionalId } from './transactional-email';

export type FirstHostPost = { eventSlug: string; hostAccountId: string; senderAttendeeId: string; messageId: string; createdAt: string };

// Presentation only for the already allowlisted PURO host. The account/event
// authorization below and at the callers remains independent of this public alias.
// Do not expose a staff login name or guess another event's primary host.
export const firstHostPublicName = `COALESCE((SELECT CASE WHEN COUNT(*)=1 THEN MAX(NULLIF(TRIM(host.name),'')) END
  FROM event_hosts public_link JOIN hosts host ON host.id=public_link.host_id
  WHERE public_link.event_slug=host_assignment.event_slug AND public_link.event_slug='puro-exceso-20261024'
    AND host.id='host:kofi-bills' AND host.slug='kofi-bills' AND host.verification_status='verified'),'Host')`;

// This is display/notification identity, never a new Room admission entitlement.
// A verified attendee address alone is insufficient without a current assignment.
export async function readCurrentRoomHost(db: D1Database, attendeeId: string, eventSlug: string) {
  return db.prepare(`SELECT s.id AS accountId, ${firstHostPublicName} AS displayName
    FROM attendee_profiles p JOIN staff_accounts s ON s.normalized_email=p.normalized_email
    JOIN staff_event_assignments host_assignment ON host_assignment.account_id=s.id AND host_assignment.event_slug=?
    WHERE p.id=? AND p.status='active' AND p.email_verified_at IS NOT NULL
      AND s.status='active' AND s.role='organizer' AND s.must_change_password=0
      AND (s.locked_until IS NULL OR s.locked_until<=?) LIMIT 1`)
    .bind(eventSlug,attendeeId,new Date().toISOString()).first<{accountId:string;displayName:string}>();
}

export const firstHostPreference = `NOT EXISTS (SELECT 1 FROM notification_preferences n
  WHERE n.attendee_id=a.attendee_id AND n.event_slug=t.event_slug AND (n.host_updates=0 OR n.muted_until>?))`;
// New first-post notices remain private after a pass is revoked. Existing notice
// categories retain their established visibility behavior.
export const firstHostInboxVisibility = `EXISTS (SELECT 1 ${hostAudience
  .replace('t.event_slug=?','t.event_slug=notification.event_slug')
  .replace('a.attendee_id<>?',"a.attendee_id<>(SELECT sender_attendee_id FROM room_host_first_posts WHERE message_id=notification.source_id)")
  .replace('b.blocked_attendee_id=?',"b.blocked_attendee_id=(SELECT sender_attendee_id FROM room_host_first_posts WHERE message_id=notification.source_id)")}
  AND a.attendee_id=notification.attendee_id AND ${firstHostPreference}
  AND EXISTS (SELECT 1 FROM room_host_first_posts receipt WHERE receipt.message_id=notification.source_id AND receipt.cancelled_at IS NULL))`;

// Booking contact is notification routing, not mailbox ownership or login proof.
// Only the confirmed RSVP attached to this attendee's current pass may supply an
// unverified address. Transferred passes cannot reuse the original buyer's RSVP.
const emailRecipient = `COALESCE((SELECT NULLIF(TRIM(r.normalized_email),'') FROM event_registrations r
  WHERE r.order_id=o.id AND r.event_slug=t.event_slug AND r.attendee_id=a.attendee_id
    AND r.kind='rsvp' AND r.status='confirmed' AND o.payment_provider='rsvp'
    AND (r.device_claimed_at IS NOT NULL OR r.verified_at IS NOT NULL)
    AND r.normalized_email=o.customer_email LIMIT 1),
  CASE WHEN p.email_verified_at IS NOT NULL THEN p.normalized_email END)`;

// A saved, non-revoked host-update push subscription chooses push over Room
// email. It is not proof that a particular notification reached the device.
// Reused in fanout, delivery eligibility and the atomic dispatch claim.
const emailAllowed = `${emailRecipient} IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM push_subscriptions push WHERE push.attendee_id=a.attendee_id
    AND push.revoked_at IS NULL AND push.host_updates=1)
  AND NOT EXISTS (SELECT 1 FROM marketing_contacts mc WHERE mc.email=${emailRecipient} AND mc.unsubscribed=1)
  AND NOT EXISTS (SELECT 1 FROM event_audience_contacts contact WHERE contact.event_slug=t.event_slug AND contact.email=${emailRecipient}
    AND contact.unsubscribed_at IS NOT NULL AND contact.unsubscribed_at>=COALESCE(contact.consented_at,''))
  AND NOT EXISTS (SELECT 1 FROM delivery_events prior WHERE prior.recipient=${emailRecipient} AND prior.status IN ('bounced','complained'))`;

// D1 batch commits receipt, inbox, push jobs and email jobs together. A retry
// cannot add late passholders, recreate pruned jobs, or send a second campaign.
export async function queueFirstHostPost(env: Cloudflare.Env, post: FirstHostPost): Promise<void> {
  if (env.ROOM_HOST_FIRST_POST_ENABLED !== '1' || env.ROOM_HOST_FIRST_POST_EVENT_SLUG !== post.eventSlug || env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID !== post.hostAccountId) return;
  const host = await readCurrentRoomHost(env.DB,post.senderAttendeeId,post.eventSlug);
  const event = await env.DB.prepare(`SELECT title FROM curated_event_records WHERE slug=? AND removed_at IS NULL
    AND archived_at IS NULL AND status IN ('published','scheduled') AND schedule_status='confirmed'
    AND event_state NOT IN ('cancelled','postponed')`).bind(post.eventSlug).first<{title:string}>();
  if (!event || host?.accountId !== post.hostAccountId || Date.now()-Date.parse(post.createdAt)>=86400000) return;
  const now=new Date().toISOString();
  const payload: NotificationPayload = { eventSlug:post.eventSlug,kind:'host_first_post',title:`Your host is in The Room · ${event.title}`.slice(0,120),
    body:'Your event host has posted a message. Open The Room to join the chat.',
    url:`/room/${encodeURIComponent(post.eventSlug)}?from=host-first-post&message=${encodeURIComponent(post.messageId)}`,
    sourceId:post.messageId,tag:`first-host-${post.messageId.replace(/[^A-Za-z0-9_-]/gu,'').slice(-20)}` };
  const mail=roomHostEmail({eventTitle:event.title,hostName:host.displayName,eventSlug:post.eventSlug,messageId:post.messageId});
  const mailPayload=JSON.stringify({...mail,provider:transactionalProvider(env,'room_host_post'),eventSlug:post.eventSlug,messageId:post.messageId,
    senderAttendeeId:post.senderAttendeeId,hostAccountId:post.hostAccountId});
  const audience=`${hostAudience} AND ${firstHostPreference}
    AND EXISTS (SELECT 1 FROM room_host_first_posts receipt WHERE receipt.event_slug=t.event_slug
      AND receipt.host_account_id=? AND receipt.message_id=? AND receipt.fanout_at IS NULL AND receipt.cancelled_at IS NULL)`;
  const audienceArgs=[post.eventSlug,post.senderAttendeeId,post.senderAttendeeId,now,post.hostAccountId,post.messageId];
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO room_host_first_posts(event_slug,host_account_id,message_id,sender_attendee_id,created_at) VALUES(?,?,?,?,?)`)
      .bind(post.eventSlug,post.hostAccountId,post.messageId,post.senderAttendeeId,post.createdAt),
    env.DB.prepare(`INSERT OR IGNORE INTO attendee_notifications(id,attendee_id,event_slug,kind,title,body,url,source_id,created_at)
      SELECT DISTINCT 'room-first/'||?||'/'||a.attendee_id,a.attendee_id,?,'host_first_post',?,?,?,?,? ${audience}`)
      .bind(post.messageId,post.eventSlug,payload.title,payload.body,payload.url,post.messageId,now,...audienceArgs),
    env.DB.prepare(`INSERT OR IGNORE INTO room_announcement_deliveries(id,attendee_id,event_slug,sender_id,payload_json,next_attempt_at,created_at,updated_at)
      SELECT DISTINCT ?||'/'||a.attendee_id,a.attendee_id,?,?,?,?,?,? ${audience}`)
      .bind(post.messageId,post.eventSlug,post.senderAttendeeId,JSON.stringify(payload),now,now,now,...audienceArgs),
    env.DB.prepare(`INSERT OR IGNORE INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at)
      SELECT DISTINCT 'room-first-email/'||?||'/'||a.attendee_id,'room_host_post',${emailRecipient},'queued',0,
        json_set(?,'$.attendeeId',a.attendee_id,'$.idempotencyKey','room-first-email/'||?||'/'||a.attendee_id),?,?
        ${audience} AND ${emailAllowed}`)
      .bind(post.messageId,mailPayload,post.messageId,now,now,...audienceArgs),
    env.DB.prepare(`UPDATE room_host_first_posts SET fanout_at=? WHERE event_slug=? AND host_account_id=? AND message_id=? AND fanout_at IS NULL`)
      .bind(now,post.eventSlug,post.hostAccountId,post.messageId),
  ]);
  // Scheduled recovery owns queued jobs even if this best-effort wake fails.
  if (env.EMAIL_DELIVERY_QUEUE) {
    try { await env.EMAIL_DELIVERY_QUEUE.send({deliveryId:'host-first-post:tick'}); }
    catch { console.error('First host post saved for scheduled delivery.'); }
  }
}

type HostMailPayload = FirstHostPost & { attendeeId:string; subject:string; html:string; text:string; idempotencyKey:string; provider?:'resend'|'vps' };
export async function deliverFirstHostEmail(env:Cloudflare.Env,id:string):Promise<void> {
  if(env.ROOM_HOST_FIRST_POST_ENABLED!=='1')return;
  if(env.EMAIL_FROM!=='BeCore Tickets <tickets@becoreops.com>')return;
  const item=await env.DB.prepare(`SELECT recipient,payload_json AS payload,created_at AS createdAt FROM delivery_events
    WHERE id=? AND kind='room_host_post' AND status='queued' AND attempt_count=0`).bind(id).first<{recipient:string;payload:string;createdAt:string}>();
  if(!item)return;
  const payload=JSON.parse(item.payload) as HostMailPayload;
  // Legacy jobs remain on Resend even after the configured default changes.
  if(payload.provider!==undefined && payload.provider!=='resend' && payload.provider!=='vps')return;
  const provider=payload.provider??'resend';
  if(!transactionalConfigured(env,provider))return;
  if(env.ROOM_HOST_FIRST_POST_EVENT_SLUG!==payload.eventSlug || env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID!==payload.hostAccountId)return;
  const now=new Date().toISOString();
  const host=await readCurrentRoomHost(env.DB,payload.senderAttendeeId,payload.eventSlug);
  const source=await env.THE_ROOM.getByName(payload.eventSlug).getMessage(payload.messageId);
  const allowed=host?.accountId===payload.hostAccountId && source && !source.deletedAt
    && Date.now()-Date.parse(item.createdAt)<86400000 && await env.DB.prepare(`SELECT 1 ${hostAudience}
      AND a.attendee_id=? AND ${emailRecipient}=? AND ${firstHostPreference} AND ${emailAllowed} LIMIT 1`)
      .bind(payload.eventSlug,payload.senderAttendeeId,payload.senderAttendeeId,payload.attendeeId,item.recipient,now).first();
  if(!allowed){await env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='queued' AND attempt_count=0").bind(now,id).run();return;}
  // No lease takeover: a process crash or timeout after this point is uncertain,
  // never permission to resend. Provider idempotency is an additional safeguard.
  const claimed=await env.DB.prepare(`UPDATE delivery_events SET status='sending',attempt_count=1,next_attempt_at=NULL,updated_at=?
    WHERE id=? AND kind='room_host_post' AND status='queued' AND attempt_count=0
      AND EXISTS (SELECT 1 FROM room_host_first_posts receipt WHERE receipt.message_id=json_extract(delivery_events.payload_json,'$.messageId') AND receipt.cancelled_at IS NULL)
      AND EXISTS (SELECT 1 ${hostAudience} AND a.attendee_id=? AND ${emailRecipient}=? AND ${firstHostPreference} AND ${emailAllowed})
      AND EXISTS (SELECT 1 FROM staff_accounts host JOIN staff_event_assignments assigned ON assigned.account_id=host.id
        JOIN attendee_profiles sender ON sender.normalized_email=host.normalized_email AND sender.status='active' AND sender.email_verified_at IS NOT NULL
        WHERE host.id=? AND sender.id=? AND assigned.event_slug=? AND host.status='active' AND host.role='organizer'
          AND host.must_change_password=0 AND (host.locked_until IS NULL OR host.locked_until<=?))`)
    .bind(now,id,payload.eventSlug,payload.senderAttendeeId,payload.senderAttendeeId,payload.attendeeId,item.recipient,now,
      payload.hostAccountId,payload.senderAttendeeId,payload.eventSlug,now).run();
  if(!claimed.meta.changes)return;
  try {
    const response=await sendTransactional(env,provider,{recipient:item.recipient,kind:'room_host_post',subject:payload.subject,
      html:payload.html,text:payload.text,idempotencyKey:payload.idempotencyKey,replyTo:'tickets@becoreops.com'});
    const result=await response.json().catch(()=>null) as {id?:string}|null;
    if(!response.ok || !validTransactionalId(provider,result?.id))throw new Error('First host email outcome needs review.');
    await env.DB.prepare("UPDATE delivery_events SET status='sent',provider_id=?,failure_reason=NULL,updated_at=? WHERE id=? AND status='sending'")
      .bind(result.id,new Date().toISOString(),id).run();
  } catch {
    await env.DB.prepare("UPDATE delivery_events SET status='uncertain',failure_reason='Delivery outcome needs review; automatic resend is disabled.',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='sending'")
      .bind(new Date().toISOString(),id).run();
  }
}

export async function retryFirstHostEmails(env:Cloudflare.Env):Promise<void> {
  if(env.ROOM_HOST_FIRST_POST_ENABLED!=='1')return;
  await env.DB.prepare("UPDATE delivery_events SET status='uncertain',failure_reason='Delivery interrupted; review provider receipt before any resend.',next_attempt_at=NULL WHERE kind='room_host_post' AND status='sending' AND updated_at<?")
    .bind(new Date(Date.now()-300000).toISOString()).run();
  await env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL WHERE kind='room_host_post' AND status='queued' AND created_at<?")
    .bind(new Date(Date.now()-86400000).toISOString()).run();
  const due=await env.DB.prepare("SELECT id FROM delivery_events WHERE kind='room_host_post' AND status='queued' AND attempt_count=0 ORDER BY created_at LIMIT 50").all<{id:string}>();
  if(env.EMAIL_DELIVERY_QUEUE && due.results.length)await env.EMAIL_DELIVERY_QUEUE.sendBatch(due.results.map(row=>({body:{deliveryId:`host-first-email:${row.id}`}})));
}

// Private, read-only owner diagnostic for the original PURO suppressions and one unresolved recovery attempt.
// Call only after the existing owner/MFA and configured host identity checks.
export async function firstHostDeliveryIssues(env:Cloudflare.Env) {
  if(env.ROOM_HOST_FIRST_POST_ENABLED!=='1' || env.ROOM_HOST_FIRST_POST_EVENT_SLUG!=='puro-exceso-20261024' || !env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID)throw new Error('Unavailable');
  const receipt=await env.DB.prepare(`SELECT message_id AS messageId,sender_attendee_id AS senderId FROM room_host_first_posts
    WHERE event_slug=? AND host_account_id=? AND cancelled_at IS NULL`).bind(env.ROOM_HOST_FIRST_POST_EVENT_SLUG,env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID).first<{messageId:string;senderId:string}>();
  if(!receipt)return [];
  const rows=await env.DB.prepare(`WITH contacts AS (SELECT DISTINCT ${emailRecipient} AS email ${hostAudience}
    AND EXISTS(SELECT 1 FROM attendee_notifications n WHERE n.attendee_id=a.attendee_id AND n.event_slug=t.event_slug AND n.kind='host_first_post' AND n.source_id=?)
    AND NOT EXISTS(SELECT 1 FROM delivery_events sent WHERE sent.kind='room_host_post' AND json_extract(sent.payload_json,'$.messageId')=? AND json_extract(sent.payload_json,'$.attendeeId')=a.attendee_id)),
    failures AS (SELECT d.recipient AS address,d.status,SUBSTR(d.failure_reason,1,500) AS reason,
      COALESCE(d.provider_event_at,d.updated_at) AS timestamp,
      ROW_NUMBER() OVER(PARTITION BY d.recipient ORDER BY COALESCE(d.provider_event_at,d.updated_at) DESC,d.id DESC) AS position
      FROM delivery_events d WHERE d.recipient IN(SELECT email FROM contacts) AND d.status IN('bounced','complained'))
    SELECT address,status,reason,timestamp FROM failures WHERE position=1 ORDER BY address LIMIT 5`)
    .bind(env.ROOM_HOST_FIRST_POST_EVENT_SLUG,receipt.senderId,receipt.senderId,receipt.messageId,receipt.messageId)
    .all<{address:string;status:string;reason:string|null;timestamp:string}>();
  if(rows.results.length>4)throw new Error('Suppressed cohort changed');
  const uncertain=await env.DB.prepare(`SELECT d.recipient AS address,d.status,SUBSTR(d.failure_reason,1,500) AS reason,
      COALESCE(d.provider_event_at,d.updated_at) AS timestamp FROM delivery_events d
    WHERE d.kind='room_host_post' AND d.status='uncertain' AND json_extract(d.payload_json,'$.eventSlug')=?
      AND json_extract(d.payload_json,'$.messageId')=?
      AND EXISTS(SELECT 1 ${hostAudience} AND a.attendee_id=json_extract(d.payload_json,'$.attendeeId') AND ${emailRecipient}=d.recipient
        AND EXISTS(SELECT 1 FROM attendee_notifications n WHERE n.attendee_id=a.attendee_id AND n.event_slug=t.event_slug AND n.kind='host_first_post' AND n.source_id=?))
    ORDER BY d.created_at LIMIT 2`).bind(env.ROOM_HOST_FIRST_POST_EVENT_SLUG,receipt.messageId,env.ROOM_HOST_FIRST_POST_EVENT_SLUG,receipt.senderId,receipt.senderId,receipt.messageId)
    .all<{address:string;status:string;reason:string|null;timestamp:string}>();
  if(uncertain.results.length>1)throw new Error('Uncertain cohort changed');
  return [...rows.results.map(row=>({...row,category:'suppressed' as const})),...uncertain.results.map(row=>({...row,category:'uncertain' as const}))];
}
