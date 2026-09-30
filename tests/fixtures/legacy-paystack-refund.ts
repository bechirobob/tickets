// Exact legacy refund implementation from live revision 51f414132da8c41e6d6583fdfa76e709ae7516e8.
// Retained only to verify the database guard survives a binary rollback.
import { applyRefundWebhook } from "../../lib/payment-operations";

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
