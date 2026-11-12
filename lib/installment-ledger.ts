import { installmentSummary, nextInstallmentMinor } from './installment-policy';

/** Internal only: callers must authenticate the booking owner before reading. */
export async function readInstallmentBalance(db: D1Database, orderId: string) {
  const plan = await db.prepare(`SELECT p.total_minor AS totalMinor,p.step_minor AS stepMinor,
    p.buyer_email AS buyerEmail,p.environment,p.currency,
    COALESCE(SUM(CASE WHEN c.state='confirmed' THEN c.amount_minor ELSE 0 END),0) AS collectedMinor
    FROM installment_plans p LEFT JOIN installment_charges c ON c.order_id=p.order_id
    WHERE p.order_id=? GROUP BY p.order_id`).bind(orderId).first<{
      totalMinor:number;stepMinor:number;buyerEmail:string;environment:string;currency:string;collectedMinor:number;
    }>();
  return plan ? { ...plan, ...installmentSummary(plan.totalMinor,plan.collectedMinor) } : null;
}

/** Reserve exactly one logical charge; no network side effects here.
 * Uncertain provider outcomes remain pending/review and block another charge.
 * The database guard protects the gap between the balance read and insertion.
 */
export async function reserveInstallmentCharge(db:D1Database,input:{orderId:string;buyerEmail:string;id:string;idempotencyHash:string;requestHash:string;choice:'installment'|'balance';checkout?:{origin:string;returnPath:string}}) {
  const existing=await db.prepare(`SELECT id,order_id AS orderId,request_hash AS requestHash,amount_minor AS amountMinor,state
    FROM installment_charges WHERE idempotency_hash=?`).bind(input.idempotencyHash)
    .first<{id:string;orderId:string;requestHash:string;amountMinor:number;state:string}>();
  const balance=await readInstallmentBalance(db,input.orderId);
  if(!balance || balance.buyerEmail!==input.buyerEmail) throw new Error('Booking not available.');
  if(existing){
    if(existing.orderId!==input.orderId || existing.requestHash!==input.requestHash) throw new Error('Payment attempt does not match.');
    return existing;
  }
  const amountMinor=nextInstallmentMinor(balance.totalMinor,balance.collectedMinor,balance.stepMinor,input.choice);
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at)
    SELECT ?,id,?,?,?,'pending',? FROM orders WHERE id=? AND status IN ('payment_pending','part_paid') AND refunded_amount_minor=0
      AND NOT EXISTS(SELECT 1 FROM provider_operation_records r WHERE r.order_id=orders.id AND r.kind='refund' AND r.status IN ('pending','completed'))
      AND NOT EXISTS(SELECT 1 FROM payment_disputes d WHERE d.order_id=orders.id)`)
    .bind(input.id,input.idempotencyHash,input.requestHash,amountMinor,now,input.orderId)];
  if(input.checkout){
    const order=await db.prepare(`SELECT reference,event_slug AS eventSlug,customer_name AS name,customer_email AS email,customer_phone AS phone FROM orders WHERE id=?`)
      .bind(input.orderId).first<{reference:string;eventSlug:string;name:string|null;email:string;phone:string}>();
    const origin=new URL(input.checkout.origin);const target=new URL(input.checkout.returnPath,origin);
    if(!order?.name||origin.protocol!=='https:'||origin.username||origin.password||target.origin!==origin.origin
      ||!((target.pathname==='/payment/return'&&target.searchParams.get('reference')===order.reference)||target.pathname===`/my-nights/${encodeURIComponent(order.eventSlug)}`)) throw new Error('Invalid booking return address.');
    const body=JSON.stringify({type:'checkout',amount:amountMinor,currency:balance.currency,channels:['mobile_money'],recipient:{name:order.name,email:order.email,phone:order.phone},redirect_url:target.toString(),meta:{orderId:input.orderId,installmentChargeId:input.id,reference:order.reference}});
    statements.push(db.prepare(`INSERT INTO installment_checkout_sessions(charge_id,request_json,created_at)
      SELECT id,?,? FROM installment_charges WHERE id=? AND state='pending'`).bind(body,now,input.id));
  }
  const [inserted]=await db.batch(statements);
  if(inserted.meta.changes!==1) throw new Error('This booking needs payment review.');
  return {id:input.id,orderId:input.orderId,requestHash:input.requestHash,amountMinor,state:'pending'};
}

/** Accept only a server-to-server verified result, never browser/webhook payload.
 * Provider HTTP verification must precede this call. Entitlements are deliberately
 * issued separately by the idempotent entitlement reconciler after this commit.
 */
export async function creditVerifiedInstallment(db:D1Database,input:{chargeId:string;providerReference:string;transactionId:string;environment:string;currency:string;amountMinor:number}) {
  if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<1||!input.transactionId||!input.providerReference) throw new Error('Invalid verified payment.');
  const charge=await db.prepare(`SELECT c.order_id AS orderId,c.amount_minor AS amountMinor,c.provider_reference AS providerReference,
    c.provider_transaction_id AS transactionId,c.state,p.currency,p.environment
    FROM installment_charges c JOIN installment_plans p ON p.order_id=c.order_id WHERE c.id=?`).bind(input.chargeId)
    .first<{orderId:string;amountMinor:number;providerReference:string|null;transactionId:string|null;state:string;currency:string;environment:string}>();
  if(!charge || charge.providerReference!==input.providerReference || charge.amountMinor!==input.amountMinor
    ||charge.currency!==input.currency||charge.environment!==input.environment
    ||(charge.transactionId!==null&&charge.transactionId!==input.transactionId)) throw new Error('Verified payment does not match this charge.');
  if(charge.state==='closed_unpaid') throw new Error('Late payment needs reconciliation.');
  await db.prepare(`UPDATE installment_charges SET state='confirmed',provider_transaction_id=?,confirmed_at=COALESCE(confirmed_at,?)
    WHERE id=? AND state IN ('pending','review','confirmed')`).bind(input.transactionId,new Date().toISOString(),input.chargeId).run();
  return readInstallmentBalance(db,charge.orderId);
}
