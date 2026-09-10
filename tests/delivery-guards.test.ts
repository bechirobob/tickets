import {env} from 'cloudflare:test';
import {afterEach,expect,it,vi} from 'vitest';
import {applyDeliveryWebhook,retryFailedDeliveries} from '../lib/email-delivery';
import {paystackAvailable} from '../lib/paystack-environment';
afterEach(()=>vi.unstubAllGlobals());
it('retries a lost email response with the original key and one worker claim',async()=>{
 const id=crypto.randomUUID(),key=`recovery/${id}`;
 await env.DB.prepare("INSERT INTO delivery_events (id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at) VALUES (?,'ticket_recovery','fixture@example.com','failed',1,?,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')").bind(id,JSON.stringify({subject:'Tickets',text:'Your tickets',html:'<p>Your tickets</p>',idempotencyKey:key})).run();
 const provider=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(new Headers(init?.headers).get('idempotency-key')).toBe(key);return Response.json({id:'delivery-guard-provider'});});vi.stubGlobal('fetch',provider);
 await Promise.all([retryFailedDeliveries(env),retryFailedDeliveries(env)]);expect(provider).toHaveBeenCalledTimes(1);
 await applyDeliveryWebhook(env.DB,{providerId:'delivery-guard-provider',type:'email.delivered',eventAt:'2026-09-10T12:00:00Z'});
 await applyDeliveryWebhook(env.DB,{providerId:'delivery-guard-provider',type:'email.delivery_delayed',eventAt:'2026-09-10T11:00:00Z'});
 await applyDeliveryWebhook(env.DB,{providerId:'delivery-guard-provider',type:'email.sent',eventAt:'2026-09-10T13:00:00Z'});
 expect(await env.DB.prepare('SELECT status,next_attempt_at FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'delivered',next_attempt_at:null});
});
it('offers real production checkout only with live credentials',()=>{
 const production={ENVIRONMENT:'production',PAYSTACK_SECRET_KEY:'sk_test_fixture'};
 expect(paystackAvailable(production,false)).toBe(false);expect(paystackAvailable(production,true)).toBe(true);
 expect(paystackAvailable({...production,PAYSTACK_SECRET_KEY:'sk_live_fixture'},false)).toBe(true);
 expect(paystackAvailable({...production,PAYSTACK_SECRET_KEY:'sk_live_fixture'},true)).toBe(false);
});
