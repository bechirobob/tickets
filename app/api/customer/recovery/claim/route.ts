import { attendeeCookieHeader, attendeeSessionExpiry, createSecureToken, hashToken } from '../../../../../lib/attendee-auth';
import { mutationHasValidOrigin } from '../../../../../lib/admin-session';
import { accessLanding, customerAccessHeaders, readAccessToken, recoverableTickets } from '../../../../../lib/ticket-recovery';

export function GET(request: Request) { return accessLanding(request, 'recovery'); }

export async function POST(request: Request) {
  const headers = customerAccessHeaders();
  const invalid = () => Response.json({ error: 'That link has expired or already been used. Request a fresh one in My Nights.' }, { status: 400, headers });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This ticket request was not accepted.' }, { status: 403, headers });
  const token = await readAccessToken(request);
  if (!token) return invalid();
  const { env } = await import('cloudflare:workers');
  const now = new Date().toISOString();
  const grant = await env.DB.prepare(`SELECT id, normalized_email AS email FROM attendee_recovery_grants
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`).bind(await hashToken(token), now).first<{ id: string; email: string }>();
  if (!grant) return invalid();
  const existing = await env.DB.prepare('SELECT id,display_name AS name,phone,status FROM attendee_profiles WHERE normalized_email=? AND email_verified_at IS NOT NULL LIMIT 1')
    .bind(grant.email).first<{ id: string; name: string; phone: string | null; status: string }>();
  if (existing?.status === 'suspended') return invalid();
  const tickets = await env.DB.prepare(`SELECT t.id,COALESCE(holder.display_name,o.customer_name) AS name,COALESCE(holder.phone,o.customer_phone) AS phone ${recoverableTickets} ORDER BY t.issued_at DESC,t.id LIMIT 500`)
    .bind(grant.email, grant.email).all<{ id: string; name: string | null; phone: string | null }>();
  if (!tickets.results.length) return invalid();
  const attendeeId = existing?.id ?? `member_${(await hashToken(grant.email)).slice(0, 32)}`;
  const displayName = (existing?.name || tickets.results[0].name || grant.email.split('@')[0]?.replace(/[._-]+/gu, ' ') || 'Guest').slice(0, 50);
  const sessionToken = createSecureToken(), sessionId = crypto.randomUUID();
  const owns = `EXISTS (SELECT 1 FROM attendee_recovery_grants WHERE id = ? AND claimed_session_id = ?)`;
  const [claimed] = await env.DB.batch([
    env.DB.prepare('UPDATE attendee_recovery_grants SET used_at=?,claimed_session_id=? WHERE id=? AND used_at IS NULL AND expires_at>?')
      .bind(now, sessionId, grant.id, now),
    env.DB.prepare(`INSERT INTO attendee_profiles (id,normalized_email,phone,display_name,email_verified_at,status,created_at,updated_at)
      SELECT ?,?,?,?,?,'active',?,? WHERE ${owns} ON CONFLICT(id) DO UPDATE SET email_verified_at=COALESCE(attendee_profiles.email_verified_at,excluded.email_verified_at),updated_at=excluded.updated_at`)
      .bind(attendeeId, grant.email, existing?.phone ?? tickets.results[0].phone, displayName, now, now, now, grant.id, sessionId),
    env.DB.prepare(`UPDATE attendee_sessions SET revoked_at=? WHERE revoked_at IS NULL AND attendee_id IN (SELECT id FROM attendee_profiles WHERE normalized_email=? AND id<>?) AND ${owns}`)
      .bind(now, grant.email, attendeeId, grant.id, sessionId),
    ...tickets.results.map(ticket => env.DB.prepare(`INSERT INTO ticket_assignments (ticket_id,attendee_id,assigned_by,status,assigned_at)
      SELECT ?,?,?,'active',? WHERE ${owns} AND EXISTS (SELECT 1 ${recoverableTickets} AND t.id=?)
      ON CONFLICT(ticket_id) DO UPDATE SET attendee_id=excluded.attendee_id,assigned_by=excluded.assigned_by,status='active',assigned_at=excluded.assigned_at,revoked_at=NULL`)
      .bind(ticket.id, attendeeId, `recovery:${grant.id}`, now, grant.id, sessionId, grant.email, grant.email, ticket.id)),
    env.DB.prepare(`INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at)
      SELECT ?,?,?,?,?,? WHERE ${owns}`)
      .bind(sessionId, attendeeId, await hashToken(sessionToken), attendeeSessionExpiry(), now, now, grant.id, sessionId),
  ]);
  if (claimed.meta.changes !== 1) return invalid();
  return Response.json({ redirectTo: '/my-nights?recovered=1' }, { headers: { ...headers, 'set-cookie': attendeeCookieHeader(sessionToken) } });
}
