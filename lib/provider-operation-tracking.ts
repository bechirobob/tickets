import { hasPermission, type AdminSession } from "./admin-session";

export type ProviderCase = {
  id: string; orderId: string; provider: "paystack" | "seevplus"; kind: "refund" | "settlement";
  status: "pending" | "completed" | "closed_unpaid"; version: number; caseReference: string; amountMinor: number | null;
  currency: string; evidenceAt: string | null; recordedAt: string;
};
const columns = `id, order_id AS orderId, provider, kind, status, version, case_reference AS caseReference,
  amount_minor AS amountMinor, currency, evidence_at AS evidenceAt, recorded_at AS recordedAt`;

export class ProviderCaseError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export async function readProviderCases(db: D1Database, orderIds: string[]): Promise<ProviderCase[]> {
  if (!orderIds.length) return [];
  const ids = [...new Set(orderIds)].slice(0, 100);
  const result = await db.prepare(`SELECT ${columns} FROM provider_operation_records r
    WHERE r.order_id IN (${ids.map(() => "?").join(",")})
      AND NOT EXISTS (SELECT 1 FROM provider_operation_records n WHERE n.order_id=r.order_id AND n.kind=r.kind AND n.version>r.version)
    ORDER BY r.recorded_at DESC`).bind(...ids).all<ProviderCase>();
  return result.results;
}

