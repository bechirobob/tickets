import { createSecureToken, hashToken } from './attendee-auth';
import { sendEmail } from './email-delivery';
import { customerEmail, emailParagraph } from './customer-email';

export const YORKEWAY_CONSENT = 'Email me early-access updates about Kofi Bills’ events through the end of 2026. I can unsubscribe at any time.';
export const YORKEWAY_CONSENT_VERSION = 'yorkeway-year-end-2026-v1';
export const YORKEWAY_CLOSES_AT = '2027-01-01T00:00:00.000Z';
export const yorkewayEligible = `s.status = 'subscribed' AND s.verified_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email = s.email AND m.unsubscribed = 1) AND NOT EXISTS (SELECT 1 FROM delivery_events d WHERE LOWER(TRIM(d.recipient))=s.email AND (d.status IN ('bounced','complained') OR (d.status='suppressed' AND d.provider_event_at IS NOT NULL)))`;

export function parseYorkewaySignup(value: unknown): { email: string; name: string } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.consent !== true || typeof body.email !== 'string' || typeof body.name !== 'string') return null;
  const email = body.email.trim().toLowerCase(), name = body.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null;
  return { email, name };
}

export function yorkewayConfirmationEmail(token: string, withdrawalToken: string) {
  const confirmUrl = `https://tickets.becoreops.com/the-yorke-way/confirm#${token}`;
  const unsubscribeUrl = `https://tickets.becoreops.com/the-yorke-way/unsubscribe#${withdrawalToken}`;
  const subject = 'Confirm your early access to The Yorke Way';
  const intro = 'End the year with Kofi Bills. Confirm your email to join The Yorke Way early-access list, sponsored by BeCore Tickets.';
  const detail = 'You’ll receive early-access email updates about Kofi Bills’ events through the end of 2026. This is not an event RSVP, ticket or guarantee of entry.';
  return { subject, html: customerEmail({ title: 'Your next invite starts here.', preheader: 'Confirm your email for The Yorke Way early-access list.',
    body: emailParagraph(intro) + emailParagraph(detail) + emailParagraph(`Changed your mind? <a href="${unsubscribeUrl}" style="color:#301d2c;text-decoration:underline">Withdraw this signup or unsubscribe</a>.`),
    action: { label: 'Confirm my email', url: confirmUrl }, note: 'This confirmation link is valid for up to 24 hours. If you did not request it, ignore this email. You will not join the list without confirming.' }),
    text: `${intro}\n\n${detail}\n\nConfirm your email: ${confirmUrl}\n\nWithdraw or unsubscribe: ${unsubscribeUrl}\n\nThe confirmation link is valid for up to 24 hours. If you did not request it, ignore this email. You will not join the list without confirming.` };
}

export async function captureYorkewaySignup(db: D1Database, input: { email: string; name: string }): Promise<void> {
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const token = createSecureToken(), withdrawalToken = createSecureToken();
  const expires = new Date(Math.min(Date.now() + 86400000, Date.parse(YORKEWAY_CLOSES_AT))).toISOString();
  const [, created] = await db.batch([
    db.prepare(`INSERT INTO yorkeway_early_access (email, guest_name, consent_version, consent_text, consented_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`).bind(input.email, input.name, YORKEWAY_CONSENT_VERSION, YORKEWAY_CONSENT, now),
    db.prepare(`INSERT INTO yorkeway_signup_grants (id,email,guest_name,subscription_revision,token_hash,withdrawal_hash,created_at,expires_at)
      SELECT ?,email,?,revision,?,?,?,? FROM yorkeway_early_access s WHERE email = ? AND status <> 'subscribed'
      AND NOT EXISTS (SELECT 1 FROM yorkeway_signup_grants g WHERE g.email = s.email AND g.created_at > ?)
      AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email = s.email AND m.unsubscribed = 1) AND NOT EXISTS (SELECT 1 FROM delivery_events d WHERE LOWER(TRIM(d.recipient))=s.email AND (d.status IN ('bounced','complained') OR (d.status='suppressed' AND d.provider_event_at IS NOT NULL)))`)
      .bind(id, input.name, await hashToken(token), await hashToken(withdrawalToken), now, expires, input.email, new Date(Date.now() - 15 * 60000).toISOString()),
  ]);
  if (created.meta.changes !== 1) return;
  const message = yorkewayConfirmationEmail(token, withdrawalToken);
  await sendEmail({ db, kind: 'yorkeway_confirmation', recipient: input.email, ...message, idempotencyKey: `yorkeway-confirmation/${id}`, deliveryId: `yorkeway-confirmation/${id}` });
}

export async function confirmYorkewaySignup(db: D1Database, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token) || Date.now() >= Date.parse(YORKEWAY_CLOSES_AT)) return false;
  const digest = await hashToken(token), now = new Date().toISOString();
  const [updated] = await db.batch([
    db.prepare(`UPDATE yorkeway_early_access SET status='subscribed', revision=revision+1, verified_at=?, consented_at=?, withdrawn_at=NULL,
      guest_name=(SELECT guest_name FROM yorkeway_signup_grants WHERE token_hash=?), confirmed_grant=(SELECT id FROM yorkeway_signup_grants WHERE token_hash=?)
      WHERE status <> 'subscribed' AND EXISTS (SELECT 1 FROM yorkeway_signup_grants g WHERE g.email=yorkeway_early_access.email
        AND g.subscription_revision=yorkeway_early_access.revision AND g.token_hash=? AND g.consumed_at IS NULL AND g.expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM marketing_contacts m WHERE m.email=yorkeway_early_access.email AND m.unsubscribed=1) AND NOT EXISTS (SELECT 1 FROM delivery_events d WHERE LOWER(TRIM(d.recipient))=yorkeway_early_access.email AND (d.status IN ('bounced','complained') OR (d.status='suppressed' AND d.provider_event_at IS NOT NULL)))`)
      .bind(now, now, digest, digest, digest, now),
    db.prepare(`UPDATE yorkeway_signup_grants SET consumed_at=? WHERE changes()=1 AND token_hash=? AND consumed_at IS NULL`).bind(now,digest),
  ]);
  return updated.meta.changes === 1;
}

export async function withdrawYorkewaySignup(db: D1Database, token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return;
  await db.prepare(`UPDATE yorkeway_early_access SET status='withdrawn', revision=revision+1, withdrawn_at=? WHERE EXISTS (SELECT 1 FROM yorkeway_signup_grants g WHERE g.email=yorkeway_early_access.email AND g.withdrawal_hash=?
      AND (g.subscription_revision=yorkeway_early_access.revision OR (yorkeway_early_access.status='subscribed' AND g.subscription_revision=yorkeway_early_access.revision-1)))`)
    .bind(new Date().toISOString(), await hashToken(token)).run();
}
