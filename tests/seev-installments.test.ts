import { env } from 'cloudflare:test';
import { afterEach,expect,it,vi } from 'vitest';
import { prepareInstallmentCheckout,createInstallmentCheckout,verifyInstallmentPayment } from '../lib/seev-installments';
const config={...env,SEEV_ENVIRONMENT:'sandbox',SEEV_CHECKOUT_API_KEY:'test-only-key'} as unknown as Cloudflare.Env;
afterEach(()=>vi.unstubAllGlobals());
async function fixture(){
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,payment_provider,payment_environment,status,created_at)
 VALUES(?,?,'event',1,320000,0,320000,'GHS','buyer@example.test','0000000000','Buyer','mobile_money','seevplus','sandbox','payment_pending','now')`).bind(id,id).run();
 await env.DB.prepare(`INSERT INTO installment_plans VALUES(?,'buyer@example.test','seevplus','sandbox','{}','GHS',320000,100000,'now')`).bind(id).run();
 await env.DB.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,?,?,'request',100000,'pending',?)`).bind(id,id,id,new Date().toISOString()).run();
 await prepareInstallmentCheckout(env.DB,{chargeId:id,origin:'https://tickets.becoreops.com',returnPath:`/payment/return?reference=${id}&claim=test`});
 return id;
}
it('child checkout uses stable immutable body/id, buyer and gross amount; retries same checkout',async()=>{
 const id=await fixture();const requests:string[]=[];const ref='PAY-'+id;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
  expect(new Headers(init.headers).get('idempotency-key')).toBe(id);requests.push(String(init.body));
  expect(JSON.parse(String(init.body))).toMatchObject({amount:100000,currency:'GHS',recipient:{email:'buyer@example.test'},meta:{installmentChargeId:id,orderId:id}});
  if(requests.length===1) throw new Error('timeout');
  return Response.json({success:true,data:{reference:ref,checkout_url:`https://pay.seevplus.com/${ref}`,amount:100000,currency:'GHS',env:'sandbox'}});
 }));
 await expect(createInstallmentCheckout(env.DB,id,config)).rejects.toThrow('timeout');
 expect(await createInstallmentCheckout(env.DB,id,config)).toContain(ref);expect(requests[0]).toBe(requests[1]);
 expect(await createInstallmentCheckout(env.DB,id,config)).toContain(ref);expect(requests.length).toBe(2);
});
it('wrong provider amount never credits and stale failure never reverses a confirmed child',async()=>{
 const id=await fixture();const ref='PAY-'+id;
 await env.DB.prepare(`UPDATE installment_charges SET provider_reference=? WHERE id=?`).bind(ref,id).run();
 let amount=100001;let status='completed';
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true,data:{id:'TX-'+id,reference:ref,amount,currency:'GHS',env:'sandbox',status}})));
 await expect(verifyInstallmentPayment(env.DB,id,config)).rejects.toThrow('does not match');
 expect((await env.DB.prepare(`SELECT state FROM installment_charges WHERE id=?`).bind(id).first<{state:string}>())?.state).toBe('pending');
 amount=100000;await verifyInstallmentPayment(env.DB,id,config);status='failed';await verifyInstallmentPayment(env.DB,id,config);
 expect((await env.DB.prepare(`SELECT state FROM installment_charges WHERE id=?`).bind(id).first<{state:string}>())?.state).toBe('confirmed');
});
it('unknown initialization beyond idempotency window is held for review, not retried',async()=>{
 const id=await fixture();
 // Build an aged session directly; updates are prohibited by the immutable request guard.
 const aged='aged-'+id;
 await env.DB.prepare(`UPDATE installment_charges SET state='closed_unpaid' WHERE id=?`).bind(id).run();
 await env.DB.prepare(`INSERT INTO installment_charges(id,order_id,idempotency_hash,request_hash,amount_minor,state,created_at) VALUES(?,?,?,'request',100000,'pending','2000-01-01T00:00:00Z')`).bind(aged,id,aged).run();
 await env.DB.prepare(`INSERT INTO installment_checkout_sessions(charge_id,request_json,created_at) VALUES(?,'{}','2000-01-01T00:00:00Z')`).bind(aged).run();
 const network=vi.fn();vi.stubGlobal('fetch',network);
 await expect(createInstallmentCheckout(env.DB,aged,config)).rejects.toThrow('provider review');expect(network).not.toHaveBeenCalled();
 expect((await env.DB.prepare(`SELECT state FROM installment_charges WHERE id=?`).bind(aged).first<{state:string}>())?.state).toBe('review');
});
