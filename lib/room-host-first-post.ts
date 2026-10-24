import { hostAudience, type NotificationPayload } from './notifications';
import { roomHostEmail } from './room-host-email';
import { sendTransactional, transactionalConfigured, validTransactionalId } from './transactional-email';

export type FirstHostPost = { eventSlug: string; hostAccountId: string; senderAttendeeId: string; messageId: string; createdAt: string };

// This is display/notification identity, never a new Room admission entitlement.
// A verified attendee address alone is insufficient without a current assignment.
export async function readCurrentRoomHost(db: D1Database, attendeeId: string, eventSlug: string) {
  return db.prepare(`SELECT s.id AS accountId, s.display_name AS displayName
    FROM attendee_profiles p JOIN staff_accounts s ON s.normalized_email=p.normalized_email
    JOIN staff_event_assignments a ON a.account_id=s.id AND a.event_slug=?
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

const emailAllowed = `p.email_verified_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM marketing_contacts mc WHERE mc.email=p.normalized_email AND mc.unsubscribed=1)
  AND NOT EXISTS (SELECT 1 FROM event_audience_contacts contact WHERE contact.event_slug=t.event_slug AND contact.email=p.normalized_email
    AND contact.unsubscribed_at IS NOT NULL AND contact.unsubscribed_at>=COALESCE(contact.consented_at,''))
  AND NOT EXISTS (SELECT 1 FROM delivery_events prior WHERE prior.recipient=p.normalized_email AND prior.status IN ('bounced','complained'))`;

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
  const mailPayload=JSON.stringify({...mail,provider:'resend',eventSlug:post.eventSlug,messageId:post.messageId,
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
      SELECT DISTINCT 'room-first-email/'||?||'/'||a.attendee_id,'room_host_post',p.normalized_email,'queued',0,
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

type HostMailPayload = FirstHostPost & { attendeeId:string; subject:string; html:string; text:string; idempotencyKey:string; provider:'resend' };
export async function deliverFirstHostEmail(env:Cloudflare.Env,id:string):Promise<void> {
  if(env.ROOM_HOST_FIRST_POST_ENABLED!=='1')return;
  if(env.EMAIL_FROM!=='BeCore Tickets <tickets@becoreops.com>' || !transactionalConfigured(env,'resend'))return;
  const item=await env.DB.prepare(`SELECT recipient,payload_json AS payload,created_at AS createdAt FROM delivery_events
    WHERE id=? AND kind='room_host_post' AND status='queued' AND attempt_count=0`).bind(id).first<{recipient:string;payload:string;createdAt:string}>();
  if(!item)return;
  const payload=JSON.parse(item.payload) as HostMailPayload;
  if(env.ROOM_HOST_FIRST_POST_EVENT_SLUG!==payload.eventSlug || env.ROOM_HOST_FIRST_POST_HOST_ACCOUNT_ID!==payload.hostAccountId)return;
  const now=new Date().toISOString();
  const host=await readCurrentRoomHost(env.DB,payload.senderAttendeeId,payload.eventSlug);
  const source=await env.THE_ROOM.getByName(payload.eventSlug).getMessage(payload.messageId);
  const allowed=host?.accountId===payload.hostAccountId && source && !source.deletedAt
    && Date.now()-Date.parse(item.createdAt)<86400000 && await env.DB.prepare(`SELECT 1 ${hostAudience}
      AND a.attendee_id=? AND p.normalized_email=? AND ${firstHostPreference} AND ${emailAllowed} LIMIT 1`)
      .bind(payload.eventSlug,payload.senderAttendeeId,payload.senderAttendeeId,payload.attendeeId,item.recipient,now).first();
  if(!allowed){await env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL,updated_at=? WHERE id=? AND status='queued' AND attempt_count=0").bind(now,id).run();return;}
  // No lease takeover: a process crash or timeout after this point is uncertain,
  // never permission to resend. Provider idempotency is an additional safeguard.
  const claimed=await env.DB.prepare(`UPDATE delivery_events SET status='sending',attempt_count=1,next_attempt_at=NULL,updated_at=?
    WHERE id=? AND kind='room_host_post' AND status='queued' AND attempt_count=0
      AND EXISTS (SELECT 1 FROM room_host_first_posts receipt WHERE receipt.message_id=json_extract(delivery_events.payload_json,'$.messageId') AND receipt.cancelled_at IS NULL)
      AND EXISTS (SELECT 1 ${hostAudience} AND a.attendee_id=? AND p.normalized_email=? AND ${firstHostPreference} AND ${emailAllowed})
      AND EXISTS (SELECT 1 FROM staff_accounts host JOIN staff_event_assignments assigned ON assigned.account_id=host.id
        JOIN attendee_profiles sender ON sender.normalized_email=host.normalized_email AND sender.status='active' AND sender.email_verified_at IS NOT NULL
        WHERE host.id=? AND sender.id=? AND assigned.event_slug=? AND host.status='active' AND host.role='organizer'
          AND host.must_change_password=0 AND (host.locked_until IS NULL OR host.locked_until<=?))`)
    .bind(now,id,payload.eventSlug,payload.senderAttendeeId,payload.senderAttendeeId,payload.attendeeId,item.recipient,now,
      payload.hostAccountId,payload.senderAttendeeId,payload.eventSlug,now).run();
  if(!claimed.meta.changes)return;
  try {
    const response=await sendTransactional(env,'resend',{recipient:item.recipient,kind:'room_host_post',subject:payload.subject,
      html:payload.html,text:payload.text,idempotencyKey:payload.idempotencyKey,replyTo:'tickets@becoreops.com'});
    const result=await response.json().catch(()=>null) as {id?:string}|null;
    if(!response.ok || !validTransactionalId('resend',result?.id))throw new Error('First host email outcome needs review.');
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
