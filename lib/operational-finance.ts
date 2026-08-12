import { initiatePaystackRefund } from "./payment-operations";
import { notifyEventAttendees } from "./notifications";
import { hasPermission, type AdminSession } from "./admin-session";

export type ApprovalKind = "event_cancellation" | "mass_refund" | "organizer_payout";

type ApprovalRow = {
  id: string;
  kind: ApprovalKind;
  eventSlug: string | null;
  targetId: string | null;
  payloadJson: string;
  requestedBy: string;
  status: string;
};

export function canDecideApproval(session: AdminSession, kind: ApprovalKind): boolean {
  if (kind === "event_cancellation") return hasPermission(session, "events.manage");
  return hasPermission(session, "orders.manage");
}

function maskAccount(value: string): string {
  const clean = value.replace(/\s+/gu, "");
  return clean.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, clean.length - 4))}${clean.slice(-4)}`;
}

async function paystack<T>(secret: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...options,
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...options.headers },
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: T };
  if (!response.ok || !payload.status || !payload.data) throw new Error(payload.message ?? "Paystack rejected the operation.");
  return payload.data;
}

export async function createPayoutAccount(env: Cloudflare.Env, session: AdminSession, input: { eventSlug: string; accountName: string; recipientType: "ghipss" | "mobile_money"; bankCode: string; accountNumber: string }) {
  const accountName = input.accountName.trim().slice(0, 120);
  const accountNumber = input.accountNumber.replace(/\s+/gu, "").slice(0, 40);
  const bankCode = input.bankCode.trim().slice(0, 30);
  if (!accountName || !accountNumber || !bankCode || !/^[a-z0-9-]{1,80}$/u.test(input.eventSlug)) throw new Error("Add the verified payout destination details.");
  const recipient = await paystack<{ recipient_code?: string }>(env.PAYSTACK_SECRET_KEY, "/transferrecipient", {
    method: "POST",
    body: JSON.stringify({ type: input.recipientType, name: accountName, account_number: accountNumber, bank_code: bankCode, currency: "GHS" }),
  });
  if (!recipient.recipient_code) throw new Error("Paystack did not return a payout recipient.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO organizer_payout_accounts (id, event_slug, account_name, recipient_type, bank_code, account_number_masked, recipient_code, status, verified_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(id, input.eventSlug, accountName, input.recipientType, bankCode, maskAccount(accountNumber), recipient.recipient_code, now, session.accountId, now).run();
  return { id, accountNumberMasked: maskAccount(accountNumber) };
}

export async function createApprovalRequest(db: D1Database, session: AdminSession, input: { kind: ApprovalRow["kind"]; eventSlug?: string | null; targetId?: string | null; payload: Record<string, unknown> }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO approval_requests (id, kind, event_slug, target_id, payload_json, status, requested_by, requested_by_email, requested_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(id, input.kind, input.eventSlug ?? null, input.targetId ?? null, JSON.stringify(input.payload), session.accountId, session.email, now).run();
  return { id, status: "pending" as const };
}

export async function requestMassRefund(db: D1Database, session: AdminSession, eventSlug: string, reason: string) {
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug) || reason.trim().length < 8) throw new Error("Choose an event and add a clear refund reason.");
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM orders WHERE event_slug = ? AND status IN ('paid', 'requires_refund') AND refunded_amount_minor < total_amount_minor")
    .bind(eventSlug).first<{ count: number }>();
  if (!(count?.count ?? 0)) throw new Error("This event has no refundable paid orders.");
  const approval = await createApprovalRequest(db, session, { kind: "mass_refund", eventSlug, targetId: batchId, payload: { batchId, reason: reason.trim().slice(0, 500) } });
  await db.prepare(`
    INSERT INTO refund_batches (id, event_slug, approval_request_id, reason, status, total_orders, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?)
  `).bind(batchId, eventSlug, approval.id, reason.trim().slice(0, 500), count!.count, session.accountId, now, now).run();
  return { batchId, approvalId: approval.id, totalOrders: count!.count };
}

export async function requestPayout(db: D1Database, session: AdminSession, input: { settlementId: string; payoutAccountId: string; amountMinor?: number }) {
  const settlement = await db.prepare(`
    SELECT id, event_slug AS eventSlug, net_ticket_sales_minor AS netMinor, currency, status
    FROM event_settlements WHERE id = ? LIMIT 1
  `).bind(input.settlementId).first<{ id: string; eventSlug: string; netMinor: number; currency: string; status: string }>();
  const account = await db.prepare("SELECT id FROM organizer_payout_accounts WHERE id = ? AND event_slug = ? AND status = 'active' LIMIT 1")
    .bind(input.payoutAccountId, settlement?.eventSlug ?? "").first<{ id: string }>();
  if (!settlement || !account || settlement.status !== "ready") throw new Error("Choose a reconciled settlement and its verified payout account.");
  const amountMinor = input.amountMinor ?? settlement.netMinor;
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > settlement.netMinor) throw new Error("Choose a payout within the reconciled net amount.");
  const payoutId = crypto.randomUUID();
  const reference = `BCT-PAYOUT-${Date.now().toString(36).toUpperCase()}-${payoutId.slice(0, 6).toUpperCase()}`;
  const approval = await createApprovalRequest(db, session, { kind: "organizer_payout", eventSlug: settlement.eventSlug, targetId: payoutId, payload: { payoutId } });
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO payout_transfers (id, settlement_id, event_slug, payout_account_id, approval_request_id, reference, amount_minor, currency, status, initiated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)
  `).bind(payoutId, settlement.id, settlement.eventSlug, account.id, approval.id, reference, amountMinor, settlement.currency, session.accountId, now, now).run();
  return { payoutId, approvalId: approval.id, reference };
}

