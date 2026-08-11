import { createSecureToken, hashToken, readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../lib/admin-session";
import { sendTicketTransferEmail } from "../../../../lib/email-delivery";

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  const rows = await env.DB.prepare(`
    SELECT transfer.id, transfer.ticket_id AS ticketId, transfer.recipient_email AS recipientEmail,
           transfer.status, transfer.expires_at AS expiresAt, transfer.created_at AS createdAt,
           ticket.event_slug AS eventSlug
    FROM ticket_transfers transfer JOIN tickets ticket ON ticket.id = transfer.ticket_id
    WHERE transfer.sender_attendee_id = ? ORDER BY transfer.created_at DESC LIMIT 100
  `).bind(identity.attendeeId).all();
  return Response.json({ transfers: rows.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This transfer request was not accepted." }, { status: 403 });
  const body = await request.json() as { ticketId?: string; recipientEmail?: string };
  const ticketId = body.ticketId?.trim() ?? "";
  const recipientEmail = normalizedEmail(body.recipientEmail ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipientEmail) || recipientEmail.length > 254) return Response.json({ error: "Use the recipient’s valid email address." }, { status: 400 });
  if (recipientEmail === identity.normalizedEmail) return Response.json({ error: "That ticket is already yours. Admirably efficient, though." }, { status: 400 });
  const ticket = await env.DB.prepare(`
    SELECT ticket.id, ticket.event_slug AS eventSlug, ticket.ticket_type AS ticketType, ticket.status,
           event.title, event.starts_at AS startsAt, event.venue, event.area
    FROM ticket_assignments assignment
    JOIN tickets ticket ON ticket.id = assignment.ticket_id
    JOIN curated_event_records event ON event.slug = ticket.event_slug
    WHERE assignment.ticket_id = ? AND assignment.attendee_id = ? AND assignment.status = 'active'
      AND ticket.status = 'issued' LIMIT 1
  `).bind(ticketId, identity.attendeeId).first<{ id: string; eventSlug: string; ticketType: string; status: string; title: string; startsAt: string; venue: string; area: string }>();
  if (!ticket) return Response.json({ error: "Only an unused ticket currently in My Nights can be transferred." }, { status: 409 });
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE ticket_transfers SET status = 'expired' WHERE ticket_id = ? AND status = 'pending' AND expires_at <= ?").bind(ticketId, now).run();
  const pending = await env.DB.prepare("SELECT id FROM ticket_transfers WHERE ticket_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1").bind(ticketId, now).first();
  if (pending) return Response.json({ error: "This ticket already has a transfer waiting for an answer." }, { status: 409 });
  const token = createSecureToken();
  const transferId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO ticket_transfers (id, ticket_id, sender_attendee_id, recipient_email, token_hash, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(transferId, ticketId, identity.attendeeId, recipientEmail, await hashToken(token), expiresAt, now).run();
  const claimUrl = `${new URL(request.url).origin}/api/customer/transfers/claim?token=${encodeURIComponent(token)}`;
  const delivery = await sendTicketTransferEmail({
    db: env.DB, transferId, recipientEmail, recipientName: recipientEmail.split("@")[0]?.replace(/[._-]+/gu, " ") || "there",
    senderName: identity.displayName, eventTitle: ticket.title,
    eventDate: new Intl.DateTimeFormat("en-GH", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(ticket.startsAt)),
    venue: `${ticket.venue}, ${ticket.area}`, claimUrl,
  });
  if (!delivery.sent) {
    await env.DB.prepare("UPDATE ticket_transfers SET status = 'cancelled', cancelled_at = ? WHERE id = ?").bind(new Date().toISOString(), transferId).run();
    return Response.json({ error: "The transfer email could not leave. Your ticket stayed exactly where it was." }, { status: 503 });
  }
  return Response.json({ transfer: { id: transferId, ticketId, recipientEmail, status: "pending", expiresAt }, message: "Sent. Their inbox gets the final say." }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This transfer request was not accepted." }, { status: 403 });
  const body = await request.json() as { transferId?: string };
  const result = await env.DB.prepare(`UPDATE ticket_transfers SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND sender_attendee_id = ? AND status = 'pending'`)
    .bind(new Date().toISOString(), body.transferId ?? "", identity.attendeeId).run();
  if (result.meta.changes !== 1) return Response.json({ error: "That transfer is no longer waiting." }, { status: 409 });
  return Response.json({ cancelled: true });
}
