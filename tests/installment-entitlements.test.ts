import { env } from "cloudflare:test";
import { expect,it } from "vitest";
import { hashToken } from "../lib/attendee-auth";
import { fulfillInstallmentEntitlements } from "../lib/installment-entitlements";
import { expireReservations, fulfillVerifiedPayment } from "../lib/payment-operations";
async function seedPendingOrder(suffix: string, quantity = 2, capacity = 10) {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const eventSlug = `payment-ops-${suffix}`;
  const tierId = `tier-${suffix}`;
  const orderId = `order-${suffix}`;
  const reference = `BCT-OPS-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO curated_event_records (
        id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe,
        price_from_minor, capacity, event_state, image_url, curation_note, status,
        published_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'Payment Test', 'Test Venue', 'Accra', ?, ?, 'Late night',
        10000, ?, 'on_sale', 'https://example.com/test.jpg',
        'A valid customer-facing note for payment operation tests.', 'published', ?, ?, ?)
    `).bind(`event-${suffix}`, `submission-${suffix}`, eventSlug, new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() + 90_000_000).toISOString(), capacity, now, now, now),
    env.DB.prepare(`
      INSERT INTO event_ticket_tiers (
        id, event_slug, code, name, description, price_minor, admissions_per_unit,
        capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, 'general', 'General', 'One admission', 10000, 1, ?, 10, 'available', 0, ?, ?)
    `).bind(tierId, eventSlug, capacity, now, now),
    env.DB.prepare(`
      INSERT INTO orders (
        id, reference, event_slug, ticket_type, ticket_tier_id, unit_quantity, quantity,
        face_amount_minor, booking_fee_minor, total_amount_minor, currency,
        customer_email, customer_phone, customer_name, payment_channel, status,
        reservation_expires_at, created_at
      ) VALUES (?, ?, ?, 'general', ?, ?, ?, ?, 0, ?, 'GHS', ?, '233000000000',
        'Payment Guest', 'mobile_money:mtn', 'payment_pending', ?, ?)
    `).bind(orderId, reference, eventSlug, tierId, quantity, quantity, quantity * 10_000, quantity * 10_000, `${suffix}@example.com`, future, now),
    env.DB.prepare(`
      INSERT INTO inventory_reservations (
        order_id, event_slug, ticket_tier_id, unit_quantity, admission_count,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?)
    `).bind(orderId, eventSlug, tierId, quantity, quantity, future, now, now),
    env.DB.prepare(`INSERT INTO order_access_grants (order_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`)
      .bind(orderId, await hashToken(`claim-${suffix}`), future, now),
  ]);
  return { orderId, reference, eventSlug, amount: quantity * 10_000 };
}


