import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { creditVerifiedInstallment,readInstallmentBalance,reserveInstallmentCharge } from '../lib/installment-ledger';
it('D1 preserves buyer, exact child verification and repeated confirmation',async()=>{
 const id=crypto.randomUUID();const email='buyer@example.test';
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,payment_environment,status,created_at)
 VALUES(?,?,'fixture',1,320000,0,320000,'GHS',?,'0000000000','mobile_money','seevplus','sandbox','payment_pending','now')`).bind(id,id,email).run();
 await env.DB.prepare(`INSERT INTO installment_plans VALUES(?,?,'seevplus','sandbox','{}','GHS',320000,100000,'now')`).bind(id,email).run();
 const request={orderId:id,buyerEmail:email,id:'charge-'+id,idempotencyHash:id,requestHash:'request',choice:'installment' as const};
 await expect(reserveInstallmentCharge(env.DB,{...request,buyerEmail:'other@example.test'})).rejects.toThrow('not available');
 const first=await reserveInstallmentCharge(env.DB,request);expect(first.amountMinor).toBe(100000);
 expect((await reserveInstallmentCharge(env.DB,request)).id).toBe(first.id);
 await expect(reserveInstallmentCharge(env.DB,{...request,id:crypto.randomUUID(),idempotencyHash:crypto.randomUUID()})).rejects.toThrow();
 await env.DB.prepare(`UPDATE installment_charges SET provider_reference=? WHERE id=?`).bind('PAY-'+id,first.id).run();
 const verified={chargeId:first.id,providerReference:'PAY-'+id,transactionId:'TX-'+id,environment:'sandbox',currency:'GHS',amountMinor:100000};
 for(const mismatch of [{amountMinor:99999},{environment:'production'},{currency:'USD'},{providerReference:'PAY-wrong'}]) await expect(creditVerifiedInstallment(env.DB,{...verified,...mismatch})).rejects.toThrow('does not match');
 await creditVerifiedInstallment(env.DB,verified);await creditVerifiedInstallment(env.DB,verified);
 expect(await readInstallmentBalance(env.DB,id)).toMatchObject({collectedMinor:100000,balanceMinor:220000,roomEligible:true,admissionEligible:false});
 const last=await reserveInstallmentCharge(env.DB,{...request,id:'last-'+id,idempotencyHash:'last-'+id,requestHash:'balance',choice:'balance'});
 expect(last.amountMinor).toBe(220000);
});
