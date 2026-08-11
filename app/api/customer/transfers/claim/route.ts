import { attendeeCookieHeader, attendeeSessionExpiry, createSecureToken, hashToken } from "../../../../../lib/attendee-auth";
import { createGateToken, hashGateToken } from "../../../../../lib/gate-pass";
import { notifyAttendee } from "../../../../../lib/notifications";

type Transfer = { id: string; ticketId: string; senderAttendeeId: string; senderName: string; recipientEmail: string; status: string; expiresAt: string; eventSlug: string; eventTitle: string };

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (token.length < 40 || token.length > 128) return Response.redirect(`${origin}/my-nights?transfer=invalid`, 303);
  const { env } = await import("cloudflare:workers");
  const transfer = await env.DB.prepare(`
    SELECT transfer.id, transfer.ticket_id AS ticketId, transfer.sender_attendee_id AS senderAttendeeId,
           sender.display_name AS senderName, transfer.recipient_email AS recipientEmail,
           transfer.status, transfer.expires_at AS expiresAt, ticket.event_slug AS eventSlug,
           event.title AS eventTitle
    FROM ticket_transfers transfer
    JOIN attendee_profiles sender ON sender.id = transfer.sender_attendee_id
    JOIN tickets ticket ON ticket.id = transfer.ticket_id
    JOIN curated_event_records event ON event.slug = ticket.event_slug
    WHERE transfer.token_hash = ? LIMIT 1
  `).bind(await hashToken(token)).first<Transfer>();
  const now = new Date().toISOString();
  if (!transfer || transfer.status !== "pending" || transfer.expiresAt <= now) {
    if (transfer?.status === "pending") await env.DB.prepare("UPDATE ticket_transfers SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(transfer.id).run();
    return Response.redirect(`${origin}/my-nights?transfer=invalid`, 303);
  }
  const existing = await env.DB.prepare(`SELECT id, display_name AS displayName, phone FROM attendee_profiles WHERE normalized_email = ? AND email_verified_at IS NOT NULL LIMIT 1`)
    .bind(transfer.recipientEmail).first<{ id: string; displayName: string; phone: string | null }>();
  const attendeeId = existing?.id ?? `member_${(await hashToken(transfer.recipientEmail)).slice(0, 32)}`;
  const displayName = (existing?.displayName || transfer.recipientEmail.split("@")[0]?.replace(/[._-]+/gu, " ") || "Guest").slice(0, 50);
  const sessionToken = createSecureToken();
  const sessionId = crypto.randomUUID();
  const freshGateToken = createGateToken();
  const acceptedAt = new Date().toISOString();
  const statements = [
    env.DB.prepare(`UPDATE ticket_transfers SET status = 'accepted', accepted_at = ?, recipient_attendee_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`).bind(acceptedAt, attendeeId, transfer.id, acceptedAt),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, email_verified_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET email_verified_at = COALESCE(attendee_profiles.email_verified_at, excluded.email_verified_at), updated_at = excluded.updated_at
    `).bind(attendeeId, transfer.recipientEmail, existing?.phone ?? null, displayName, acceptedAt, acceptedAt, acceptedAt),
    env.DB.prepare(`UPDATE ticket_assignments SET attendee_id = ?, assigned_by = ?, status = 'active', assigned_at = ?, revoked_at = NULL WHERE ticket_id = ? AND attendee_id = ? AND status = 'active'`)
      .bind(attendeeId, `transfer:${transfer.id}`, acceptedAt, transfer.ticketId, transfer.senderAttendeeId),
    env.DB.prepare(`UPDATE tickets SET qr_token_hash = ? WHERE id = ? AND status = 'issued'`).bind(await hashGateToken(freshGateToken), transfer.ticketId),
    env.DB.prepare(`
      INSERT INTO ticket_gate_credentials (ticket_id, token, issued_at, rotated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(ticket_id) DO UPDATE SET token = excluded.token, rotated_at = excluded.rotated_at
    `).bind(transfer.ticketId, freshGateToken, acceptedAt, acceptedAt),
    env.DB.prepare(`INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(sessionId, attendeeId, await hashToken(sessionToken), attendeeSessionExpiry(), acceptedAt, acceptedAt),
  ];
  const [accepted, , assigned] = await env.DB.batch(statements);
  if (accepted.meta.changes !== 1 || assigned.meta.changes !== 1) return Response.redirect(`${origin}/my-nights?transfer=invalid`, 303);
  await notifyAttendee(env, transfer.senderAttendeeId, {
    eventSlug: transfer.eventSlug, kind: "ticket_transfer", title: "Ticket transfer accepted",
    body: `${displayName} accepted the ticket for ${transfer.eventTitle}. Your old QR is now retired.`,
    url: `/my-nights/${encodeURIComponent(transfer.eventSlug)}?view=passes`, sourceId: transfer.id, tag: `transfer-${transfer.id.slice(0, 20)}`,
  });
  return new Response(null, { status: 303, headers: { location: `${origin}/my-nights/${encodeURIComponent(transfer.eventSlug)}?transfer=accepted&view=passes`, "set-cookie": attendeeCookieHeader(sessionToken), "cache-control": "no-store" } });
}
