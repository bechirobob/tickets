import { env } from 'cloudflare:test';
import { expect,it,vi,afterEach } from 'vitest';
import { deliverInstallmentReceipt } from '../lib/installment-receipts';
afterEach(()=>vi.unstubAllGlobals());
it('deposit receipt states balance and no entry; duplicate callbacks queue one delivery',async()=>{
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,payment_environment,status,created_at)
 VALUES(?,?,'event',1,320000,0,320000,'GHS','buyer@example.test','0000000000','mobile_money','seevplus','sandbox','payment_pending','now')`).bind(id,id).run();
 await env.DB.prepare(`INSERT INTO installment_plans VALUES(?,'buyer@example.test','seevplus','sandbox','{}','GHS',320000,100000,'now')`).bind(id).run();
 await env.DB.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,?,?,'request',100000,'pending','now')`).bind(id,id,id).run();
 await env.DB.prepare(`UPDATE installment_charges SET state='confirmed',provider_reference=?,provider_transaction_id=?,confirmed_at='now' WHERE id=?`).bind('PAY-'+id,'TX-'+id,id).run();
 await env.DB.prepare(`UPDATE orders SET status='part_paid' WHERE id=?`).bind(id).run();
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:crypto.randomUUID()})));
 await deliverInstallmentReceipt(env.DB,id);await deliverInstallmentReceipt(env.DB,id);
 const rows=await env.DB.prepare(`SELECT payload_json AS payload FROM delivery_events WHERE order_id=?`).bind(id).all<{payload:string}>();
 expect(rows.results).toHaveLength(1);const payload=JSON.parse(rows.results[0].payload);
 expect(payload.text).toContain('GHS 1000.00');expect(payload.text).toContain('GHS 2200.00');expect(payload.text).toContain('Finish paying before using your entry QR.');
 expect(payload.text).not.toContain('fully paid');
});
