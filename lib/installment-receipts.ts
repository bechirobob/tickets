import { sendEmail } from './email-delivery';
import { customerEmail,emailDetails,emailParagraph } from './customer-email';
/** One durable delivery per confirmed charge; generic full-payment copy is never reused. */
export async function deliverInstallmentReceipt(db:D1Database,chargeId:string){
 const charge=await db.prepare(`SELECT c.id,c.order_id AS orderId,c.amount_minor AS amountMinor,o.customer_email AS email,
 o.event_slug AS eventSlug,o.reference,p.total_minor AS totalMinor,
 (SELECT COALESCE(SUM(paid.amount_minor),0) FROM installment_charges paid WHERE paid.order_id=c.order_id AND paid.state='confirmed') AS collectedMinor,
 o.status FROM installment_charges c JOIN installment_plans p ON p.order_id=c.order_id JOIN orders o ON o.id=c.order_id
 WHERE c.id=? AND c.state='confirmed' AND o.status IN ('part_paid','paid')`).bind(chargeId)
 .first<{id:string;orderId:string;amountMinor:number;email:string;eventSlug:string;reference:string;totalMinor:number;collectedMinor:number;status:string}>();
 if(!charge)return;
 const balance=charge.totalMinor-charge.collectedMinor;
 const format=(value:number)=>`GHS ${(value/100).toFixed(2)}`;
 const text=balance>0?'Your ticket and Room are ready. Finish paying before using your entry QR.':'Your booking is fully paid. Your entry QR is ready in My Nights.';
 const url=`https://tickets.becoreops.com/my-nights/${encodeURIComponent(charge.eventSlug)}`;
 return sendEmail({db,kind:'installment_receipt',recipient:charge.email,orderId:charge.orderId,
 deliveryId:`installment-receipt/${charge.id}`,idempotencyKey:`installment-receipt/${charge.id}`,
 subject:balance>0?'Payment received. Your ticket is saved.':'Paid in full. Your ticket is ready.',
 html:customerEmail({title:'Payment received',preheader:`${format(charge.amountMinor)} received. ${format(balance)} remaining.`,
 body:emailParagraph(text)+emailDetails([{label:'Booking',value:charge.reference},{label:'This payment',value:format(charge.amountMinor)},{label:'Total paid',value:format(charge.collectedMinor)},{label:'Balance',value:format(balance)}]),
 action:{label:'Open My Night',url}}),
 text:`${text}\nBooking: ${charge.reference}\nThis payment: ${format(charge.amountMinor)}\nTotal paid: ${format(charge.collectedMinor)}\nBalance: ${format(balance)}\n${url}`});
}
export async function recoverInstallmentReceipts(db:D1Database,limit=20){
 const rows=await db.prepare(`SELECT c.id FROM installment_charges c JOIN orders o ON o.id=c.order_id
 WHERE c.state='confirmed' AND o.status IN ('part_paid','paid')
 AND NOT EXISTS(SELECT 1 FROM delivery_events d WHERE d.id='installment-receipt/'||c.id) ORDER BY c.confirmed_at LIMIT ?`).bind(limit).all<{id:string}>();
 for(const row of rows.results)await deliverInstallmentReceipt(db,row.id);
}