export async function decideApproval(env: Cloudflare.Env, session: AdminSession, input: { approvalId: string; decision: "approve" | "reject"; note?: string }) {
  const approval = await env.DB.prepare(`
    SELECT id, kind, event_slug AS eventSlug, target_id AS targetId, payload_json AS payloadJson, requested_by AS requestedBy, status
    FROM approval_requests WHERE id = ? LIMIT 1
  `).bind(input.approvalId).first<ApprovalRow>();
  if (!approval || approval.status !== "pending") throw new Error("This approval is no longer pending.");
  if (!canDecideApproval(session, approval.kind)) throw new Error("This approval belongs to a different role.");
  if (approval.requestedBy === session.accountId) throw new Error("The person who requested this cannot approve it. Two people means two people.");
  const now = new Date().toISOString();
  if (input.decision === "reject") {
    await env.DB.batch([
      env.DB.prepare("UPDATE approval_requests SET status = 'rejected', decided_by = ?, decided_by_email = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'")
        .bind(session.accountId, session.email, now, input.note?.slice(0, 500) ?? null, approval.id),
      approval.kind === "mass_refund" ? env.DB.prepare("UPDATE refund_batches SET status = 'failed', updated_at = ? WHERE id = ?").bind(now, approval.targetId) : env.DB.prepare("SELECT 1"),
      approval.kind === "organizer_payout" ? env.DB.prepare("UPDATE payout_transfers SET status = 'failed', failure_reason = 'Approval rejected', updated_at = ? WHERE id = ?").bind(now, approval.targetId) : env.DB.prepare("SELECT 1"),
    ]);
    return { status: "rejected" as const };
  }
  await env.DB.prepare("UPDATE approval_requests SET status = 'executing', decided_by = ?, decided_by_email = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'pending'")
    .bind(session.accountId, session.email, now, input.note?.slice(0, 500) ?? null, approval.id).run();
  try {
    if (approval.kind === "mass_refund") {
      await env.DB.batch([
        env.DB.prepare("UPDATE refund_batches SET status = 'queued', updated_at = ? WHERE id = ?").bind(now, approval.targetId),
        env.DB.prepare("UPDATE approval_requests SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, approval.id),
      ]);
    } else if (approval.kind === "organizer_payout") {
      const payout = await env.DB.prepare(`
        SELECT payout.id, payout.reference, payout.amount_minor AS amountMinor, payout.currency, account.recipient_code AS recipientCode
        FROM payout_transfers payout JOIN organizer_payout_accounts account ON account.id = payout.payout_account_id
        WHERE payout.id = ? LIMIT 1
      `).bind(approval.targetId).first<{ id: string; reference: string; amountMinor: number; currency: string; recipientCode: string }>();
      if (!payout) throw new Error("Payout record not found.");
      const transfer = await paystack<{ status?: string; transfer_code?: string }>(env.PAYSTACK_SECRET_KEY, "/transfer", {
        method: "POST",
        body: JSON.stringify({ source: "balance", amount: payout.amountMinor, recipient: payout.recipientCode, reason: `BeCore Tickets organiser payout · ${approval.eventSlug}`, reference: payout.reference, currency: payout.currency }),
      });
      await env.DB.batch([
        env.DB.prepare("UPDATE payout_transfers SET status = ?, provider_transfer_code = ?, updated_at = ? WHERE id = ?")
          .bind(transfer.status === "otp" ? "otp" : "pending", transfer.transfer_code ?? null, now, payout.id),
        env.DB.prepare("UPDATE approval_requests SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, approval.id),
      ]);
    } else if (approval.kind === "event_cancellation" && approval.eventSlug) {
      await env.DB.batch([
        env.DB.prepare("UPDATE curated_event_records SET event_state = 'cancelled', updated_at = ? WHERE slug = ?").bind(now, approval.eventSlug),
        env.DB.prepare("UPDATE tickets SET status = 'voided' WHERE event_slug = ? AND status = 'issued'").bind(approval.eventSlug),
        env.DB.prepare("UPDATE approval_requests SET status = 'completed', completed_at = ? WHERE id = ?").bind(now, approval.id),
      ]);
      await notifyEventAttendees(env, approval.eventSlug, { kind: "event_status", title: "This Night is cancelled", body: "Open My Nights for refund status and order-linked support.", url: `/my-nights/${encodeURIComponent(approval.eventSlug)}?view=purchase`, sourceId: `event-cancelled-${approval.id}`, tag: `event-${approval.eventSlug}` });
    }
    return { status: "completed" as const };
  } catch (error) {
    await env.DB.prepare("UPDATE approval_requests SET status = 'failed', failure_reason = ?, completed_at = ? WHERE id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 1000), new Date().toISOString(), approval.id).run();
    throw error;
  }
}

export async function processRefundBatches(env: Cloudflare.Env, limit = 5) {
  if (!env.PAYSTACK_SECRET_KEY) return { processed: 0 };
  const batch = await env.DB.prepare("SELECT id, event_slug AS eventSlug, reason, total_orders AS totalOrders, processed_orders AS processedOrders, failed_orders AS failedOrders FROM refund_batches WHERE status IN ('queued', 'processing') ORDER BY created_at LIMIT 1")
    .first<{ id: string; eventSlug: string; reason: string; totalOrders: number; processedOrders: number; failedOrders: number }>();
  if (!batch) return { processed: 0 };
  await env.DB.prepare("UPDATE refund_batches SET status = 'processing', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), batch.id).run();
  const orders = await env.DB.prepare(`
    SELECT id FROM orders WHERE event_slug = ? AND status IN ('paid', 'requires_refund')
      AND refunded_amount_minor < total_amount_minor
      AND NOT EXISTS (SELECT 1 FROM payment_refunds WHERE batch_id = ? AND payment_refunds.order_id = orders.id)
    ORDER BY paid_at LIMIT ?
  `).bind(batch.eventSlug, batch.id, limit).all<{ id: string }>();
  let processed = 0;
  let failed = 0;
  for (const order of orders.results) {
    try {
      await initiatePaystackRefund(env.DB, { orderId: order.id, actor: "system:approved-mass-refund", reason: batch.reason, secret: env.PAYSTACK_SECRET_KEY, batchId: batch.id });
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  const completed = batch.processedOrders + batch.failedOrders + processed + failed >= batch.totalOrders || orders.results.length === 0;
  await env.DB.prepare(`
    UPDATE refund_batches SET processed_orders = processed_orders + ?, failed_orders = failed_orders + ?,
      status = CASE WHEN ? THEN CASE WHEN failed_orders + ? > 0 THEN 'completed_with_errors' ELSE 'completed' END ELSE 'processing' END,
      updated_at = ?, completed_at = CASE WHEN ? THEN ? ELSE completed_at END WHERE id = ?
  `).bind(processed, failed, completed ? 1 : 0, failed, new Date().toISOString(), completed ? 1 : 0, completed ? new Date().toISOString() : null, batch.id).run();
  return { processed, failed, completed };
}

export async function applyTransferWebhook(db: D1Database, input: { reference: string; status: "success" | "failed" | "reversed"; transferCode?: string | null; failureReason?: string | null }) {
  const now = new Date().toISOString();
  const payout = await db.prepare("SELECT id, settlement_id AS settlementId FROM payout_transfers WHERE reference = ? LIMIT 1").bind(input.reference).first<{ id: string; settlementId: string }>();
  if (!payout) return { updated: false };
  await db.batch([
    db.prepare("UPDATE payout_transfers SET status = ?, provider_transfer_code = COALESCE(?, provider_transfer_code), failure_reason = ?, updated_at = ?, paid_at = CASE WHEN ? = 'success' THEN ? ELSE paid_at END WHERE id = ?")
      .bind(input.status, input.transferCode ?? null, input.failureReason ?? null, now, input.status, now, payout.id),
    db.prepare("UPDATE event_settlements SET status = CASE WHEN ? = 'success' THEN 'paid' WHEN ? IN ('failed', 'reversed') THEN 'held' ELSE status END WHERE id = ?")
      .bind(input.status, input.status, payout.settlementId),
  ]);
  return { updated: true };
}

export async function buildDisputeEvidence(db: D1Database, disputeId: string) {
  const dispute = await db.prepare("SELECT * FROM payment_disputes WHERE id = ? LIMIT 1").bind(disputeId).first<Record<string, unknown>>();
  if (!dispute) throw new Error("Dispute not found.");
  const orderId = String(dispute.order_id ?? "");
  const [order, tickets, checkins, deliveries, consents, support] = await Promise.all([
    db.prepare("SELECT id, reference, event_slug, ticket_type, quantity, total_amount_minor, currency, customer_email, customer_phone, customer_name, status, paid_at FROM orders WHERE id = ?").bind(orderId).first(),
    db.prepare("SELECT id, status, issued_at, checked_in_at, checked_in_gate FROM tickets WHERE order_id = ? ORDER BY admission_number").bind(orderId).all(),
    db.prepare("SELECT action, gate, actor_email, created_at FROM gate_checkin_events WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id = ?) ORDER BY created_at").bind(orderId).all(),
    db.prepare("SELECT kind, recipient, status, provider_id, created_at, updated_at FROM delivery_events WHERE order_id = ? ORDER BY created_at").bind(orderId).all(),
    db.prepare("SELECT policy, version, accepted_at FROM consent_records WHERE subject_type = 'order' AND subject_id = ? ORDER BY accepted_at").bind(orderId).all(),
    db.prepare("SELECT id, kind, subject, status, created_at, updated_at FROM support_cases WHERE order_id = ? ORDER BY created_at").bind(orderId).all(),
  ]);
  return { generatedAt: new Date().toISOString(), dispute, order, tickets: tickets.results, checkins: checkins.results, deliveries: deliveries.results, consents: consents.results, support: support.results };
}

export async function resolvePaystackDispute(secret: string, input: { providerDisputeId: string; resolution: "merchant-accepted" | "declined"; amountMinor?: number; uploadedFilename?: string; evidenceId?: string }) {
  const body: Record<string, string | number> = { resolution: input.resolution };
  if (input.amountMinor) body.amount = input.amountMinor;
  if (input.uploadedFilename) body.uploaded_filename = input.uploadedFilename;
  if (input.evidenceId) body.evidence = input.evidenceId;
  return paystack<Record<string, unknown>>(secret, `/dispute/${encodeURIComponent(input.providerDisputeId)}/resolve`, { method: "PUT", body: JSON.stringify(body) });
}
