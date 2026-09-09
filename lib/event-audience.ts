import { createSecureToken } from './attendee-auth';
import { sendEmail, retryFailedDeliveries } from './email-delivery';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
export async function rememberEventContact(db: D1Database, input: { eventSlug: string; email: string; guestName: string; source: string; consentedAt?: string | null }) {
  await db.prepare(`INSERT INTO event_audience_contacts (id,event_slug,email,guest_name,source,consented_at,unsubscribe_token,confirmed_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM curated_event_records WHERE slug = ? AND removed_at IS NOT NULL)
    ON CONFLICT(event_slug,email) DO UPDATE SET guest_name = excluded.guest_name,
      consented_at = CASE WHEN excluded.consented_at > COALESCE(event_audience_contacts.consented_at,'') THEN excluded.consented_at ELSE event_audience_contacts.consented_at END`)
    .bind(crypto.randomUUID(),input.eventSlug,input.email.trim().toLowerCase(),input.guestName,input.source,input.consentedAt ?? null,createSecureToken(),new Date().toISOString(),input.eventSlug).run();
}

/** Queue individual deliveries; provider retry and idempotency remain in the shared delivery service. */
export async function processEventAnnouncements(env: Cloudflare.Env, origin: string) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  // A dedicated invocation keeps audience retries out of the operational cron's query budget.
  const retried = await retryFailedDeliveries(env, 8, 'audience');
  if (retried.attempted) return;
  const now = new Date().toISOString(), stale = new Date(Date.now() - 5 * 60000).toISOString();
  const rows = await env.DB.prepare(`SELECT r.campaign_id AS campaignId,r.contact_id AS contactId,c.subject,c.body,c.event_slug AS eventSlug,
      a.email,a.guest_name AS guestName,a.unsubscribe_token AS unsubscribeToken,
      (a.consented_at IS NOT NULL AND a.consented_at > COALESCE(a.unsubscribed_at,'')) AS subscribed,
      e.title,e.removed_at AS removedAt
    FROM event_announcement_recipients r JOIN event_announcement_campaigns c ON c.id=r.campaign_id
    JOIN event_audience_contacts a ON a.id=r.contact_id JOIN curated_event_records e ON e.slug=c.event_slug
    WHERE c.status='queued' AND (r.status='pending' OR (r.status='sending' AND r.claimed_at < ?))
    ORDER BY c.created_at,r.contact_id LIMIT 8`).bind(stale).all<{campaignId:string;contactId:string;subject:string;body:string;eventSlug:string;email:string;guestName:string;unsubscribeToken:string;subscribed:number;title:string;removedAt:string|null}>();
  for (const row of rows.results) {
    const claimed = await env.DB.prepare("UPDATE event_announcement_recipients SET status='sending',claimed_at=? WHERE campaign_id=? AND contact_id=? AND (status='pending' OR (status='sending' AND claimed_at < ?))").bind(now,row.campaignId,row.contactId,stale).run();
    if (!claimed.meta.changes) continue;
    if (!row.subscribed || row.removedAt) {
      await env.DB.prepare("UPDATE event_announcement_recipients SET status='skipped' WHERE campaign_id=? AND contact_id=?").bind(row.campaignId,row.contactId).run(); continue;
    }
    const key = `event-announcement/${row.campaignId}/${row.contactId}`;
    const existing = await env.DB.prepare("SELECT id FROM delivery_events WHERE kind='event_announcement' AND json_extract(payload_json,'$.idempotencyKey')=? LIMIT 1").bind(key).first<{id:string}>();
    if (!existing) {
      const unsubscribe = `${origin}/announcements/unsubscribe?token=${encodeURIComponent(row.unsubscribeToken)}`;
      await sendEmail({ db:env.DB,kind:'event_announcement',deliveryId:key,recipient:row.email,subject:`${row.title} · ${row.subject}`,
        text:`${row.body}\n\n${origin}/event/${row.eventSlug}\n\nYou subscribed to announcements from this event's organiser. Unsubscribe: ${unsubscribe}`,
        html:`<h2>${escape(row.subject)}</h2><p>${escape(row.body).replaceAll('\n','<br />')}</p><p><a href="${origin}/event/${encodeURIComponent(row.eventSlug)}">${escape(row.title)}</a></p><p>You subscribed to announcements from this event's organiser. <a href="${escape(unsubscribe)}">Unsubscribe</a></p>`,idempotencyKey:key });
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    await env.DB.prepare("UPDATE event_announcement_recipients SET status='queued',delivery_id=(SELECT id FROM delivery_events WHERE kind='event_announcement' AND json_extract(payload_json,'$.idempotencyKey')=? LIMIT 1) WHERE campaign_id=? AND contact_id=?").bind(key,row.campaignId,row.contactId).run();
  }
  await env.DB.prepare(`UPDATE event_announcement_campaigns SET status='completed',completed_at=? WHERE status='queued'
    AND NOT EXISTS (SELECT 1 FROM event_announcement_recipients r LEFT JOIN delivery_events d ON d.id=r.delivery_id
      WHERE r.campaign_id=event_announcement_campaigns.id AND r.status <> 'skipped' AND (r.status <> 'queued' OR COALESCE(d.status,'') NOT IN ('sent','delivered','bounced','complained','suppressed')))`).bind(now).run();
}

/** Stable per-booking deliveries make repeated payment/verification callbacks harmless. */
export async function notifyRegistrationHosts(db:D1Database,input:{eventSlug:string;sourceId:string;guestName:string;status:string;guests:number},origin='https://tickets.becoreops.com') {
  const hosts=await db.prepare(`SELECT s.id,s.normalized_email AS email,e.title FROM staff_event_assignments a JOIN staff_accounts s ON s.id=a.account_id JOIN curated_event_records e ON e.slug=a.event_slug LEFT JOIN event_registration_settings r ON r.event_slug=e.slug
    WHERE a.event_slug=? AND s.role='organizer' AND s.status='active' AND e.removed_at IS NULL AND COALESCE(r.notify_host,1)=1`).bind(input.eventSlug).all<{id:string;email:string;title:string}>();
  for(const host of hosts.results){
    const key=`organizer-signup/${input.eventSlug}/${input.sourceId}/${host.id}`,url=`${origin}/organizer/workspace?event=${encodeURIComponent(input.eventSlug)}`;
    const status=({confirmed:'confirmed a free RSVP',requested:'requested your approval',waitlisted:'joined the waitlist',interested:'joined your email list',paid:'completed paid registration'} as Record<string,string>)[input.status]??input.status;
    const text=`${input.guestName} ${status} for ${host.title} (${input.guests} guests).\n\nView guest activity: ${url}\n\nManage signup email alerts in your event's registration settings.`;
    await sendEmail({db,kind:'organizer_signup',deliveryId:key,idempotencyKey:key,recipient:host.email,subject:`New signup · ${host.title}`,text,html:`<p>${escape(text).replaceAll('\n','<br />')}</p><p><a href="${escape(url)}">View guest activity</a></p>`});
  }
}
