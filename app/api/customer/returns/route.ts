import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../lib/admin-session";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(
    env.DB,
    request.headers.get("cookie"),
  );
  if (!identity)
    return Response.json(
      { error: "Verified attendee access required." },
      { status: 401 },
    );
  const rows = await env.DB.prepare(
    "SELECT id, ticket_id AS ticketId, status, waitlist_demand_at_request AS waitlistDemand, requested_at AS requestedAt FROM ticket_return_requests WHERE attendee_id = ? AND status IN ('requested','matched','refund_pending') ORDER BY requested_at DESC",
  )
    .bind(identity.attendeeId)
    .all();
  return Response.json(
    { returns: rows.results },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(
    env.DB,
    request.headers.get("cookie"),
  );
  if (!identity)
    return Response.json(
      { error: "Verified attendee access required." },
      { status: 401 },
    );
  if (!mutationHasValidOrigin(request))
    return Response.json(
      { error: "This return request was not accepted." },
      { status: 403 },
    );
  const body = (await request.json()) as { ticketId?: string };
  const ticket = await env.DB.prepare(
    `SELECT ticket.id, ticket.order_id AS orderId, ticket.event_slug AS eventSlug, orders.ticket_tier_id AS ticketTierId, orders.face_amount_minor AS faceAmountMinor, orders.quantity, orders.currency, event.starts_at AS startsAt FROM ticket_assignments assignment JOIN tickets ticket ON ticket.id = assignment.ticket_id JOIN orders ON orders.id = ticket.order_id JOIN curated_event_records event ON event.slug = ticket.event_slug WHERE ticket.id = ? AND assignment.attendee_id = ? AND assignment.status = 'active' AND ticket.status = 'issued' AND orders.status = 'paid' LIMIT 1`,
  )
    .bind(body.ticketId ?? "", identity.attendeeId)
    .first<{
      id: string;
      orderId: string;
      eventSlug: string;
      ticketTierId: string | null;
      faceAmountMinor: number;
      quantity: number;
      currency: string;
      startsAt: string;
    }>();
  if (!ticket)
    return Response.json(
      { error: "Only your unused, paid ticket can join the return queue." },
      { status: 409 },
    );
  if (new Date(ticket.startsAt).getTime() - Date.now() < 24 * 60 * 60 * 1000)
    return Response.json(
      { error: "Returns close 24 hours before the Night." },
      { status: 409 },
    );
  const transfer = await env.DB.prepare(
    "SELECT id FROM ticket_transfers WHERE ticket_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1",
  )
    .bind(ticket.id, new Date().toISOString())
    .first();
  if (transfer)
    return Response.json(
      { error: "Cancel the pending transfer before requesting a return." },
      { status: 409 },
    );
  const demand = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM event_waitlist_entries WHERE event_slug = ? AND status IN ('waiting','offered') AND (? IS NULL OR ticket_tier_id = ?)",
  )
    .bind(ticket.eventSlug, ticket.ticketTierId, ticket.ticketTierId)
    .first<{ count: number }>();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO ticket_return_requests (id, ticket_id, attendee_id, order_id, event_slug, ticket_tier_id, status, face_value_minor, currency, waitlist_demand_at_request, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?) ON CONFLICT(ticket_id) DO UPDATE SET id = excluded.id, attendee_id = excluded.attendee_id, status = 'requested', waitlist_demand_at_request = excluded.waitlist_demand_at_request, requested_at = excluded.requested_at, cancelled_at = NULL, updated_at = excluded.updated_at WHERE ticket_return_requests.status = 'cancelled'",
    )
      .bind(
        crypto.randomUUID(),
        ticket.id,
        identity.attendeeId,
        ticket.orderId,
        ticket.eventSlug,
        ticket.ticketTierId,
        Math.floor(ticket.faceAmountMinor / Math.max(1, ticket.quantity)),
        ticket.currency,
        demand?.count ?? 0,
        now,
        now,
      )
      .run();
  } catch {
    return Response.json(
      { error: "This ticket is already in the return queue." },
      { status: 409 },
    );
  }
  return Response.json(
    {
      requested: true,
      waitlistDemand: demand?.count ?? 0,
      message:
        "Return requested. Your ticket stays valid until a replacement and refund are confirmed.",
    },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(
    env.DB,
    request.headers.get("cookie"),
  );
  if (!identity)
    return Response.json(
      { error: "Verified attendee access required." },
      { status: 401 },
    );
  if (!mutationHasValidOrigin(request))
    return Response.json(
      { error: "This cancellation was not accepted." },
      { status: 403 },
    );
  const body = (await request.json()) as { ticketId?: string };
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE ticket_return_requests SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE ticket_id = ? AND attendee_id = ? AND status = 'requested'",
  )
    .bind(now, now, body.ticketId ?? "", identity.attendeeId)
    .run();
  if (result.meta.changes !== 1)
    return Response.json(
      { error: "That return can no longer be cancelled here." },
      { status: 409 },
    );
  return Response.json({ cancelled: true });
}
