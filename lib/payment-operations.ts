import { paystackEnvironment } from "./paystack-environment";
import { rememberEventContact, notifyRegistrationHosts } from './event-audience';
import { sendOrderConfirmation } from "./email-delivery";
import { recordProductMetric } from "./product-analytics";

export type PaystackVerification = {
  provider?: "paystack" | "seevplus";
  providerReference?: string;
  environment?: "test" | "live";
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
  paymentProvider: string;
  paymentEnvironment: string | null;
  providerReference: string | null;
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
    data?: { domain?: string; id?: number | string; reference?: string; status?: string; amount?: number; currency?: string; paid_at?: string | null; channel?: string | null; gateway_response?: string | null };
  };
  if (!response.ok || !payload.status || !payload.data?.reference || !payload.data.status || typeof payload.data.amount !== "number" || !payload.data.currency) {
    throw new Error(payload.message ?? "Paystack could not verify this transaction.");
  }
  const environment=paystackEnvironment(secret);
  if (payload.data.reference !== reference || !environment || (payload.data.domain != null && payload.data.domain !== environment)) throw new Error("Paystack verification did not match the requested payment.");
  return {
    environment,
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
           status, paid_at AS paidAt, payment_provider AS paymentProvider, payment_environment AS paymentEnvironment, provider_reference AS providerReference
    FROM orders WHERE reference = ? LIMIT 1
  `).bind(reference).first<OrderRecord>();
}

function issuedTicketStatements(db: D1Database, order: OrderRecord, issuedAt: string) {
  const statements: D1PreparedStatement[] = [];
  for (let admissionNumber = 1; admissionNumber <= order.quantity; admissionNumber += 1) {
    const ticketId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO tickets (
        id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at
      ) SELECT ?, id, event_slug, ticket_type, ?, ?, 'issued', ?
        FROM orders WHERE id = ? AND status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM curated_event_records event WHERE event.slug = orders.event_slug AND (event.removed_at IS NOT NULL OR event.event_state = 'cancelled'))
    `).bind(ticketId, admissionNumber, `unissued-${ticketId}`, issuedAt, order.id));
  }
  return statements;
}

