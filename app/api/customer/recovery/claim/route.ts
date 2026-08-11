import { attendeeCookieHeader, attendeeSessionExpiry, createSecureToken, hashToken } from "../../../../../lib/attendee-auth";

type RecoveryGrant = { id: string; normalizedEmail: string; expiresAt: string; usedAt: string | null };

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  const origin = new URL(request.url).origin;
  if (token.length < 40 || token.length > 128) return Response.redirect(`${origin}/tickets?recovery=invalid`, 303);
  const { env } = await import("cloudflare:workers");
  const tokenHash = await hashToken(token);
  const grant = await env.DB.prepare(`
    SELECT id, normalized_email AS normalizedEmail, expires_at AS expiresAt, used_at AS usedAt
    FROM attendee_recovery_grants WHERE token_hash = ? LIMIT 1
  `).bind(tokenHash).first<RecoveryGrant>();
  const now = new Date().toISOString();
  if (!grant || grant.usedAt || grant.expiresAt <= now) return Response.redirect(`${origin}/tickets?recovery=invalid`, 303);

  const orders = await env.DB.prepare(`
    SELECT id, customer_name AS customerName, customer_phone AS customerPhone
    FROM orders WHERE customer_email = ? AND status = 'paid'
    ORDER BY paid_at DESC LIMIT 100
  `).bind(grant.normalizedEmail).all<{ id: string; customerName: string | null; customerPhone: string }>();
  const tickets = await env.DB.prepare(`
    SELECT tickets.id
    FROM tickets JOIN orders ON orders.id = tickets.order_id
    WHERE orders.customer_email = ? AND orders.status = 'paid'
      AND tickets.status IN ('issued', 'checked_in', 'voided')
    ORDER BY tickets.issued_at, tickets.id LIMIT 500
  `).bind(grant.normalizedEmail).all<{ id: string }>();
  if (!orders.results.length || !tickets.results.length) return Response.redirect(`${origin}/tickets?recovery=invalid`, 303);

  // Inbox verification is the only point where orders sharing an email may be
  // consolidated into a single member wallet.
  const attendeeId = `member_${(await hashToken(grant.normalizedEmail)).slice(0, 32)}`;
  const displayName = (orders.results[0].customerName?.trim() || grant.normalizedEmail.split("@")[0]?.replace(/[._-]+/gu, " ") || "Guest").slice(0, 50);
  const sessionToken = createSecureToken();
  const sessionId = crypto.randomUUID();
  const sessionHash = await hashToken(sessionToken);
  const [claim] = await env.DB.batch([
    env.DB.prepare("UPDATE attendee_recovery_grants SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
      .bind(now, grant.id, now),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, email_verified_at, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'active', ?, ?
      WHERE EXISTS (SELECT 1 FROM attendee_recovery_grants WHERE id = ? AND used_at = ?)
      ON CONFLICT(id) DO UPDATE SET
        email_verified_at = COALESCE(attendee_profiles.email_verified_at, excluded.email_verified_at),
        updated_at = excluded.updated_at
    `).bind(attendeeId, grant.normalizedEmail, orders.results[0].customerPhone, displayName, now, now, now, grant.id, now),
    env.DB.prepare(`
      UPDATE attendee_sessions SET revoked_at = ?
      WHERE revoked_at IS NULL AND attendee_id IN (
        SELECT id FROM attendee_profiles WHERE normalized_email = ? AND id <> ?
      )
      AND EXISTS (SELECT 1 FROM attendee_recovery_grants WHERE id = ? AND used_at = ?)
    `).bind(now, grant.normalizedEmail, attendeeId, grant.id, now),
    ...tickets.results.map((ticket) => env.DB.prepare(`
      INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
      SELECT ?, ?, ?, 'active', ?
      WHERE EXISTS (SELECT 1 FROM attendee_recovery_grants WHERE id = ? AND used_at = ?)
      ON CONFLICT(ticket_id) DO UPDATE SET attendee_id = excluded.attendee_id,
        assigned_by = excluded.assigned_by, status = 'active', assigned_at = excluded.assigned_at,
        revoked_at = NULL
    `).bind(ticket.id, attendeeId, `recovery:${grant.id}`, now, grant.id, now)),
    env.DB.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM attendee_recovery_grants WHERE id = ? AND used_at = ?)
    `).bind(sessionId, attendeeId, sessionHash, attendeeSessionExpiry(), now, now, grant.id, now),
  ]);
  if (claim.meta.changes !== 1) return Response.redirect(`${origin}/tickets?recovery=invalid`, 303);
  return new Response(null, { status: 303, headers: { location: `${origin}/my-nights?recovered=1`, "set-cookie": attendeeCookieHeader(sessionToken), "cache-control": "no-store" } });
}
