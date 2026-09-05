import { sendOrderConfirmation } from "./email-delivery";
import { recordProductMetric } from "./product-analytics";

export type PaystackVerification = {
  id: number | string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paidAt: string | null;
  channel: string | null;
  gatewayResponse: string | null;
};

type OrderRecord = {
  id: string;
  reference: string;
  eventSlug: string;
  ticketType: string;
  quantity: number;
  unitQuantity: number;
  faceAmountMinor: number;
  bookingFeeMinor: number;
  totalAmountMinor: number;
  currency: string;
  customerEmail: string;
  customerPhone: string;
  customerName: string | null;
  paymentChannel: string;
  status: string;
  paidAt: string | null;
};

export async function expireReservations(db: D1Database, now = new Date().toISOString()) {
  const [reservations, orders] = await db.batch([
    db.prepare(`
      UPDATE inventory_reservations SET status = 'expired', updated_at = ?
      WHERE status = 'held' AND expires_at <= ?
    `).bind(now, now),
    db.prepare(`
      UPDATE orders SET status = 'expired',
        payment_updated_at = ?, failure_reason = 'Payment window expired before confirmation; provider status awaits verification.'
      WHERE status = 'payment_pending' AND reservation_expires_at <= ?
    `).bind(now, now),
    db.prepare(`
      UPDATE event_waitlist_entries SET status = 'waiting', offer_token_hash = NULL,
        offered_at = NULL, offer_expires_at = NULL, updated_at = ?
      WHERE id IN (SELECT waitlist_entry_id FROM orders WHERE status = 'expired'
        AND reservation_expires_at <= ? AND waitlist_entry_id IS NOT NULL)
        AND status = 'claimed'
    `).bind(now, now),
    db.prepare("UPDATE payment_attempts SET response_json = NULL WHERE created_at <= ? AND response_json IS NOT NULL")
      .bind(new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  return { reservations: reservations.meta.changes, orders: orders.meta.changes };
}

export async function verifyPaystackTransaction(reference: string, secret: string): Promise<PaystackVerification> {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as {
    status?: boolean;
    message?: string;
    data?: { id?: number | string; reference?: string; status?: string; amount?: number; currency?: string; paid_at?: string | null; channel?: string | null; gateway_response?: string | null };
  };
  if (!response.ok || !payload.status || !payload.data?.reference || !payload.data.status || typeof payload.data.amount !== "number" || !payload.data.currency) {
    throw new Error(payload.message ?? "Paystack could not verify this transaction.");
  }
  return {
    id: payload.data.id ?? "",
    reference: payload.data.reference,
    status: payload.data.status,
    amount: payload.data.amount,
    currency: payload.data.currency,
    paidAt: payload.data.paid_at ?? null,
    channel: payload.data.channel ?? null,
    gatewayResponse: payload.data.gateway_response ?? null,
  };
}

async function readOrder(db: D1Database, reference: string) {
  return db.prepare(`
    SELECT id, reference, event_slug AS eventSlug, ticket_type AS ticketType,
           quantity, unit_quantity AS unitQuantity, face_amount_minor AS faceAmountMinor,
           booking_fee_minor AS bookingFeeMinor, total_amount_minor AS totalAmountMinor,
           currency, customer_email AS customerEmail, customer_phone AS customerPhone,
           customer_name AS customerName, payment_channel AS paymentChannel,
           status, paid_at AS paidAt
    FROM orders WHERE reference = ? LIMIT 1
  `).bind(reference).first<OrderRecord>();
}

async function ensureIssuedTickets(db: D1Database, order: OrderRecord, issuedAt: string) {
  const statements: D1PreparedStatement[] = [];
  for (let admissionNumber = 1; admissionNumber <= order.quantity; admissionNumber += 1) {
    const ticketId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO tickets (
        id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at
      ) SELECT ?, id, event_slug, ticket_type, ?, ?, 'issued', ?
        FROM orders WHERE id = ? AND status = 'paid'
    `).bind(ticketId, admissionNumber, `unissued-${ticketId}`, issuedAt, order.id));
  }
  if (statements.length) await db.batch(statements);
}

export async function fulfillVerifiedPayment(db: D1Database, verification: PaystackVerification) {
  const order = await readOrder(db, verification.reference);
  if (!order) return { result: "unknown_order" as const };
  const now = new Date().toISOString();
  if (verification.reference !== order.reference || verification.amount !== order.totalAmountMinor || verification.currency !== order.currency) {
    await db.prepare(`
      UPDATE orders SET paystack_status = ?, payment_updated_at = ?, failure_reason = ?
      WHERE id = ?
    `).bind(verification.status, now, "Provider amount, currency or reference did not match the order.", order.id).run();
    await recordProductMetric(db, "payment_failed", order.eventSlug);
    return { result: "mismatch" as const, order };
  }
  if (verification.status !== "success") {
    if (["abandoned", "failed", "reversed"].includes(verification.status)) {
      const [failedOrder] = await db.batch([
        db.prepare(`UPDATE orders SET status = 'failed', paystack_status = ?, payment_updated_at = ?, failure_reason = ? WHERE id = ? AND status = 'payment_pending'`)
          .bind(verification.status, now, verification.gatewayResponse ?? `Payment ${verification.status}.`, order.id),
        db.prepare(`UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ? AND status = 'held'`).bind(now, order.id),
      ]);
      if (failedOrder.meta.changes === 1) await recordProductMetric(db, "payment_failed", order.eventSlug);
    } else {
      await db.prepare("UPDATE orders SET paystack_status = ?, payment_updated_at = ? WHERE id = ?")
        .bind(verification.status, now, order.id).run();
    }
    return { result: "pending" as const, providerStatus: verification.status, order };
  }

  let newlyPaid = false;
  if (order.status !== "paid") {
    await db.prepare(`
      UPDATE inventory_reservations
      SET status = 'consumed', updated_at = ?
      WHERE order_id = ? AND status IN ('held', 'expired', 'released')
        AND EXISTS (
          SELECT 1 FROM event_ticket_tiers tier
          WHERE tier.id = inventory_reservations.ticket_tier_id
            AND (
              SELECT COALESCE(SUM(other.admission_count), 0)
              FROM inventory_reservations other
              WHERE other.ticket_tier_id = tier.id
                AND other.order_id <> inventory_reservations.order_id
                AND (
                  other.status = 'consumed'
                  OR (other.status = 'held' AND other.expires_at > ?)
                )
            ) + inventory_reservations.admission_count <= tier.capacity_admissions
        )
    `).bind(now, order.id, now).run();
    const reservation = await db.prepare("SELECT status FROM inventory_reservations WHERE order_id = ? LIMIT 1")
      .bind(order.id).first<{ status: string }>();
    if (reservation?.status !== "consumed") {
      await db.prepare(`
        UPDATE orders SET status = 'requires_refund', paystack_status = 'success',
          paystack_transaction_id = ?, payment_verified_at = ?, payment_updated_at = ?,
          failure_reason = 'Payment succeeded after inventory was no longer available.'
        WHERE id = ?
      `).bind(String(verification.id), now, now, order.id).run();
      return { result: "requires_refund" as const, order };
    }
    const paidUpdate = await db.prepare(`
      UPDATE orders SET status = 'paid', paystack_status = 'success', paystack_reference = ?,
        paystack_transaction_id = ?, payment_verified_at = ?, payment_updated_at = ?,
        paid_at = COALESCE(paid_at, ?), failure_reason = NULL
      WHERE id = ? AND status IN ('payment_pending', 'expired', 'failed')
    `).bind(verification.reference, String(verification.id), now, now, verification.paidAt ?? now, order.id).run();
    newlyPaid = paidUpdate.meta.changes === 1;
  }

  const paidOrder = await readOrder(db, verification.reference);
  if (!paidOrder || paidOrder.status !== "paid") return { result: "not_fulfilled" as const, order };
  await ensureIssuedTickets(db, paidOrder, verification.paidAt ?? now);
  if (newlyPaid) await recordProductMetric(db, "payment_confirmed", paidOrder.eventSlug);
  return { result: "paid" as const, order: paidOrder, newlyPaid };
}

export async function verifyAndFulfill(db: D1Database, reference: string, secret: string) {
  const verification = await verifyPaystackTransaction(reference, secret);
  return fulfillVerifiedPayment(db, verification);
}

export async function deliverConfirmedOrder(db: D1Database, order: OrderRecord, origin: string) {
  return sendOrderConfirmation(db, order, origin);
}

export async function initiatePaystackRefund(db: D1Database, input: { orderId: string; actor: string; reason: string; secret: string; amountMinor?: number; ticketIds?: string[]; batchId?: string }) {
  const order = await db.prepare(`
    SELECT id, reference, total_amount_minor AS totalAmountMinor, refunded_amount_minor AS refundedAmountMinor, status
    FROM orders WHERE id = ? LIMIT 1
  `).bind(input.orderId).first<{ id: string; reference: string; totalAmountMinor: number; refundedAmountMinor: number; status: string }>();
  if (!order) throw new Error("Order not found.");
  if (!["paid", "requires_refund", "refund_pending"].includes(order.status)) throw new Error("Only a paid order can be refunded.");
  const ticketIds = [...new Set((input.ticketIds ?? []).filter((value) => typeof value === "string" && value.length > 0))];
  const ticketFilter = ticketIds.length ? `AND id IN (${ticketIds.map(() => "?").join(",")})` : "";
  const checkedIn = await db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE order_id = ? AND status = 'checked_in' ${ticketFilter}`)
    .bind(order.id, ...ticketIds).first<{ count: number }>();
  if ((checkedIn?.count ?? 0) > 0 && order.status !== "requires_refund") throw new Error("A checked-in order needs finance review before refunding.");
  if (ticketIds.length) {
    const matched = await db.prepare(`SELECT COUNT(*) AS count FROM tickets WHERE order_id = ? AND id IN (${ticketIds.map(() => "?").join(",")}) AND status IN ('issued', 'voided')`)
      .bind(order.id, ...ticketIds).first<{ count: number }>();
    if ((matched?.count ?? 0) !== ticketIds.length) throw new Error("One of the selected tickets cannot be refunded.");
  }
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 8) throw new Error("Add a clear refund reason.");
  const remaining = Math.max(0, order.totalAmountMinor - order.refundedAmountMinor);
  const amountMinor = input.amountMinor ?? remaining;
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > remaining) throw new Error("Choose a refund amount within the remaining paid balance.");
  const fullRemainingRefund = amountMinor === remaining;
  const refundId = crypto.randomUUID();
  const now = new Date().toISOString();
  const response = await fetch("https://api.paystack.co/refund", {
    method: "POST",
    headers: { authorization: `Bearer ${input.secret}`, "content-type": "application/json" },
    body: JSON.stringify({ transaction: order.reference, amount: amountMinor, currency: "GHS", customer_note: reason, merchant_note: `${input.actor}: ${reason}` }),
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: { id?: number | string; status?: string } };
  if (!response.ok || !payload.status) {
    await db.prepare(`
      INSERT INTO payment_refunds (id, order_id, amount_minor, status, reason, requested_by, requested_at, updated_at, failure_reason, ticket_ids_json, batch_id)
      VALUES (?, ?, ?, 'failed', ?, ?, ?, ?, ?, ?, ?)
    `).bind(refundId, order.id, amountMinor, reason, input.actor, now, now, payload.message ?? "Paystack rejected the refund.", ticketIds.length ? JSON.stringify(ticketIds) : null, input.batchId ?? null).run();
    throw new Error(payload.message ?? "Paystack rejected the refund.");
  }
  const providerStatus = payload.data?.status === "processed" ? "processed" : payload.data?.status === "processing" ? "processing" : "pending";
  await db.batch([
    db.prepare(`
      INSERT INTO payment_refunds (id, order_id, paystack_refund_id, amount_minor, status, reason, requested_by, requested_at, updated_at, ticket_ids_json, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(refundId, order.id, payload.data?.id ? String(payload.data.id) : null, amountMinor, providerStatus, reason, input.actor, now, now, ticketIds.length ? JSON.stringify(ticketIds) : null, input.batchId ?? null),
    db.prepare("UPDATE orders SET status = CASE WHEN ? THEN 'refund_pending' ELSE status END, refund_status = ?, payment_updated_at = ? WHERE id = ?")
      .bind(fullRemainingRefund ? 1 : 0, providerStatus, now, order.id),
    ticketIds.length
      ? db.prepare(`UPDATE tickets SET status = 'voided' WHERE order_id = ? AND status = 'issued' AND id IN (${ticketIds.map(() => "?").join(",")})`).bind(order.id, ...ticketIds)
      : fullRemainingRefund ? db.prepare("UPDATE tickets SET status = 'voided' WHERE order_id = ? AND status = 'issued'").bind(order.id) : db.prepare("SELECT 1"),
  ]);
  return { refundId, status: providerStatus, amountMinor, full: fullRemainingRefund };
}

export async function applyRefundWebhook(db: D1Database, input: { eventType: string; reference: string; amountMinor: number; providerRefundId?: string | null; failureReason?: string | null }) {
  const now = new Date().toISOString();
  const order = await db.prepare("SELECT id, total_amount_minor AS totalAmountMinor, refunded_amount_minor AS refundedAmountMinor FROM orders WHERE reference = ? LIMIT 1")
    .bind(input.reference).first<{ id: string; totalAmountMinor: number; refundedAmountMinor: number }>();
  if (!order) return;
  const refund = await db.prepare(`
    SELECT id, amount_minor AS amountMinor, ticket_ids_json AS ticketIdsJson
    FROM payment_refunds WHERE order_id = ?
      AND (? IS NULL OR paystack_refund_id = ?)
      AND status IN ('pending', 'processing')
    ORDER BY requested_at DESC LIMIT 1
  `).bind(order.id, input.providerRefundId ?? null, input.providerRefundId ?? null).first<{ id: string; amountMinor: number; ticketIdsJson: string | null }>();
  const appliedAmount = Math.min(input.amountMinor || refund?.amountMinor || order.totalAmountMinor, order.totalAmountMinor - order.refundedAmountMinor);
  const ticketIds = refund?.ticketIdsJson ? JSON.parse(refund.ticketIdsJson) as string[] : [];
  const next = input.eventType === "refund.processed" ? "processed" : input.eventType === "refund.failed" ? "failed" : input.eventType === "refund.processing" ? "processing" : "pending";
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE payment_refunds SET status = ?, failure_reason = ?, updated_at = ? WHERE id = COALESCE(?, id) AND order_id = ? AND status IN ('pending', 'processing')`)
      .bind(next, input.failureReason ?? null, now, refund?.id ?? null, order.id),
    db.prepare("UPDATE orders SET refund_status = ?, payment_updated_at = ? WHERE id = ?").bind(next, now, order.id),
  ];
  if (next === "processed") {
    statements.push(
      db.prepare("UPDATE orders SET status = CASE WHEN refunded_amount_minor + ? >= total_amount_minor THEN 'refunded' ELSE 'paid' END, refunded_amount_minor = MIN(total_amount_minor, refunded_amount_minor + ?), refund_status = 'processed' WHERE id = ?")
        .bind(appliedAmount, appliedAmount, order.id),
      ticketIds.length
        ? db.prepare(`UPDATE tickets SET status = 'refunded' WHERE order_id = ? AND id IN (${ticketIds.map(() => "?").join(",")}) AND status <> 'checked_in'`).bind(order.id, ...ticketIds)
        : appliedAmount + order.refundedAmountMinor >= order.totalAmountMinor ? db.prepare("UPDATE tickets SET status = 'refunded' WHERE order_id = ? AND status <> 'checked_in'").bind(order.id) : db.prepare("SELECT 1"),
      appliedAmount + order.refundedAmountMinor >= order.totalAmountMinor
        ? db.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ?").bind(now, order.id)
        : db.prepare("SELECT 1"),
    );
  } else if (next === "failed") {
    statements.push(
      db.prepare("UPDATE orders SET status = 'paid', refund_status = 'failed' WHERE id = ?").bind(order.id),
      ticketIds.length
        ? db.prepare(`UPDATE tickets SET status = 'issued' WHERE order_id = ? AND id IN (${ticketIds.map(() => "?").join(",")}) AND status = 'voided'`).bind(order.id, ...ticketIds)
        : db.prepare("UPDATE tickets SET status = 'issued' WHERE order_id = ? AND status = 'voided'").bind(order.id),
    );
  }
  await db.batch(statements);
}

export async function recordDisputeWebhook(db: D1Database, input: { eventType: string; reference: string; payload: Record<string, unknown> }) {
  const now = new Date().toISOString();
  const data = input.payload.data as Record<string, unknown> | undefined;
  const providerId = data?.id ? String(data.id) : null;
  const status = String(data?.status ?? (input.eventType.endsWith("resolve") ? "resolved" : "awaiting-merchant-feedback"));
  const resolution = String(data?.resolution ?? "").toLowerCase();
  const order = await db.prepare("SELECT id FROM orders WHERE reference = ? LIMIT 1").bind(input.reference).first<{ id: string }>();
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO payment_disputes (
        id, order_id, paystack_dispute_id, reference, event_type, status, category,
        amount_minor, due_at, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(paystack_dispute_id) DO UPDATE SET event_type = excluded.event_type,
        status = excluded.status, payload_json = excluded.payload_json, updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(), order?.id ?? null, providerId, input.reference, input.eventType, status,
      data?.category ? String(data.category) : null, Number(data?.amount ?? 0) || null,
      data?.due_at ? String(data.due_at) : null, JSON.stringify(input.payload), now, now,
    ),
  ];
  if (order && input.eventType !== "charge.dispute.resolve") {
    statements.push(
      db.prepare("UPDATE orders SET status = 'disputed', dispute_status = ?, payment_updated_at = ? WHERE id = ? AND status <> 'refunded'").bind(status, now, order.id),
      db.prepare("UPDATE tickets SET status = 'voided' WHERE order_id = ? AND status = 'issued'").bind(order.id),
    );
  } else if (order && input.eventType === "charge.dispute.resolve" && ["merchant-accepted", "accepted"].includes(resolution)) {
    statements.push(
      db.prepare("UPDATE orders SET status = 'refunded', dispute_status = ?, refunded_amount_minor = total_amount_minor, payment_updated_at = ? WHERE id = ?").bind(status, now, order.id),
      db.prepare("UPDATE tickets SET status = 'refunded' WHERE order_id = ? AND status <> 'checked_in'").bind(order.id),
      db.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ?").bind(now, order.id),
    );
  } else if (order) {
    statements.push(
      db.prepare("UPDATE orders SET status = 'paid', dispute_status = ?, payment_updated_at = ? WHERE id = ? AND status <> 'refunded'").bind(status, now, order.id),
      db.prepare("UPDATE tickets SET status = 'issued' WHERE order_id = ? AND status = 'voided'").bind(order.id),
    );
  }
  await db.batch(statements);
}

type ProviderTransaction = { id?: number | string; reference?: string; status?: string; amount?: number; currency?: string; paid_at?: string | null };

async function listPaystackTransactions(secret: string, from: string, to: string) {
  const transactions: ProviderTransaction[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL("https://api.paystack.co/transaction");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("perPage", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    const payload = await response.json() as { status?: boolean; message?: string; data?: ProviderTransaction[]; meta?: { page?: number; pageCount?: number } };
    if (!response.ok || !payload.status || !Array.isArray(payload.data)) throw new Error(payload.message ?? "Paystack transaction list failed.");
    transactions.push(...payload.data);
    if (!payload.meta?.pageCount || page >= payload.meta.pageCount) break;
  }
  return transactions;
}

export async function runDailyReconciliation(db: D1Database, input: { secret: string; periodStart: string; periodEnd: string; actor: string }) {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO reconciliation_runs (id, period_start, period_end, status, initiated_by, created_at) VALUES (?, ?, ?, 'running', ?, ?)`)
    .bind(runId, input.periodStart, input.periodEnd, input.actor, now).run();
  try {
    const [provider, local] = await Promise.all([
      listPaystackTransactions(input.secret, input.periodStart, input.periodEnd),
      db.prepare(`
        SELECT id, reference, event_slug AS eventSlug, status, total_amount_minor AS totalAmountMinor,
               face_amount_minor AS faceAmountMinor, booking_fee_minor AS bookingFeeMinor,
               refunded_amount_minor AS refundedAmountMinor, currency
        FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at
      `).bind(input.periodStart, input.periodEnd).all<{ id: string; reference: string; eventSlug: string; status: string; totalAmountMinor: number; faceAmountMinor: number; bookingFeeMinor: number; refundedAmountMinor: number; currency: string }>(),
    ]);
    const providerByReference = new Map(provider.filter((item) => item.reference).map((item) => [item.reference!, item]));
    const localByReference = new Map(local.results.map((item) => [item.reference, item]));
    const entries: Array<{ orderId: string | null; reference: string; localStatus: string | null; providerStatus: string | null; localAmount: number | null; providerAmount: number | null; result: "matched" | "mismatch" | "missing_local" | "missing_provider"; detail: string | null }> = [];
    for (const order of local.results) {
      const transaction = providerByReference.get(order.reference);
      if (!transaction) entries.push({ orderId: order.id, reference: order.reference, localStatus: order.status, providerStatus: null, localAmount: order.totalAmountMinor, providerAmount: null, result: "missing_provider", detail: "No provider transaction returned for the local order." });
      else {
        const expectedPaid = ["paid", "refund_pending", "refunded", "disputed"].includes(order.status);
        const matched = transaction.amount === order.totalAmountMinor && transaction.currency === order.currency && (expectedPaid ? transaction.status === "success" || transaction.status === "reversed" : true);
        entries.push({ orderId: order.id, reference: order.reference, localStatus: order.status, providerStatus: transaction.status ?? null, localAmount: order.totalAmountMinor, providerAmount: transaction.amount ?? null, result: matched ? "matched" : "mismatch", detail: matched ? null : "Amount, currency or status differs from the local order." });
      }
    }
    for (const transaction of provider) {
      if (transaction.reference?.startsWith("BCT-") && !localByReference.has(transaction.reference)) entries.push({ orderId: null, reference: transaction.reference, localStatus: null, providerStatus: transaction.status ?? null, localAmount: null, providerAmount: transaction.amount ?? null, result: "missing_local", detail: "Provider transaction has no local order." });
    }
    const matchedCount = entries.filter((entry) => entry.result === "matched").length;
    const mismatchCount = entries.filter((entry) => entry.result === "mismatch").length;
    const missingCount = entries.length - matchedCount - mismatchCount;
    const settlements = new Map<string, { gross: number; fees: number; refunds: number; currency: string }>();
    for (const order of local.results.filter((item) => ["paid", "refund_pending", "refunded", "disputed"].includes(item.status))) {
      const current = settlements.get(order.eventSlug) ?? { gross: 0, fees: 0, refunds: 0, currency: order.currency };
      current.gross += order.faceAmountMinor;
      current.fees += order.bookingFeeMinor;
      current.refunds += order.refundedAmountMinor;
      settlements.set(order.eventSlug, current);
    }
    await db.batch([
      ...entries.map((entry) => db.prepare(`
        INSERT INTO reconciliation_entries (
          id, run_id, order_id, reference, local_status, provider_status,
          local_amount_minor, provider_amount_minor, result, detail, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), runId, entry.orderId, entry.reference, entry.localStatus, entry.providerStatus, entry.localAmount, entry.providerAmount, entry.result, entry.detail, now)),
      ...[...settlements].map(([eventSlug, settlement]) => db.prepare(`
        INSERT INTO event_settlements (
          id, run_id, event_slug, period_start, period_end, gross_minor,
          booking_fees_minor, refunds_minor, net_ticket_sales_minor, currency, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), runId, eventSlug, input.periodStart, input.periodEnd, settlement.gross, settlement.fees, settlement.refunds, Math.max(0, settlement.gross - settlement.refunds), settlement.currency, mismatchCount || missingCount ? "held" : "ready", now)),
      db.prepare(`UPDATE reconciliation_runs SET status = 'completed', matched_count = ?, mismatch_count = ?, missing_count = ?, completed_at = ? WHERE id = ?`)
        .bind(matchedCount, mismatchCount, missingCount, new Date().toISOString(), runId),
    ]);
    return { runId, matchedCount, mismatchCount, missingCount };
  } catch (error) {
    await db.prepare("UPDATE reconciliation_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 1000), new Date().toISOString(), runId).run();
    throw error;
  }
}