export async function fulfillVerifiedPayment(db: D1Database, verification: PaystackVerification) {
  const order = await readOrder(db, verification.reference);
  if (!order) return { result: "unknown_order" as const };
  if (order.paymentProvider !== (verification.provider ?? "paystack") || (order.paymentProvider === "seevplus" && (!order.providerReference || verification.providerReference !== order.providerReference))) return { result: "mismatch" as const, order };
  if (order.paymentProvider==='paystack' && order.paymentEnvironment && order.paymentEnvironment!==verification.environment) return {result:'mismatch' as const,order};
  const statusColumn = order.paymentProvider === "seevplus" ? "provider_status" : "paystack_status";
  const referenceColumn = order.paymentProvider === "seevplus" ? "provider_reference" : "paystack_reference";
  const transactionColumn = order.paymentProvider === "seevplus" ? "provider_transaction_id" : "paystack_transaction_id";
  const now = new Date().toISOString();
  if (verification.reference !== order.reference || verification.amount !== order.totalAmountMinor || verification.currency !== order.currency) {
    await db.prepare(`
      UPDATE orders SET ${statusColumn} = ?, payment_updated_at = ?, failure_reason = ?
      WHERE id = ?
    `).bind(verification.status, now, "Provider amount, currency or reference did not match the order.", order.id).run();
    await recordProductMetric(db, "payment_failed", order.eventSlug);
    return { result: "mismatch" as const, order };
  }
  if (verification.status !== "success") {
    if (["abandoned", "failed", "reversed"].includes(verification.status)) {
      const [failedOrder] = await db.batch([
        db.prepare(`UPDATE orders SET status = 'failed', ${statusColumn} = ?, payment_updated_at = ?, failure_reason = ? WHERE id = ? AND status IN ('payment_pending','expired')`)
          .bind(verification.status, now, verification.gatewayResponse ?? `Payment ${verification.status}.`, order.id),
        db.prepare(`UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ? AND status = 'held'`).bind(now, order.id),
      ]);
      if (failedOrder.meta.changes === 1) await recordProductMetric(db, "payment_failed", order.eventSlug);
    } else {
      await db.prepare(`UPDATE orders SET ${statusColumn} = ?, payment_updated_at = ? WHERE id = ?`)
        .bind(verification.status, now, order.id).run();
    }
    return { result: "pending" as const, providerStatus: verification.status, order };
  }

  if (!["payment_pending", "expired", "failed", "paid"].includes(order.status)) return { result: "not_fulfilled" as const, order };
  // D1 executes this batch as one transaction: event cancellation, inventory,
  // payment state and ticket issuance cannot interleave halfway through it.
  const results = await db.batch([
    db.prepare(`
      UPDATE inventory_reservations SET status = 'consumed', updated_at = ?
      WHERE order_id = ? AND status IN ('held', 'expired', 'released')
        AND EXISTS (SELECT 1 FROM orders WHERE id = inventory_reservations.order_id AND status IN ('payment_pending', 'expired', 'failed'))
        AND EXISTS (
          SELECT 1 FROM event_ticket_tiers tier
          WHERE tier.id = inventory_reservations.ticket_tier_id
            AND NOT EXISTS (SELECT 1 FROM curated_event_records event WHERE event.slug = tier.event_slug AND (event.removed_at IS NOT NULL OR event.event_state = 'cancelled'))
            AND (
              SELECT COALESCE(SUM(other.admission_count), 0) FROM inventory_reservations other
              WHERE other.ticket_tier_id = tier.id AND other.order_id <> inventory_reservations.order_id
                AND (other.status = 'consumed' OR (other.status = 'held' AND other.expires_at > ?))
            ) + inventory_reservations.admission_count <= tier.capacity_admissions
        )
    `).bind(now, order.id, now),
    db.prepare(`
      UPDATE orders SET status = CASE
          WHEN EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = orders.event_slug AND (e.removed_at IS NOT NULL OR e.event_state = 'cancelled'))
            OR NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_id = orders.id AND r.status = 'consumed')
          THEN 'requires_refund' ELSE 'paid' END,
        ${statusColumn} = 'success', ${referenceColumn} = ?, ${transactionColumn} = ?,
        payment_verified_at = ?, payment_updated_at = ?, paid_at = COALESCE(paid_at, ?), failure_reason = NULL
      WHERE id = ? AND (status IN ('payment_pending', 'expired', 'failed') OR
        (status = 'paid' AND EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug = orders.event_slug AND (e.removed_at IS NOT NULL OR e.event_state = 'cancelled'))))
    `).bind(verification.providerReference ?? verification.reference, String(verification.id), now, now, verification.paidAt ?? now, order.id),
    db.prepare(`UPDATE orders SET failure_reason = 'Payment succeeded after the event or admission was no longer available.' WHERE id = ? AND status = 'requires_refund'`).bind(order.id),
    db.prepare(`UPDATE inventory_reservations SET status = 'released', updated_at = ? WHERE order_id = ? AND status IN ('held', 'expired', 'consumed')
      AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'requires_refund')`).bind(now, order.id, order.id),
    db.prepare(`UPDATE tickets SET status = 'voided' WHERE order_id = ? AND status = 'issued'
      AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'requires_refund')`).bind(order.id, order.id),
    ...issuedTicketStatements(db, order, verification.paidAt ?? now),
  ]);

  const paidOrder = await readOrder(db, verification.reference);
  if (paidOrder?.status === "requires_refund") return { result: "requires_refund" as const, order: paidOrder };
  if (!paidOrder || paidOrder.status !== "paid") return { result: "not_fulfilled" as const, order };
  const newlyPaid = results[1].meta.changes === 1;
  const consent = await db.prepare('SELECT announcements_opt_in AS optedIn,created_at AS createdAt FROM orders WHERE id=?').bind(paidOrder.id).first<{optedIn:number;createdAt:string}>();
  await rememberEventContact(db,{eventSlug:paidOrder.eventSlug,email:paidOrder.customerEmail,guestName:paidOrder.customerName ?? 'Guest',source:'paid',consentedAt:consent?.optedIn ? consent.createdAt : null});
  await notifyRegistrationHosts(db,{eventSlug:paidOrder.eventSlug,sourceId:paidOrder.id,guestName:paidOrder.customerName??'Guest',status:'paid',guests:paidOrder.quantity});
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
  const order = await db.prepare(`SELECT id, reference, total_amount_minor AS totalAmountMinor, refunded_amount_minor AS refundedAmountMinor, status, payment_provider AS provider FROM orders WHERE id = ?`)
    .bind(input.orderId).first<{id:string;reference:string;totalAmountMinor:number;refundedAmountMinor:number;status:string;provider:string}>();
  if (!order) throw new Error('Order not found.');
  if (order.provider !== 'paystack') throw new Error('SeevPlus refunds require finance review with SeevPlus.');
  if (!['paid','requires_refund'].includes(order.status)) throw new Error('This order is not available for another refund.');
  const reason = input.reason.trim().slice(0,500);
  if (reason.length < 8) throw new Error('Add a clear refund reason.');
  const remaining = order.totalAmountMinor - order.refundedAmountMinor, amountMinor = input.amountMinor ?? remaining;
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > remaining) throw new Error('Choose a refund amount within the remaining paid balance.');
  const full = amountMinor === remaining;
  const selected = [...new Set(input.ticketIds ?? [])];
  const filter = selected.length ? `AND id IN (${selected.map(()=>'?').join(',')})` : '';
  const tickets = await db.prepare(`SELECT id,status FROM tickets WHERE order_id=? ${filter}`).bind(order.id,...selected).all<{id:string;status:string}>();
  if (selected.length && (tickets.results.length !== selected.length || tickets.results.some(t=>!['issued','voided'].includes(t.status)))) throw new Error('One of the selected tickets cannot be refunded.');
  if (order.status !== 'requires_refund' && tickets.results.some(t=>t.status==='checked_in')) throw new Error('A checked-in order needs finance review before refunding.');
  // Remember only admissions this request disables, so failure cannot revive an
  // earlier refund, dispute or event removal.
  const disabled = (full || selected.length ? tickets.results : []).filter(t=>t.status==='issued').map(t=>t.id);
  const refundId=crypto.randomUUID(), now=new Date().toISOString();
  const reserved = `EXISTS (SELECT 1 FROM payment_refunds WHERE id=?)`;
  const [claim] = await db.batch([
    db.prepare(`INSERT INTO payment_refunds (id,order_id,amount_minor,status,reason,requested_by,requested_at,updated_at,ticket_ids_json,batch_id,previous_order_status)
      SELECT ?,id,?,'pending',?,?,?,?,?,?,status FROM orders WHERE id=? AND status IN ('paid','requires_refund')
        AND refunded_amount_minor=? AND total_amount_minor-refunded_amount_minor>=?
        AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id=orders.id AND r.status IN ('pending','processing'))
        AND (status='requires_refund' OR NOT EXISTS (SELECT 1 FROM tickets WHERE order_id=orders.id AND status='checked_in' ${filter}))`)
      .bind(refundId,amountMinor,reason,input.actor,now,now,JSON.stringify(disabled),input.batchId??null,order.id,order.refundedAmountMinor,amountMinor,...selected),
    db.prepare(`UPDATE orders SET status=CASE WHEN ? THEN 'refund_pending' ELSE status END,refund_status='pending',payment_updated_at=? WHERE id=? AND ${reserved}`).bind(full?1:0,now,order.id,refundId),
    db.prepare(`UPDATE tickets SET status='voided' WHERE order_id=? AND status='issued' AND id IN (SELECT value FROM json_each(?)) AND ${reserved}`).bind(order.id,JSON.stringify(disabled),refundId),
  ]);
  if (!claim.meta.changes) throw new Error('A refund is already underway or this order has changed. Refresh before continuing.');
  let response: Response, payload: {status?:boolean;message?:string;data?:{id?:number|string;status?:string}};
  try {
    response=await fetch('https://api.paystack.co/refund',{method:'POST',headers:{authorization:`Bearer ${input.secret}`,'content-type':'application/json'},signal:AbortSignal.timeout(10_000),
      body:JSON.stringify({transaction:order.reference,amount:amountMinor,currency:'GHS',customer_note:reason,merchant_note:`${input.actor}: ${reason}`})});
    payload=await response.json() as typeof payload;
    if (response.status >= 500) throw new Error('Provider response is uncertain.');
  } catch {
    await db.prepare("UPDATE payment_refunds SET failure_reason='Provider response was not received. Verify with Paystack before retrying.',updated_at=? WHERE id=? AND status='pending'").bind(new Date().toISOString(),refundId).run();
    throw new Error('The refund is awaiting Paystack confirmation. Check its status before making another request.');
  }
  if (!response.ok || !payload.status) {
    await applyRefundWebhook(db,{eventType:'refund.failed',reference:order.reference,amountMinor,refundId,failureReason:payload.message??'Paystack rejected the refund.'});
    throw new Error(payload.message??'Paystack rejected the refund.');
  }
  const providerId=payload.data?.id == null ? null : String(payload.data.id);
  await db.prepare('UPDATE payment_refunds SET paystack_refund_id=COALESCE(paystack_refund_id,?),updated_at=? WHERE id=?').bind(providerId,new Date().toISOString(),refundId).run();
  const status=['processed','processing','failed'].includes(payload.data?.status??'') ? payload.data!.status! : 'pending';
  await applyRefundWebhook(db,{eventType:`refund.${status}`,reference:order.reference,amountMinor,providerRefundId:providerId,refundId});
  const current=await db.prepare('SELECT status FROM payment_refunds WHERE id=?').bind(refundId).first<{status:string}>();
  return {refundId,status:current?.status??status,amountMinor,full};
}

