import { attendeeCookieHeader, attendeeSessionExpiry, createSecureToken, hashToken } from '../../../../../lib/attendee-auth';
import { createGateToken, hashGateToken } from '../../../../../lib/gate-pass';
import { mutationHasValidOrigin } from '../../../../../lib/admin-session';
import { notifyAttendee } from '../../../../../lib/notifications';
import { accessLanding, customerAccessHeaders, readAccessToken } from '../../../../../lib/ticket-recovery';

type Transfer = { id: string; ticketId: string; senderAttendeeId: string; recipientEmail: string; eventSlug: string; eventTitle: string };
export function GET(request: Request) { return accessLanding(request, 'transfer'); }

export async function POST(request: Request) {
  const headers = customerAccessHeaders();
  const invalid = () => Response.json({ error: 'That ticket is no longer waiting here. Check My Nights or ask the sender for a fresh link.' }, { status: 409, headers });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This ticket request was not accepted.' }, { status: 403, headers });
  const token = await readAccessToken(request);
  if (!token) return invalid();
  const { env } = await import('cloudflare:workers');
  const now = new Date().toISOString();
  const transfer = await env.DB.prepare(`SELECT transfer.id,transfer.ticket_id AS ticketId,transfer.sender_attendee_id AS senderAttendeeId,
    transfer.recipient_email AS recipientEmail,ticket.event_slug AS eventSlug,event.title AS eventTitle
    FROM ticket_transfers transfer JOIN tickets ticket ON ticket.id=transfer.ticket_id JOIN curated_event_records event ON event.slug=ticket.event_slug
    WHERE transfer.token_hash=? AND transfer.status='pending' AND transfer.expires_at>?`).bind(await hashToken(token), now).first<Transfer>();
  if (!transfer) return invalid();
  const existing = await env.DB.prepare('SELECT id,display_name AS displayName,phone,status FROM attendee_profiles WHERE normalized_email=? AND email_verified_at IS NOT NULL LIMIT 1')
    .bind(transfer.recipientEmail).first<{ id: string; displayName: string; phone: string | null; status: string }>();
  if (existing?.status === 'suspended') return invalid();
  const attendeeId = existing?.id ?? `member_${(await hashToken(transfer.recipientEmail)).slice(0, 32)}`;
  const displayName = (existing?.displayName || transfer.recipientEmail.split('@')[0]?.replace(/[._-]+/gu, ' ') || 'Guest').slice(0, 50);
  const sessionToken = createSecureToken(), sessionId = crypto.randomUUID(), freshGateToken = createGateToken();
  const owns = `EXISTS (SELECT 1 FROM ticket_transfers WHERE id=? AND claimed_session_id=?)`;
  const [accepted] = await env.DB.batch([
    env.DB.prepare(`UPDATE ticket_transfers SET status='accepted',accepted_at=?,recipient_attendee_id=?,claimed_session_id=?
      WHERE id=? AND status='pending' AND expires_at>?
      AND EXISTS (SELECT 1 FROM tickets t JOIN ticket_assignments a ON a.ticket_id=t.id JOIN orders o ON o.id=t.order_id JOIN curated_event_records e ON e.slug=t.event_slug
        WHERE t.id=ticket_transfers.ticket_id AND t.status='issued' AND a.attendee_id=ticket_transfers.sender_attendee_id AND a.status='active'
          AND o.status='paid' AND o.payment_provider<>'rsvp' AND e.removed_at IS NULL AND e.event_state NOT IN ('cancelled','postponed') AND e.ends_at>?)
      AND NOT EXISTS (SELECT 1 FROM attendee_profiles WHERE normalized_email=ticket_transfers.recipient_email AND email_verified_at IS NOT NULL AND status='suspended')`)
      .bind(now, attendeeId, sessionId, transfer.id, now, now),
    env.DB.prepare(`INSERT INTO attendee_profiles (id,normalized_email,phone,display_name,email_verified_at,status,created_at,updated_at)
      SELECT ?,?,?,?,?,'active',?,? WHERE ${owns} ON CONFLICT(id) DO UPDATE SET email_verified_at=COALESCE(attendee_profiles.email_verified_at,excluded.email_verified_at),updated_at=excluded.updated_at`)
      .bind(attendeeId, transfer.recipientEmail, existing?.phone ?? null, displayName, now, now, now, transfer.id, sessionId),
    env.DB.prepare(`UPDATE ticket_assignments SET attendee_id=?,assigned_by=?,status='active',assigned_at=?,revoked_at=NULL WHERE ticket_id=? AND ${owns}`)
      .bind(attendeeId, `transfer:${transfer.id}`, now, transfer.ticketId, transfer.id, sessionId),
    env.DB.prepare(`UPDATE tickets SET qr_token_hash=? WHERE id=? AND ${owns}`).bind(await hashGateToken(freshGateToken), transfer.ticketId, transfer.id, sessionId),
    env.DB.prepare(`INSERT INTO ticket_gate_credentials (ticket_id,token,issued_at,rotated_at) SELECT ?,?,?,? WHERE ${owns}
      ON CONFLICT(ticket_id) DO UPDATE SET token=excluded.token,rotated_at=excluded.rotated_at`).bind(transfer.ticketId, freshGateToken, now, now, transfer.id, sessionId),
    env.DB.prepare(`INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at) SELECT ?,?,?,?,?,? WHERE ${owns}`)
      .bind(sessionId, attendeeId, await hashToken(sessionToken), attendeeSessionExpiry(), now, now, transfer.id, sessionId),
  ]);
  if (accepted.meta.changes !== 1) return invalid();
  await env.THE_ROOM.getByName(transfer.eventSlug).refreshAdmissionAccess().catch(() => undefined);
  await notifyAttendee(env, transfer.senderAttendeeId, {
    eventSlug: transfer.eventSlug, kind: 'ticket_transfer', title: 'Ticket transfer accepted',
    body: `${displayName} accepted the ticket for ${transfer.eventTitle}. Your old QR is now retired.`,
    url: `/my-nights/${encodeURIComponent(transfer.eventSlug)}?view=passes`, sourceId: transfer.id, tag: `transfer-${transfer.id.slice(0, 20)}`,
  }).catch(() => console.error('Ticket transfer completed; its notification needs retry.'));
  return Response.json({ redirectTo: `/my-nights/${encodeURIComponent(transfer.eventSlug)}?transfer=accepted&view=passes` }, { headers: { ...headers, 'set-cookie': attendeeCookieHeader(sessionToken) } });
}
