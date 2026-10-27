import { captureYorkewayOwnerPush, enqueueYorkewayOwnerPush } from './yorkeway-owner-push';
import { createSecureToken, hashToken } from './attendee-auth';
import { transactionalProvider } from './transactional-email';
import { customerEmail, emailParagraph } from './customer-email';

export const YORKEWAY_CONSENT = 'Email me early-access updates about Kofi Bills’ events through the end of 2026. I can unsubscribe at any time.';
export const YORKEWAY_CONSENT_VERSION = 'yorkeway-year-end-2026-v1';
export const YORKEWAY_CLOSES_AT = '2027-01-01T00:00:00.000Z';
export const yorkewayEligible = `s.status = 'subscribed' AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email = s.email AND m.unsubscribed = 1) AND NOT EXISTS (SELECT 1 FROM delivery_events d WHERE LOWER(TRIM(d.recipient))=s.email AND (d.status IN ('bounced','complained') OR (d.status='suppressed' AND d.provider_event_at IS NOT NULL)))`;

export function parseYorkewaySignup(value: unknown): { email: string; name: string } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.consent !== true || typeof body.email !== 'string' || typeof body.name !== 'string') return null;
  const email = body.email.trim().toLowerCase(), name = body.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  return { email, name };
}

export function yorkewayWelcomeEmail(withdrawalToken: string) {
  const unsubscribeUrl = `https://tickets.becoreops.com/the-yorke-way/unsubscribe#${withdrawalToken}`;
  const subject = 'The Yorke Way: you’re on the list. Good call.';
  const intro = 'Your year-end plans called. They said Kofi Bills. You’re on The Yorke Way early-access list. Give the group chat something to work with.';
  const detail = 'We’ll email you early-access updates about Kofi Bills’ events through the end of 2026. Sponsored by BeCore Tickets. This is not an event RSVP, ticket or guarantee of entry.';
  return { subject, html: customerEmail({ campaign: 'yorkeway', title: 'You’re on the list. Good call.', preheader: 'Kofi Bills. Year-end plans. You’re in the loop.',
    body: emailParagraph(intro) + emailParagraph(detail),
    action: { label: 'Back to The Yorke Way', url: 'https://tickets.becoreops.com/the-yorke-way' },
    note: 'No extra confirmation needed. Didn’t sign up? Use the unsubscribe link below to stop these updates.' })
      .replace('</body>', `<div style="padding:0 24px 24px;text-align:center;font:13px/20px Arial,sans-serif;color:#301d2c"><a href="${unsubscribeUrl}" style="color:#301d2c;text-decoration:underline">Unsubscribe from The Yorke Way updates</a></div></body>`),
    text: `${intro}\n\n${detail}\n\nNo extra confirmation needed. Didn’t sign up, or changed your mind? Unsubscribe: ${unsubscribeUrl}` };
}

export async function captureYorkewaySignup(db: D1Database, input: { email: string; name: string }): Promise<void> {
  const { env } = await import('cloudflare:workers');
  const now = new Date().toISOString(), id = crypto.randomUUID(), token = createSecureToken();
  const message = yorkewayWelcomeEmail(token);
  const idempotencyKey = `yorkeway-welcome/${id}`;
  const provider = transactionalProvider(env, 'yorkeway_welcome');
  // Consent and the one welcome delivery are committed together. Duplicates and
  // withdrawn/suppressed addresses are never reactivated by an anonymous request.
  await db.batch([
    db.prepare(`INSERT INTO yorkeway_early_access (email,id,guest_name,status,consent_version,consent_text,consented_at,withdrawal_hash)
      SELECT ?,?,?,'subscribed',?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM marketing_contacts WHERE email=? AND unsubscribed=1)
      AND NOT EXISTS (SELECT 1 FROM delivery_events d WHERE LOWER(TRIM(d.recipient))=? AND (d.status IN ('bounced','complained') OR (d.status='suppressed' AND d.provider_event_at IS NOT NULL)))
      ON CONFLICT(email) DO NOTHING`).bind(input.email,id,input.name,YORKEWAY_CONSENT_VERSION,YORKEWAY_CONSENT,now,await hashToken(token),input.email,input.email),
    db.prepare(`INSERT INTO delivery_events (id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at,next_attempt_at)
      SELECT ?,'yorkeway_welcome',email,'failed',0,?,?,?,? FROM yorkeway_early_access WHERE id=?`)
      .bind(idempotencyKey,JSON.stringify({...message,idempotencyKey,provider}),now,now,now,id),
    captureYorkewayOwnerPush(db,id,now),
  ]);
  // A queue outage must not turn a committed signup into an error. The scheduled
  // recovery scans only captured outbox rows; it never creates historical alerts.
  try { await enqueueYorkewayOwnerPush(db,env.EMAIL_DELIVERY_QUEUE,id); } catch { /* Durable retry. */ }
}

export async function withdrawYorkewaySignup(db: D1Database, token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return;
  await db.prepare(`UPDATE yorkeway_early_access SET status='withdrawn',withdrawn_at=? WHERE withdrawal_hash=? AND status='subscribed'`)
    .bind(new Date().toISOString(),await hashToken(token)).run();
}
