/** Reconciles ticket/Room entitlement from verified ledger credits only.
 * A deposited booking is never marked paid; gate credentials remain paid-only.
 * Safe to retry after a webhook/poll crash between credit and entitlement work.
 */
export async function fulfillInstallmentEntitlements(db: D1Database, orderId: string) {
  const order = await db.prepare(`SELECT o.quantity FROM orders o JOIN installment_plans p ON p.order_id=o.id WHERE o.id=?`).bind(orderId).first<{quantity:number}>();
  if (!order) return { result: 'unknown_order' as const, orderId };
  const now=new Date().toISOString();
  const collected=`COALESCE((SELECT SUM(c.amount_minor) FROM installment_charges c WHERE c.order_id=orders.id AND c.state='confirmed'),0)`;
  const statements: D1PreparedStatement[]=[
    db.prepare(`UPDATE inventory_reservations SET status='consumed',updated_at=?
      WHERE order_id=? AND status IN ('held','expired','released')
      AND EXISTS(SELECT 1 FROM orders WHERE id=inventory_reservations.order_id AND status IN ('payment_pending','expired','failed') AND ${collected}>0
        AND (coupon_id IS NULL OR EXISTS(SELECT 1 FROM event_coupons c WHERE c.id=orders.coupon_id AND
          (SELECT COUNT(*) FROM orders used WHERE used.coupon_id=c.id AND used.id<>orders.id AND (used.status IN ('paid','part_paid','refund_pending','refunded','disputed') OR (used.status='payment_pending' AND used.reservation_expires_at>?)))<c.max_uses)))
      AND EXISTS(SELECT 1 FROM event_ticket_tiers tier JOIN curated_event_records e ON e.slug=tier.event_slug
        WHERE tier.id=inventory_reservations.ticket_tier_id AND e.removed_at IS NULL AND e.event_state NOT IN ('cancelled','postponed')
        AND (SELECT COALESCE(SUM(other.admission_count),0) FROM inventory_reservations other WHERE other.ticket_tier_id=tier.id AND other.order_id<>inventory_reservations.order_id
          AND (other.status='consumed' OR (other.status='held' AND other.expires_at>?)))+inventory_reservations.admission_count<=tier.capacity_admissions)`)
      .bind(now,orderId,now,now),
    db.prepare(`UPDATE orders SET status=CASE
      WHEN EXISTS(SELECT 1 FROM provider_operation_records f WHERE f.order_id=orders.id AND f.kind='refund' AND f.status IN ('pending','completed')) OR refunded_amount_minor>0 OR EXISTS(SELECT 1 FROM payment_disputes d WHERE d.order_id=orders.id)
        OR NOT EXISTS(SELECT 1 FROM curated_event_records e WHERE e.slug=orders.event_slug AND e.removed_at IS NULL AND e.event_state NOT IN ('cancelled','postponed'))
        OR NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_id=orders.id AND r.status='consumed') THEN 'requires_refund'
      WHEN ${collected}=total_amount_minor THEN 'paid' ELSE 'part_paid' END,
      payment_verified_at=?,payment_updated_at=?,paid_at=CASE WHEN ${collected}=total_amount_minor THEN COALESCE(paid_at,?) ELSE NULL END
      WHERE id=? AND status IN ('payment_pending','expired','failed','part_paid','paid') AND ${collected}>0 AND ${collected}<=total_amount_minor`)
      .bind(now,now,now,orderId),
    db.prepare(`UPDATE inventory_reservations SET status='released',updated_at=? WHERE order_id=? AND status IN ('held','expired','consumed')
      AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='requires_refund')`).bind(now,orderId,orderId),
    db.prepare(`UPDATE tickets SET status='voided' WHERE order_id=? AND status='issued' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='requires_refund')`).bind(orderId,orderId),
  ];
  for(let admission=1;admission<=order.quantity;admission++){
    const id=crypto.randomUUID();
    statements.push(db.prepare(`INSERT OR IGNORE INTO tickets(id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at)
      SELECT ?,id,event_slug,ticket_type,?,?,'issued',? FROM orders WHERE id=? AND status IN ('part_paid','paid')
      AND EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_id=orders.id AND r.status='consumed')`).bind(id,admission,`unissued-${id}`,now,orderId));
  }
  statements.push(db.prepare(`INSERT OR IGNORE INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at)
    SELECT t.id,o.checkout_attendee_id,'checkout:'||o.id,'active',? FROM tickets t JOIN orders o ON o.id=t.order_id
    JOIN attendee_profiles p ON p.id=o.checkout_attendee_id AND p.status='active'
    WHERE o.id=? AND o.status IN ('part_paid','paid') AND t.status IN ('issued','checked_in')`).bind(now,orderId));
  await db.batch(statements);
  const current=await db.prepare('SELECT status FROM orders WHERE id=?').bind(orderId).first<{status:string}>();
  const result=current?.status==='paid'?'paid':current?.status==='part_paid'?'part_paid':current?.status==='requires_refund'?'requires_refund':'not_fulfilled';
  return {result,orderId} as {result:'paid'|'part_paid'|'requires_refund'|'not_fulfilled';orderId:string};
}