export async function applyRefundWebhook(db: D1Database, input: { eventType: string; reference: string; amountMinor: number; providerRefundId?: string | null; failureReason?: string | null; refundId?: string }) {
  if (!['refund.pending','refund.processing','refund.processed','refund.failed'].includes(input.eventType)) return;
  const order=await db.prepare("SELECT id FROM orders WHERE reference=? AND payment_provider='paystack'").bind(input.reference).first<{id:string}>();
  if (!order) return;
  // Match an exact refund, or the sole reservation whose provider response has
  // not arrived yet. Unknown callbacks must never apply to another refund.
  const rows=await db.prepare(`SELECT id,amount_minor AS amountMinor,status FROM payment_refunds WHERE order_id=? AND (
      (? IS NOT NULL AND id=?) OR (? IS NULL AND ? IS NOT NULL AND paystack_refund_id=?)
      OR (? IS NULL AND status IN ('pending','processing') AND (? IS NULL OR paystack_refund_id IS NULL) AND amount_minor=?))`)
    .bind(order.id,input.refundId??null,input.refundId??null,input.refundId??null,input.providerRefundId??null,input.providerRefundId??null,input.refundId??null,input.providerRefundId??null,input.amountMinor).all<{id:string;amountMinor:number;status:string}>();
  if (rows.results.length!==1) {
    await db.prepare(`INSERT INTO system_alerts (id,source,severity,message,detail,status,created_at)
      SELECT ?,'refund-match','warning',?,?,'open',? WHERE NOT EXISTS (SELECT 1 FROM system_alerts WHERE source='refund-match' AND message=? AND status<>'resolved')`)
      .bind(crypto.randomUUID(),`Refund needs review: ${input.reference}`,`Paystack refund ${input.providerRefundId??'without ID'} could not be matched to one request. Verify the provider record before changing the order.`,new Date().toISOString(),`Refund needs review: ${input.reference}`).run();
    return;
  }
  const refund=rows.results[0],next=input.eventType.slice(7);
  if (['processed','failed'].includes(refund.status) || (next==='pending' && refund.status==='processing')) return;
  if (!Number.isInteger(input.amountMinor) || input.amountMinor!==refund.amountMinor) return;
  const transition=crypto.randomUUID(),now=new Date().toISOString();
  const guard=`EXISTS (SELECT 1 FROM payment_refunds r WHERE r.id=? AND r.transition_id=?)`;
  const statements=[
    db.prepare(`UPDATE payment_refunds SET status=?,transition_id=?,paystack_refund_id=COALESCE(paystack_refund_id,?),failure_reason=?,updated_at=? WHERE id=? AND status IN ('pending','processing') AND NOT (status='processing' AND ?='pending')`)
      .bind(next,transition,input.providerRefundId??null,input.failureReason??null,now,refund.id,next),
    db.prepare(`UPDATE orders SET refund_status=?,payment_updated_at=? WHERE id=? AND ${guard}`).bind(next,now,order.id,refund.id,transition),
  ];
  if (next==='processed') {
    statements.push(
      db.prepare(`UPDATE orders SET status=CASE WHEN refunded_amount_minor+?>=total_amount_minor THEN 'refunded' WHEN status='refund_pending' THEN COALESCE((SELECT previous_order_status FROM payment_refunds WHERE id=?),'requires_refund') ELSE status END,
        refunded_amount_minor=MIN(total_amount_minor,refunded_amount_minor+?) WHERE id=? AND ${guard}`).bind(refund.amountMinor,refund.id,refund.amountMinor,order.id,refund.id,transition),
      db.prepare(`UPDATE tickets SET status='refunded' WHERE order_id=? AND status<>'checked_in' AND (id IN (SELECT value FROM json_each((SELECT ticket_ids_json FROM payment_refunds WHERE id=?))) OR EXISTS (SELECT 1 FROM orders WHERE id=? AND status='refunded')) AND ${guard}`).bind(order.id,refund.id,order.id,refund.id,transition),
      db.prepare(`UPDATE inventory_reservations SET status='released',updated_at=? WHERE order_id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND status='refunded') AND ${guard}`).bind(now,order.id,order.id,refund.id,transition),
    );
  } else if (next==='failed') {
    statements.push(
      db.prepare(`UPDATE orders SET status=CASE WHEN EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug=orders.event_slug AND (e.removed_at IS NOT NULL OR e.event_state='cancelled')) THEN 'requires_refund' ELSE COALESCE((SELECT previous_order_status FROM payment_refunds WHERE id=?),'requires_refund') END
        WHERE id=? AND status='refund_pending' AND ${guard}`).bind(refund.id,order.id,refund.id,transition),
      db.prepare(`UPDATE tickets SET status='issued' WHERE order_id=? AND status='voided'
        AND id IN (SELECT value FROM json_each((SELECT ticket_ids_json FROM payment_refunds WHERE id=?)))
        AND EXISTS (SELECT 1 FROM orders o JOIN curated_event_records e ON e.slug=o.event_slug WHERE o.id=? AND o.status='paid' AND e.removed_at IS NULL AND e.event_state NOT IN ('cancelled','postponed')) AND ${guard}`).bind(order.id,refund.id,order.id,refund.id,transition),
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
  const order = await db.prepare("SELECT id FROM orders WHERE reference = ? AND payment_provider = 'paystack' LIMIT 1").bind(input.reference).first<{ id: string }>();
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
      db.prepare("UPDATE orders SET status = CASE WHEN EXISTS (SELECT 1 FROM curated_event_records e WHERE e.slug=orders.event_slug AND (e.removed_at IS NOT NULL OR e.event_state='cancelled')) THEN 'requires_refund' WHEN EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id=orders.id AND r.status IN ('pending','processing') AND r.amount_minor>=orders.total_amount_minor-orders.refunded_amount_minor) THEN 'refund_pending' ELSE 'paid' END, dispute_status = ?, payment_updated_at = ? WHERE id = ? AND status='disputed'").bind(status, now, order.id),
      db.prepare("UPDATE tickets SET status = 'issued' WHERE order_id = ? AND status = 'voided' AND EXISTS (SELECT 1 FROM orders o JOIN curated_event_records e ON e.slug=o.event_slug WHERE o.id=tickets.order_id AND o.status='paid' AND e.removed_at IS NULL AND e.event_state NOT IN ('cancelled','postponed')) AND NOT EXISTS (SELECT 1 FROM payment_refunds r,json_each(r.ticket_ids_json) j WHERE r.order_id=tickets.order_id AND r.status IN ('pending','processing','processed') AND j.value=tickets.id)").bind(order.id),
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
    const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
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
        FROM orders WHERE payment_provider = 'paystack' AND created_at >= ? AND created_at < ? ORDER BY created_at
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
