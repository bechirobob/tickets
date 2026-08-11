import { createSecureToken, hashToken } from "../../../../lib/attendee-auth";
import { resolveBookingFee } from "../../../../lib/booking-fees";
import { expireReservations } from "../../../../lib/payment-operations";
import { resolveTicketSelection } from "../../../../lib/ticket-selection";
import { findCuratedEvent } from "../../../events";
import { hashToken as hashStaffToken, mutationHasValidOrigin, requestMetadata, recordSecurityEvent } from "../../../../lib/admin-session";
import { enforceRateLimit, verifyTurnstile } from "../../../../lib/security-controls";

const RESERVATION_MINUTES = 15;

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This payment request was not accepted." }, { status: 403 });
  const body = await request.json() as { eventSlug?: string; ticketTierId?: string; quantity?: number; email?: string; phone?: string; network?: string; fullName?: string; turnstileToken?: string };
  const eventSlug = body.eventSlug?.trim() ?? "";
  const event = await findCuratedEvent(eventSlug);
  const selection = event ? resolveTicketSelection(event, body.ticketTierId ?? "general", body.quantity) : null;
  if (!event || !selection) return Response.json({ error: "That ticket tier is unavailable. Refresh the page and choose an available ticket." }, { status: 400 });
  const email = body.email?.trim().toLowerCase() ?? "";
  const phone = body.phone?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || phone.length < 7 || phone.length > 40) return Response.json({ error: "A valid email and phone number are required." }, { status: 400 });

  const { env } = await import("cloudflare:workers");
  const metadata = requestMetadata(request);
  if (!(await enforceRateLimit(env.PAYMENT_RATE_LIMITER, `payment:${await hashStaffToken(email || metadata.ip || "anonymous")}`))) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: email || metadata.ip, path: "/api/payments/initialize", requestId: metadata.requestId });
    return Response.json({ error: "Too many payment attempts. Wait a minute and try again." }, { status: 429 });
  }
  if (!(await verifyTurnstile(request, String(body.turnstileToken ?? ""), "payment_initialize", env))) {
    return Response.json({ error: "Complete the browser security check and try again." }, { status: 400 });
  }
  if (!env.PAYSTACK_SECRET_KEY) return Response.json({ error: "Live Paystack credentials have not been connected yet." }, { status: 503 });
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + RESERVATION_MINUTES * 60 * 1000).toISOString();
  await expireReservations(env.DB, createdAt);

  const feeBasisPoints = await resolveBookingFee(eventSlug);
  const faceAmountMinor = selection.faceAmountMinor;
  const bookingFeeMinor = Math.round(faceAmountMinor * feeBasisPoints / 10000);
  const totalAmountMinor = faceAmountMinor + bookingFeeMinor;
  const id = crypto.randomUUID();
  const reference = `BCT-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
  const origin = new URL(request.url).origin;
  const claimToken = createSecureToken();
  const claimTokenHash = await hashToken(claimToken);

  const [reservation] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO inventory_reservations (
        order_id, event_slug, ticket_tier_id, unit_quantity, admission_count,
        status, expires_at, created_at, updated_at
      )
      SELECT ?, event.slug, tier.id, ?, ?, 'held', ?, ?, ?
      FROM curated_event_records event
      JOIN event_ticket_tiers tier ON tier.event_slug = event.slug
      WHERE event.slug = ? AND tier.id = ? AND tier.code = ?
        AND (event.status = 'published' OR (event.status = 'scheduled' AND event.scheduled_publish_at <= ?))
        AND event.event_state IN ('on_sale', 'rescheduled')
        AND tier.status = 'available'
        AND (COALESCE(tier.sales_open_at, event.sales_open_at) IS NULL OR COALESCE(tier.sales_open_at, event.sales_open_at) <= ?)
        AND (COALESCE(tier.sales_close_at, event.sales_close_at, event.starts_at) > ?)
        AND event.starts_at > ?
        AND (
          SELECT COALESCE(SUM(existing.admission_count), 0)
          FROM inventory_reservations existing
          WHERE existing.ticket_tier_id = tier.id
            AND (existing.status = 'consumed' OR (existing.status = 'held' AND existing.expires_at > ?))
        ) + ? <= tier.capacity_admissions
    `).bind(
      id, selection.unitQuantity, selection.ticketCount, expiresAt, createdAt, createdAt,
      eventSlug, selection.tier.recordId, selection.tier.id, createdAt,
      createdAt, createdAt, createdAt, createdAt, selection.ticketCount,
    ),
    env.DB.prepare(`
      INSERT INTO orders (
        id, reference, event_slug, ticket_type, ticket_tier_id, unit_quantity, quantity,
        face_amount_minor, booking_fee_minor, total_amount_minor, currency,
        customer_email, customer_phone, customer_name, payment_channel, status,
        reservation_expires_at, payment_updated_at, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GHS', ?, ?, ?, ?, 'payment_pending', ?, ?, ?
      FROM inventory_reservations WHERE order_id = ? AND status = 'held'
    `).bind(
      id, reference, eventSlug, selection.tier.id, selection.tier.recordId,
      selection.unitQuantity, selection.ticketCount, faceAmountMinor, bookingFeeMinor,
      totalAmountMinor, email, phone, body.fullName?.trim().slice(0, 120) || null,
      `mobile_money:${body.network ?? "unknown"}`, expiresAt, createdAt, createdAt, id,
    ),
    env.DB.prepare(`
      INSERT INTO order_access_grants (order_id, token_hash, expires_at, created_at)
      SELECT ?, ?, ?, ? FROM orders WHERE id = ?
    `).bind(id, claimTokenHash, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), createdAt, id),
  ]);

  if (reservation.meta.changes !== 1) {
    return Response.json({ error: "Those admissions were just reserved or sold. Refresh the event to see current availability." }, { status: 409 });
  }

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      email,
      amount: totalAmountMinor,
      currency: "GHS",
      reference,
      channels: ["mobile_money"],
      callback_url: `${origin}/payment/return?reference=${encodeURIComponent(reference)}&claim=${encodeURIComponent(claimToken)}`,
      metadata: JSON.stringify({
        orderId: id,
        eventSlug,
        ticketTierId: selection.tier.id,
        ticketTierName: selection.tier.name,
        purchaseQuantity: selection.unitQuantity,
        ticketCount: selection.ticketCount,
        customerName: body.fullName?.trim(),
        phone,
        network: body.network,
        faceAmountMinor,
        bookingFeeMinor,
        reservationExpiresAt: expiresAt,
      }),
    }),
  });
  const result = await response.json() as { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } };
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status = 'failed', failure_reason = ?, payment_updated_at = ? WHERE id = ?")
        .bind(result.message ?? "Paystack could not start the payment.", new Date().toISOString(), id),
      env.DB.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ?")
        .bind(new Date().toISOString(), id),
    ]);
    return Response.json({ error: result.message ?? "Paystack could not start the payment." }, { status: 502 });
  }

  await env.DB.prepare("UPDATE orders SET paystack_reference = ?, payment_updated_at = ? WHERE id = ?")
    .bind(result.data.reference ?? reference, new Date().toISOString(), id).run();
  return Response.json({ authorizationUrl: result.data.authorization_url, reference, reservationExpiresAt: expiresAt });
}
