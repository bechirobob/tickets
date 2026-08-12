import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { issueRecoveryGrant } from "../../../../lib/email-delivery";
import { deliverConfirmedOrder, expireReservations, initiatePaystackRefund, runDailyReconciliation, verifyAndFulfill } from "../../../../lib/payment-operations";
import { buildDisputeEvidence, resolvePaystackDispute } from "../../../../lib/operational-finance";

export const dynamic = "force-dynamic";

async function orderForDelivery(db: D1Database, orderId: string) {
  return db.prepare(`
    SELECT id, reference, event_slug AS eventSlug, customer_email AS customerEmail,
           customer_name AS customerName, face_amount_minor AS faceAmountMinor,
           booking_fee_minor AS bookingFeeMinor, total_amount_minor AS totalAmountMinor,
           currency, quantity, paid_at AS paidAt
    FROM orders WHERE id = ? LIMIT 1
  `).bind(orderId).first<{
    id: string; reference: string; eventSlug: string; customerEmail: string; customerName: string | null;
    faceAmountMinor: number; bookingFeeMinor: number; totalAmountMinor: number; currency: string; quantity: number; paidAt: string | null;
  }>();
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "orders.manage")) return Response.json({ error: "Finance access is required." }, { status: 403 });
  await expireReservations(env.DB);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const wildcard = `%${query}%`;
  const orders = await env.DB.prepare(`
    SELECT orders.id, orders.reference, orders.event_slug AS eventSlug,
           COALESCE(event.title, orders.event_slug) AS eventTitle,
           orders.ticket_type AS ticketType, orders.unit_quantity AS unitQuantity,
           orders.quantity, orders.total_amount_minor AS totalAmountMinor, orders.refunded_amount_minor AS refundedAmountMinor,
           orders.currency, orders.customer_email AS customerEmail,
           orders.customer_phone AS customerPhone, orders.customer_name AS customerName,
           orders.status, orders.paystack_status AS paystackStatus,
           orders.refund_status AS refundStatus, orders.dispute_status AS disputeStatus,
           orders.reservation_expires_at AS reservationExpiresAt,
           orders.created_at AS createdAt, orders.paid_at AS paidAt,
           (SELECT COUNT(*) FROM tickets WHERE tickets.order_id = orders.id AND tickets.status = 'checked_in') AS checkedInCount,
           (SELECT status FROM payment_refunds WHERE payment_refunds.order_id = orders.id ORDER BY requested_at DESC LIMIT 1) AS latestRefundStatus
    FROM orders LEFT JOIN curated_event_records event ON event.slug = orders.event_slug
    WHERE (? = '' OR orders.reference LIKE ? OR orders.customer_email LIKE ? OR orders.customer_phone LIKE ? OR orders.customer_name LIKE ?)
      AND (? = '' OR orders.status = ?)
    ORDER BY orders.created_at DESC LIMIT 200
  `).bind(query, wildcard, wildcard, wildcard, wildcard, status, status).all<Record<string, unknown>>();
  const [runs, disputes, settlements] = await Promise.all([
    env.DB.prepare("SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 20").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM payment_disputes WHERE status NOT IN ('resolved', 'accepted') ORDER BY updated_at DESC LIMIT 50").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM event_settlements ORDER BY period_end DESC, event_slug LIMIT 100").all<Record<string, unknown>>(),
  ]);
  return Response.json({ orders: orders.results, reconciliationRuns: runs.results, disputes: disputes.results, settlements: settlements.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "orders.manage")) return Response.json({ error: "Finance access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { action?: string; orderId?: string; reason?: string; periodStart?: string; periodEnd?: string; amountMinor?: number; ticketIds?: string[]; disputeId?: string; resolution?: "merchant-accepted" | "declined" };
  if (!env.PAYSTACK_SECRET_KEY && ["verify", "refund", "reconcile", "dispute_resolve"].includes(body.action ?? "")) return Response.json({ error: "Paystack credentials are not configured." }, { status: 503 });
  try {
    if (body.action === "expire") {
      const result = await expireReservations(env.DB);
      await recordAudit(env.DB, { session, action: "payments.expire_reservations", targetType: "inventory", outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json(result);
    }
    if (body.action === "verify") {
      const order = await orderForDelivery(env.DB, body.orderId ?? "");
      if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
      const result = await verifyAndFulfill(env.DB, order.reference, env.PAYSTACK_SECRET_KEY);
      if (result.result === "paid") await deliverConfirmedOrder(env.DB, result.order, new URL(request.url).origin);
      await recordAudit(env.DB, { session, action: "payments.verify", targetType: "order", targetId: order.id, outcome: "success", detail: result.result, requestId: requestMetadata(request).requestId });
      return Response.json({ result: result.result, providerStatus: "providerStatus" in result ? result.providerStatus : undefined });
    }
    if (body.action === "refund") {
      if (!body.orderId) return Response.json({ error: "Choose an order." }, { status: 400 });
      const result = await initiatePaystackRefund(env.DB, { orderId: body.orderId, actor: `${session.actor} <${session.email}>`, reason: body.reason ?? "", secret: env.PAYSTACK_SECRET_KEY, amountMinor: body.amountMinor, ticketIds: body.ticketIds });
      await recordAudit(env.DB, { session, action: "payments.refund_requested", targetType: "order", targetId: body.orderId, outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json(result);
    }
    if (body.action === "dispute_evidence") {
      const evidence = await buildDisputeEvidence(env.DB, body.disputeId ?? "");
      await recordAudit(env.DB, { session, action: "payments.dispute_evidence", targetType: "dispute", targetId: body.disputeId, outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json({ evidence });
    }
    if (body.action === "dispute_resolve") {
      const dispute = await env.DB.prepare("SELECT paystack_dispute_id AS providerId FROM payment_disputes WHERE id = ? LIMIT 1").bind(body.disputeId ?? "").first<{ providerId: string | null }>();
      if (!dispute?.providerId) throw new Error("The provider dispute reference is missing.");
      const result = await resolvePaystackDispute(env.PAYSTACK_SECRET_KEY, { providerDisputeId: dispute.providerId, resolution: body.resolution === "merchant-accepted" ? "merchant-accepted" : "declined" });
      await recordAudit(env.DB, { session, action: "payments.dispute_resolved", targetType: "dispute", targetId: body.disputeId, outcome: "success", detail: body.resolution, requestId: requestMetadata(request).requestId });
      return Response.json({ result });
    }
    if (body.action === "resend") {
      const order = await orderForDelivery(env.DB, body.orderId ?? "");
      if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
      const result = await issueRecoveryGrant({ db: env.DB, normalizedEmail: order.customerEmail, origin: new URL(request.url).origin, kind: "payment_confirmation", order, ttlMinutes: 7 * 24 * 60 });
      await recordAudit(env.DB, { session, action: "tickets.delivery_requested", targetType: "order", targetId: order.id, outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json(result);
    }
    if (body.action === "reconcile") {
      const periodEnd = body.periodEnd ? new Date(body.periodEnd).toISOString() : new Date().toISOString();
      const periodStart = body.periodStart ? new Date(body.periodStart).toISOString() : new Date(new Date(periodEnd).getTime() - 24 * 60 * 60 * 1000).toISOString();
      if (periodStart >= periodEnd) throw new Error("The reconciliation period is invalid.");
      const result = await runDailyReconciliation(env.DB, { secret: env.PAYSTACK_SECRET_KEY, periodStart, periodEnd, actor: `${session.actor} <${session.email}>` });
      await recordAudit(env.DB, { session, action: "payments.reconciled", targetType: "reconciliation", targetId: "id" in result ? String(result.id) : null, outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json(result);
    }
    return Response.json({ error: "Invalid operation." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The payment operation failed." }, { status: 400 });
  }
}
