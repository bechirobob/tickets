import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { createGateToken, formatGateCode, gateQrPayload, hashGateToken } from "../../../../lib/gate-pass";
import { findCuratedEvent } from "../../../events";

type TicketRow = {
  ticketId: string;
  orderId: string;
  reference: string;
  eventSlug: string;
  ticketType: string;
  ticketStatus: string;
  checkedInAt: string | null;
  faceAmountMinor: number;
  bookingFeeMinor: number;
  totalAmountMinor: number;
  currency: string;
  quantity: number;
  paidAt: string | null;
};

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) {
    return Response.json({ error: "Verified attendee access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const rows = await env.DB.prepare(`
    SELECT t.id AS ticketId, t.order_id AS orderId, o.reference, t.event_slug AS eventSlug,
           t.ticket_type AS ticketType, t.status AS ticketStatus, t.checked_in_at AS checkedInAt,
           o.face_amount_minor AS faceAmountMinor, o.booking_fee_minor AS bookingFeeMinor,
           o.total_amount_minor AS totalAmountMinor, o.currency, o.quantity, o.paid_at AS paidAt
    FROM ticket_assignments a
    JOIN tickets t ON t.id = a.ticket_id
    JOIN orders o ON o.id = t.order_id
    WHERE a.attendee_id = ? AND a.status = 'active' AND o.status = 'paid'
      AND t.status IN ('issued', 'checked_in')
    ORDER BY o.paid_at DESC, t.issued_at, t.id
    LIMIT 100
  `).bind(identity.attendeeId).all<TicketRow>();

  const refreshable = rows.results.filter((ticket) => ticket.ticketStatus === "issued").map((ticket) => ({
    ticket,
    token: createGateToken(),
  }));
  const resolvedUpdates = await Promise.all(refreshable.map(async ({ ticket, token }) => env.DB.prepare(`
    UPDATE tickets SET qr_token_hash = ?
    WHERE id = ? AND status = 'issued'
  `).bind(await hashGateToken(token), ticket.ticketId)));
  const results = resolvedUpdates.length ? await env.DB.batch(resolvedUpdates) : [];
  const activeCodes = new Map<string, string>();
  refreshable.forEach(({ ticket, token }, index) => {
    if (results[index]?.meta.changes === 1) activeCodes.set(ticket.ticketId, token);
  });

  const orderMap = new Map<string, {
    orderId: string; reference: string; eventSlug: string; faceAmountMinor: number;
    bookingFeeMinor: number; totalAmountMinor: number; currency: string; quantity: number;
    paidAt: string | null; tickets: Array<Record<string, unknown>>;
  }>();
  for (const ticket of rows.results) {
    const order = orderMap.get(ticket.orderId) ?? {
      orderId: ticket.orderId,
      reference: ticket.reference,
      eventSlug: ticket.eventSlug,
      faceAmountMinor: ticket.faceAmountMinor,
      bookingFeeMinor: ticket.bookingFeeMinor,
      totalAmountMinor: ticket.totalAmountMinor,
      currency: ticket.currency,
      quantity: ticket.quantity,
      paidAt: ticket.paidAt,
      tickets: [],
    };
    const token = activeCodes.get(ticket.ticketId);
    order.tickets.push({
      id: ticket.ticketId,
      ticketType: ticket.ticketType,
      status: token ? "issued" : ticket.ticketStatus,
      checkedInAt: ticket.checkedInAt,
      gateCode: token ? formatGateCode(token) : null,
      qrPayload: token ? gateQrPayload(token) : null,
    });
    orderMap.set(ticket.orderId, order);
  }

  const preparedOrders = await Promise.all([...orderMap.values()].map(async (order) => {
    const event = await findCuratedEvent(order.eventSlug);
    return {
      ...order,
      event: event ? { title: event.title, date: `${event.fullDate} · ${event.time}`, venue: `${event.venue}, ${event.area}` } : null,
    };
  }));

  return Response.json(
    { attendee: identity, orders: preparedOrders },
    { headers: { "cache-control": "no-store, private" } },
  );
}
