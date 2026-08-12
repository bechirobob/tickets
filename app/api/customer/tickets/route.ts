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
  customerName: string | null;
  customerEmail: string;
  eventTitle: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventVenue: string | null;
  eventArea: string | null;
  eventState: string | null;
  tierName: string | null;
  tierDescription: string | null;
  roomBadge: "VIP" | null;
  gateToken: string | null;
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
           o.customer_name AS customerName, o.customer_email AS customerEmail,
           event.title AS eventTitle, event.starts_at AS eventStartsAt,
           event.ends_at AS eventEndsAt, event.venue AS eventVenue, event.area AS eventArea,
           event.event_state AS eventState,
           tier.name AS tierName, tier.description AS tierDescription, tier.room_badge AS roomBadge,
           credential.token AS gateToken
    FROM ticket_assignments a
    JOIN tickets t ON t.id = a.ticket_id
    JOIN orders o ON o.id = t.order_id
    LEFT JOIN curated_event_records event ON event.slug = t.event_slug
    LEFT JOIN event_ticket_tiers tier ON tier.id = o.ticket_tier_id
    LEFT JOIN ticket_gate_credentials credential ON credential.ticket_id = t.id
    WHERE a.attendee_id = ? AND a.status = 'active'
      AND o.status IN ('paid', 'refund_pending', 'refunded', 'requires_refund', 'disputed')
      AND t.status IN ('issued', 'checked_in', 'voided', 'refunded')
    ORDER BY o.paid_at DESC, t.issued_at, t.id
    LIMIT 100
  `).bind(identity.attendeeId).all<TicketRow>();

  const activeCodes = new Map<string, string>();
  const eligible = rows.results.filter((ticket) => ticket.ticketStatus === "issued" && ["on_sale", "rescheduled"].includes(ticket.eventState ?? "on_sale"));
  for (const ticket of eligible) {
    if (ticket.gateToken) { activeCodes.set(ticket.ticketId, ticket.gateToken); continue; }
    const token = createGateToken();
    const now = new Date().toISOString();
    const [updated, inserted] = await env.DB.batch([
      env.DB.prepare("UPDATE tickets SET qr_token_hash = ? WHERE id = ? AND status = 'issued'").bind(await hashGateToken(token), ticket.ticketId),
      env.DB.prepare("INSERT OR IGNORE INTO ticket_gate_credentials (ticket_id, token, issued_at) VALUES (?, ?, ?)").bind(ticket.ticketId, token, now),
    ]);
    if (updated.meta.changes === 1 && inserted.meta.changes === 1) activeCodes.set(ticket.ticketId, token);
  }

  const orderMap = new Map<string, {
    orderId: string; reference: string; eventSlug: string; faceAmountMinor: number;
    bookingFeeMinor: number; totalAmountMinor: number; currency: string; quantity: number;
    paidAt: string | null; event: { title: string; date: string; venue: string; state: string } | null; tickets: Array<Record<string, unknown>>;
    bookedFor: string | null; canViewPurchase: boolean;
    tierName: string | null; tierDescription: string | null; roomBadge: "VIP" | null;
  }>();
  for (const ticket of rows.results) {
    const canViewPurchase = ticket.customerEmail === identity.normalizedEmail;
    const order = orderMap.get(ticket.orderId) ?? {
      orderId: ticket.orderId,
      reference: canViewPurchase ? ticket.reference : "Transferred ticket",
      eventSlug: ticket.eventSlug,
      faceAmountMinor: canViewPurchase ? ticket.faceAmountMinor : 0,
      bookingFeeMinor: canViewPurchase ? ticket.bookingFeeMinor : 0,
      totalAmountMinor: canViewPurchase ? ticket.totalAmountMinor : 0,
      currency: ticket.currency,
      quantity: ticket.quantity,
      paidAt: ticket.paidAt,
      bookedFor: ticket.customerName,
      canViewPurchase,
      tierName: ticket.tierName,
      tierDescription: ticket.tierDescription,
      roomBadge: ticket.roomBadge === "VIP" ? "VIP" : null,
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
