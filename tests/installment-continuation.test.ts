import {env} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {GET,POST} from '../app/api/payments/installments/route';
import {hashToken} from '../lib/attendee-auth';
async function identity(email:string,verified=true){
 const id=crypto.randomUUID(),token=crypto.randomUUID(),now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO attendee_profiles(id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES(?,?,'Guest',?,'active',?,?)`).bind(id,email,verified?now:null,now,now).run();
 await env.DB.prepare(`INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)`).bind(id,id,await hashToken(token),new Date(Date.now()+86400000).toISOString(),now,now).run();return `bct_attendee=${token}`;
}
async function plan(){
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,payment_environment,status,created_at)
 VALUES(?,?,'fixture',1,320000,0,320000,'GHS','buyer@example.test','0000000000','mobile_money','seevplus','sandbox','payment_pending','now')`).bind(id,id).run();
 await env.DB.prepare(`INSERT INTO installment_plans VALUES(?,'buyer@example.test','seevplus','sandbox','{}','GHS',320000,100000,'now')`).bind(id).run();return id;
}
it('only verified original buyer may read an installment balance',async()=>{
 const id=await plan(),other=await identity('other@example.test'),owner=await identity('buyer@example.test');
 const request=(cookie?:string)=>new Request(`https://tickets.becoreops.com/api/payments/installments?orderId=${id}`,{headers:cookie?{cookie}:{}});
 expect((await GET(request())).status).toBe(401);expect((await GET(request(other))).status).toBe(404);
 const response=await GET(request(owner));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({balance:{collectedMinor:0,balanceMinor:320000,stepMinor:100000}});
});
it('unverified checkout identity and wrong-owner requests cannot create another payment',async()=>{
 const id=await plan(),unverified=await identity('buyer@example.test',false),other=await identity('second-other@example.test');
 const request=(cookie:string)=>new Request('https://tickets.becoreops.com/api/payments/installments',{method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json',cookie,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({orderId:id,choice:'balance'})});
 expect((await POST(request(unverified))).status).toBe(404);expect((await POST(request(other))).status).toBe(404);
 expect(await env.DB.prepare(`SELECT id FROM installment_charges WHERE order_id=?`).bind(id).first()).toBeNull();
});
it('an exact checkout-claim session can read its balance without taking ownership of other bookings',async()=>{
 const id=await plan(),otherOrder=await plan(),cookie=await identity('buyer@example.test',false),token=cookie.split('=')[1];
 const session=await env.DB.prepare(`SELECT id FROM attendee_sessions WHERE token_hash=?`).bind(await hashToken(token)).first<{id:string}>();
 await env.DB.prepare(`INSERT INTO order_access_grants(order_id,token_hash,expires_at,created_at,claimed_at,claimed_session_id) VALUES(?,?,?,'now','now',?)`).bind(id,crypto.randomUUID(),new Date(Date.now()+86400000).toISOString(),session!.id).run();
 const read=(orderId:string)=>GET(new Request(`https://tickets.becoreops.com/api/payments/installments?orderId=${orderId}`,{headers:{cookie}}));
 expect((await read(id)).status).toBe(200);expect((await read(otherOrder)).status).toBe(404);
});