export async function recordProviderCase(db: D1Database, session: AdminSession, input: Record<string, unknown>) {
  if (!hasPermission(session, "orders.manage")) throw new ProviderCaseError("Finance access is required.", 403);
  const { operationId, orderId, kind, status, expectedVersion, caseReference, amountMinor, evidenceAt, confirmed, confirmedNoRefund } = input;
  if (typeof operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
    || typeof orderId !== "string" || !orderId || orderId.length > 160
    || (kind !== "refund" && kind !== "settlement") || (status !== "pending" && status !== "completed" && status !== "closed_unpaid")
    || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0 || Number(expectedVersion) > 100_000
    || typeof caseReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{1,119}$/.test(caseReference.trim())
    || confirmed !== true) throw new ProviderCaseError("Check the case details and confirm you checked the provider record.");
  if (status === "closed_unpaid" && (kind !== "refund" || confirmedNoRefund !== true))
    throw new ProviderCaseError("Confirm in the provider record that no refund was made for this pending case.");
  const reference = caseReference.trim();
  const amount = kind === "refund" ? amountMinor : null;
  if (kind === "refund" && (!Number.isSafeInteger(amount) || Number(amount) < 1)) throw new ProviderCaseError("Enter a valid refund amount.");
  if (kind === "settlement" && amountMinor != null) throw new ProviderCaseError("Settlement evidence does not use the checkout amount.");
  const now = new Date().toISOString();
  const evidence = status === "completed" && typeof evidenceAt === "string" ? evidenceAt : null;
  if (status === "completed" && (!evidence || !/^\d{4}-\d{2}-\d{2}T/.test(evidence)
    || !Number.isFinite(Date.parse(evidence)) || Date.parse(evidence) > Date.now() + 60_000))
    throw new ProviderCaseError("Enter the completed date shown in the provider record.");
  if (status !== "completed" && evidenceAt != null && evidenceAt !== "") throw new ProviderCaseError("Only completed cases can have a completed date.");
  const normalizedEvidence = evidence ? new Date(evidence).toISOString() : null;
  const order = await db.prepare(`SELECT payment_provider AS provider, currency, total_amount_minor AS total,
    refunded_amount_minor AS refunded, payment_verified_at AS verifiedAt, created_at AS createdAt, status FROM orders WHERE id=?`)
    .bind(orderId).first<{ provider: string; currency: string; total: number; refunded: number; verifiedAt: string | null; createdAt: string; status: string }>();
  if (!order) throw new ProviderCaseError("Order not found.", 404);
  if (!["paystack", "seevplus"].includes(order.provider) || !order.verifiedAt || !["paid", "requires_refund", "refund_pending", "refunded", "disputed"].includes(order.status))
    throw new ProviderCaseError("Only verified paid-provider orders can have a provider case.");
  if (normalizedEvidence && normalizedEvidence < order.createdAt) throw new ProviderCaseError("The completed date is before this order.");
  // A case records external evidence only. It never changes payment totals, ticket
  // validity, settlement balances or provider state.
  const existing = await db.prepare(`SELECT ${columns} FROM provider_operation_records WHERE id=?`).bind(operationId).first<ProviderCase>();
  if (existing) {
    if (existing.orderId === orderId && existing.kind === kind && existing.status === status
      && existing.version === Number(expectedVersion) + 1 && existing.caseReference === reference
      && existing.amountMinor === amount && existing.evidenceAt === normalizedEvidence) return { result: "provider_case_recorded", case: existing };
    throw new ProviderCaseError("This submission was already used for different details.", 409);
  }
  if (kind === "refund" && Number(amount) > order.total - order.refunded) throw new ProviderCaseError("The external refund exceeds the amount not already refunded by the provider.");
  if (kind === "refund" && status !== "completed" &&
    await db.prepare("SELECT id FROM provider_operation_records WHERE order_id=? AND kind='refund' AND status='completed' LIMIT 1").bind(orderId).first())
    throw new ProviderCaseError("Completed refund evidence needs finance review; it cannot be reopened or closed as unpaid.", 409);
  if (status === "closed_unpaid") {
    const previous = (await readProviderCases(db, [orderId])).find(item => item.kind === "refund");
    if (!previous || previous.status !== "pending" || previous.version !== expectedVersion
      || previous.caseReference !== reference || previous.amountMinor !== amount)
      throw new ProviderCaseError("Close only the current pending case, keeping its reference and amount. Refresh orders first.", 409);
  }
  const transitionGuard = kind === "refund" && status !== "completed"
    ? "AND NOT EXISTS (SELECT 1 FROM provider_operation_records r WHERE r.order_id=orders.id AND r.kind='refund' AND r.status='completed')" : "";
  const closureGuard = status === "closed_unpaid"
    ? "AND EXISTS (SELECT 1 FROM provider_operation_records r WHERE r.order_id=orders.id AND r.kind='refund' AND r.status='pending' AND r.version=? AND r.case_reference=? AND r.amount_minor=?)" : "";
  const version = Number(expectedVersion) + 1;
  const conflict = "The case or provider refund changed. Refresh orders and check the provider before trying again.";
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO provider_operation_records
        (id,order_id,provider,kind,status,version,case_reference,amount_minor,currency,evidence_at,recorded_by,recorded_at)
        SELECT ?,id,payment_provider,?,?,?,?,?,currency,?,?,? FROM orders
        WHERE id=? AND payment_provider=? AND payment_verified_at IS NOT NULL
          AND (?=(SELECT COALESCE(MAX(version),0) FROM provider_operation_records WHERE order_id=orders.id AND kind=?))
          AND (?<>'refund' OR (
            ?<=total_amount_minor-refunded_amount_minor
            AND NOT EXISTS (SELECT 1 FROM payment_refunds WHERE order_id=orders.id AND status IN ('pending','processing'))))
          ${transitionGuard} ${closureGuard}`)
        .bind(operationId,kind,status,version,reference,amount,normalizedEvidence,session.accountId ?? session.email,now,
          orderId,order.provider,expectedVersion,kind,kind,amount,...(status === "closed_unpaid" ? [expectedVersion,reference,amount] : [])),
      db.prepare(`INSERT INTO operational_audit_events
        (id,actor_account_id,actor_email,actor_role,action,target_type,target_id,outcome,detail,request_id,created_at)
        SELECT ?,?,?,?,'payments.provider_case_recorded','order',order_id,'success',?,?,?
        FROM provider_operation_records WHERE id=?`)
        .bind("provider-case/" + operationId,session.accountId ?? null,session.email,session.role,
          JSON.stringify({ kind,status,version,provider:order.provider }),operationId,now,operationId),
    ]);
    if (!results[0].meta.changes) throw new ProviderCaseError(conflict, 409);
  } catch (error) {
    if (error instanceof ProviderCaseError) throw error;
    // Unique version and audit IDs make concurrent submissions fail atomically.
    if (/UNIQUE constraint failed/.test(String(error))) throw new ProviderCaseError(conflict, 409);
    throw error;
  }
  const recorded = await db.prepare(`SELECT ${columns} FROM provider_operation_records WHERE id=?`).bind(operationId).first<ProviderCase>();
  return { result: "provider_case_recorded", case: recorded };
}