async function plan() {
 const suffix=crypto.randomUUID();const o=await seedPendingOrder(suffix,1);
 await env.DB.prepare("UPDATE orders SET payment_provider='seevplus',payment_environment='sandbox' WHERE id=?").bind(o.orderId).run();
 await env.DB.prepare("INSERT INTO installment_plans VALUES(?,?,'seevplus','sandbox','{}','GHS',10000,4000,'now')").bind(o.orderId,suffix+'@example.com').run();
 return o;
}
async function credit(orderId:string,amount:number){
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,?,?,'request',?,'pending','now')").bind(id,orderId,id,amount).run();
 await env.DB.prepare("UPDATE installment_charges SET state='confirmed',provider_reference=?,provider_transaction_id=?,confirmed_at='now' WHERE id=?").bind('PAY-'+id,'TX-'+id,id).run();
}
it('deposit retains capacity and same tickets; final payment alone enables paid gate state',async()=>{
 const o=await plan();await credit(o.orderId,4000);
 expect((await fulfillInstallmentEntitlements(env.DB,o.orderId)).result).toBe('part_paid');
 const ticket=await env.DB.prepare('SELECT id,qr_token_hash AS hash FROM tickets WHERE order_id=?').bind(o.orderId).first<{id:string;hash:string}>();
 expect(ticket?.hash).toMatch(/^unissued-/);
 await expireReservations(env.DB,new Date(Date.now()+86400000).toISOString());
 expect(await env.DB.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').bind(o.orderId).first()).toEqual({status:'consumed'});
 await fulfillInstallmentEntitlements(env.DB,o.orderId);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE order_id=?').bind(o.orderId).first<{n:number}>())?.n).toBe(1);
 await credit(o.orderId,6000);expect((await fulfillInstallmentEntitlements(env.DB,o.orderId)).result).toBe('paid');
 expect((await env.DB.prepare('SELECT id FROM tickets WHERE order_id=?').bind(o.orderId).first())?.id).toBe(ticket?.id);
});
it('cancellation after deposit voids issued ticket without admitting',async()=>{
 const o=await plan();await credit(o.orderId,4000);await fulfillInstallmentEntitlements(env.DB,o.orderId);
 await env.DB.prepare("UPDATE curated_event_records SET event_state='cancelled' WHERE slug=?").bind(o.eventSlug).run();
 expect((await fulfillInstallmentEntitlements(env.DB,o.orderId)).result).toBe('requires_refund');
 expect((await env.DB.prepare('SELECT status FROM tickets WHERE order_id=?').bind(o.orderId).first())?.status).toBe('voided');
});
it('legacy single-payment fulfillment cannot bypass ledger',async()=>{
 const o=await plan();const r=await fulfillVerifiedPayment(env.DB,{id:'wrong-path',reference:o.reference,provider:'seevplus',providerReference:'PAY-x',status:'success',amount:10000,currency:'GHS',paidAt:null,channel:null,gatewayResponse:null});
 expect(r.result).toBe('not_fulfilled');
});
it('deposit holder can enter Room and see ticket, but receives no admission credential',async()=>{
 const { readAttendeeRoomAccess }=await import('../lib/attendee-auth');
 const { POST:tickets }=await import('../app/api/customer/tickets/route');
 const o=await plan();const user=crypto.randomUUID();const token=crypto.randomUUID();const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES(?,'room@example.test','Guest','active',?,?)`).bind(user,now,now).run();
 await env.DB.prepare(`INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)`).bind(user,user,await hashToken(token),new Date(Date.now()+86400000).toISOString(),now,now).run();
 await env.DB.prepare('UPDATE orders SET checkout_attendee_id=? WHERE id=?').bind(user,o.orderId).run();
 await credit(o.orderId,4000);await fulfillInstallmentEntitlements(env.DB,o.orderId);
 const cookie='bct_attendee='+token;
 expect((await readAttendeeRoomAccess(env.DB,cookie,o.eventSlug))?.attendeeId).toBe(user);
 const response=await tickets(new Request('https://tickets.becoreops.com/api/customer/tickets',{method:'POST',headers:{origin:'https://tickets.becoreops.com',cookie}}));
 expect(response.status).toBe(200);
 const data=await response.json() as {orders:Array<{roomAccess:boolean;tickets:Array<{status:string;qrPayload:string|null}>}>};
 expect(data.orders[0].roomAccess).toBe(true);expect(data.orders[0].tickets[0]).toMatchObject({status:'balance_due',qrPayload:null});
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM ticket_gate_credentials WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id=?)').bind(o.orderId).first<{n:number}>())?.n).toBe(0);
});
it('resumes only the same pending installment checkout while recovery lease is held',async()=>{
 const { POST:claim }=await import('../app/api/customer/session/route');
 const o=await plan();const chargeId=crypto.randomUUID();
 const originalClaim='claim-'+o.orderId.slice('order-'.length);
 await env.DB.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,?,?,'request',4000,'pending',?)`).bind(chargeId,o.orderId,chargeId,new Date().toISOString()).run();
 await env.DB.prepare(`UPDATE installment_charges SET provider_reference='PAY-resume' WHERE id=?`).bind(chargeId).run();
 await env.DB.prepare(`INSERT INTO installment_checkout_sessions(charge_id,request_json,checkout_url,created_at,lease_until) VALUES(?,'{}','https://pay.seevplus.com/PAY-resume',?,?)`).bind(chargeId,new Date().toISOString(),new Date(Date.now()+60000).toISOString()).run();
 const runtime=env as unknown as Cloudflare.Env;runtime.SEEV_ENVIRONMENT='sandbox';
 const request=()=>new Request('https://tickets.becoreops.com/api/customer/session',{method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json'},body:JSON.stringify({reference:o.reference,claim:originalClaim,resumeCheckout:true})});
 try{
  expect(await (await claim(request())).json()).toMatchObject({pending:true,authorizationUrl:'https://pay.seevplus.com/PAY-resume'});
  await env.DB.prepare(`UPDATE installment_charges SET state='review' WHERE id=?`).bind(chargeId).run();
  expect(await (await claim(request())).json()).toEqual({pending:true});
 }finally{delete runtime.SEEV_ENVIRONMENT;}
});
it('external refund evidence prevents remaining payments from unlocking admission',async()=>{
 const o=await plan();await credit(o.orderId,4000);await fulfillInstallmentEntitlements(env.DB,o.orderId);
 await env.DB.prepare(`INSERT INTO provider_operation_records(id,order_id,provider,kind,status,version,case_reference,amount_minor,currency,evidence_at,recorded_by,recorded_at)
 VALUES(?,?,'seevplus','refund','completed',1,'external-refund',4000,'GHS','now','finance','now')`).bind(crypto.randomUUID(),o.orderId).run();
 await credit(o.orderId,6000);
 expect((await fulfillInstallmentEntitlements(env.DB,o.orderId)).result).toBe('requires_refund');
 expect((await env.DB.prepare('SELECT status FROM tickets WHERE order_id=?').bind(o.orderId).first())?.status).toBe('voided');
});
