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
it('recovers a receipt queued while email configuration was unavailable', async () => {
  const {sendEmail} = await import('../lib/email-delivery');
  const runtime = env as unknown as Cloudflare.Env;
  const originalKey = runtime.RESEND_API_KEY;
  const id = crypto.randomUUID();
  try {
    runtime.RESEND_API_KEY = '';
    const provider = vi.fn(async () => Response.json({id:`provider-${id}`}));
    vi.stubGlobal('fetch',provider);
    expect(await sendEmail({db:env.DB,kind:'payment_confirmation',recipient:'fixture@example.com',subject:'Receipt',text:'Confirmed',html:'<p>Confirmed</p>',idempotencyKey:id,deliveryId:id})).toEqual({sent:false,reason:'not_configured'});
    expect(provider).not.toHaveBeenCalled();
    expect(await env.DB.prepare('SELECT attempt_count AS attempts,next_attempt_at AS next FROM delivery_events WHERE id=?').bind(id).first()).toEqual({attempts:0,next:expect.any(String)});
    runtime.RESEND_API_KEY = originalKey;
    await env.DB.prepare("UPDATE delivery_events SET next_attempt_at='2020-01-01T00:00:00Z' WHERE id=?").bind(id).run();
    await retryFailedDeliveries(runtime);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(id).first()).toEqual({status:'sent'});
  } finally { runtime.RESEND_API_KEY = originalKey; }
});

it('allows an explicit receipt resend without weakening callback deduplication', async () => {
  const {issueRecoveryGrant,sendOrderConfirmation}=await import('../lib/email-delivery');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const order={id,reference:`BCT-${id}`,eventSlug:'the-weekend-braai',customerEmail:'fixture@example.com',customerName:'Fixture Guest',faceAmountMinor:10000,bookingFeeMinor:0,totalAmountMinor:10000,currency:'GHS',quantity:1,paidAt:now};
  const provider=vi.fn(async()=>Response.json({id:crypto.randomUUID()}));
  vi.stubGlobal('fetch',provider);
  await sendOrderConfirmation(env.DB,order,'https://tickets.becoreops.com');
  await sendOrderConfirmation(env.DB,order,'https://tickets.becoreops.com');
  await issueRecoveryGrant({db:env.DB,normalizedEmail:order.customerEmail,origin:'https://tickets.becoreops.com',kind:'payment_confirmation',order,deliveryId:`payment-confirmation-resend/${id}/${crypto.randomUUID()}`});
  expect(provider).toHaveBeenCalledTimes(2);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM delivery_events WHERE order_id=? AND kind='payment_confirmation'").bind(id).first()).toEqual({n:2});
});
