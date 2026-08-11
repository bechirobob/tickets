import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { createGateToken, formatGateCode, gateQrPayload, hashGateToken } from "../../../../lib/gate-pass";

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
  eventTitle: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventVenue: string | null;
  eventArea: string | null;
  eventState: string | null;
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
           o.total_amount_minor AS totalAmountMinor, o.currency, o.quantity, o.paid_at AS paidAt,
           event.title AS eventTitle, event.starts_at AS eventStartsAt,
           event.ends_at AS eventEndsAt, event.venue AS eventVenue, event.area AS eventArea,
           event.event_state AS eventState
    FROM ticket_assignments a
    JOIN tickets t ON t.id = a.ticket_id
    JOIN orders o ON o.id = t.order_id
    LEFT JOIN curated_event_records event ON event.slug = t.event_slug
    WHERE a.attendee_id = ? AND a.status = 'active' AND o.status = 'paid'
      AND t.status IN ('issued', 'checked_in', 'voided')
    ORDER BY o.paid_at DESC, t.issued_at, t.id
    LIMIT 100
  `).bind(identity.attendeeId).all<TicketRow>();

  const refreshable = rows.results.filter((ticket) => ticket.ticketStatus === "issued" && ["on_sale", "rescheduled"].includes(ticket.eventState ?? "on_sale")).map((ticket) => ({
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
    paidAt: string | null; event: { title: string; date: string; venue: string; state: string } | null; tickets: Array<Record<string, unknown>>;
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
      event: ticket.eventTitle && ticket.eventStartsAt && ticket.eventEndsAt ? {
        title: ticket.eventTitle,
        date: `${new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Africa/Accra" }).format(new Date(ticket.eventStartsAt))} · ${new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(ticket.eventStartsAt))} — ${new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(ticket.eventEndsAt))}`,
        venue: `${ticket.eventVenue}, ${ticket.eventArea}`,
        state: ticket.eventState ?? "on_sale",
      } : null,
      tickets: [],
    };
    const token = activeCodes.get(ticket.ticketId);
    order.tickets.push({
      id: ticket.ticketId,
      ticketType: ticket.ticketType,
      status: token ? "issued" : ["cancelled", "postponed"].includes(ticket.eventState ?? "") ? "unavailable" : ticket.ticketStatus,
      checkedInAt: ticket.checkedInAt,
      gateCode: token ? formatGateCode(token) : null,
      qrPayload: token ? gateQrPayload(token) : null,
    });
    orderMap.set(ticket.orderId, order);
  }

  return Response.json(
    { attendee: identity, orders: [...orderMap.values()] },
    { headers: { "cache-control": "no-store, private" } },
  );
}
