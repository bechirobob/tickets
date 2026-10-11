import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reconcileVpsDeliveries, sendTransactional, transactionalConfigured, transactionalProvider } from '../lib/transactional-email';
import { retryFailedDeliveries, sendEmail } from '../lib/email-delivery';

const message = { recipient: 'fixture@example.com', subject: 'Your tickets', html: '<p>Your tickets</p>', text: 'Your tickets', idempotencyKey: 'receipt/fixture', kind: 'payment_confirmation' as const };
const configuration = () => ({ ...env, TRANSACTIONAL_EMAIL_PROVIDER: 'vps', VPS_EMAIL_SIGNING_KEY: 'a'.repeat(64), EMAIL_FROM: 'BeCore Tickets <tickets@becoreops.com>' });
const runtime = env as Cloudflare.Env;
const original = { TRANSACTIONAL_EMAIL_PROVIDER: runtime.TRANSACTIONAL_EMAIL_PROVIDER, VPS_EMAIL_SIGNING_KEY: runtime.VPS_EMAIL_SIGNING_KEY, RESEND_API_KEY: runtime.RESEND_API_KEY, EMAIL_FROM: runtime.EMAIL_FROM };
const providerId = (character = 'a') => `vps-${character.repeat(64)}`;
const dueAt = '2020-01-01T00:00:00Z';
beforeEach(async () => { await env.DB.prepare('DELETE FROM delivery_events').run(); });
afterEach(() => { Object.assign(runtime, original); vi.unstubAllGlobals(); });

async function queue(provider?: string, kind = 'operational_alert', acceptedId: string | null = null, status = 'failed') {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO delivery_events(id,kind,recipient,status,provider_id,attempt_count,payload_json,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
    .bind(id,kind,message.recipient,status,acceptedId,JSON.stringify({ ...message, idempotencyKey:id, ...(provider ? { provider } : {}) }),dueAt,dueAt,dueAt).run();
  return id;
}
const state = (id: string) => env.DB.prepare('SELECT status,attempt_count AS attempts,next_attempt_at AS next,payload_json AS payload,provider_id AS providerId FROM delivery_events WHERE id=?').bind(id).first<{status:string;attempts:number;next:string|null;payload:string;providerId:string|null}>();

it.each(['team_invitation','organizer_report','organizer_invitation','organizer_signup','registration_access','registration_update','payment_confirmation','ticket_recovery','ticket_transfer','waitlist_offer','payment_recovery','support_update','operational_alert'])('uses VPS for supported %s only after explicit opt-in', kind => {
  expect(transactionalProvider(configuration(), kind)).toBe('vps');
  expect(transactionalProvider(env, kind)).toBe('resend');
  expect(transactionalProvider({ ...configuration(), TRANSACTIONAL_EMAIL_PROVIDER:'resend' }, kind)).toBe('resend');
});

it.each(['event_announcement','owner_approval_request','host_application_decision','host_application_verify','future_kind'])('keeps unsupported %s on Resend and rejects a forced VPS route', kind => {
  expect(transactionalProvider(configuration(), kind)).toBe('resend');
  expect(() => sendTransactional(configuration(), 'vps', { ...message, kind })).toThrow('must use Resend');
});

it('fails closed when the VPS key or sender is missing', () => {
  for (const config of [{ ...configuration(), VPS_EMAIL_SIGNING_KEY:undefined }, { ...configuration(), VPS_EMAIL_SIGNING_KEY:'short' }, { ...configuration(), EMAIL_FROM:'' }]) {
    expect(transactionalConfigured(config, 'vps')).toBe(false);
    expect(() => sendTransactional(config, 'vps', message)).toThrow('not configured');
  }
});

it('signs the exact body, path and timestamp, rejects redirects and retains the Tickets content', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://mail.becoreops.com/v1/emails');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeDefined();
    const headers = new Headers(init?.headers), body = String(init?.body);
    const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
    const encoder = new TextEncoder();
    const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const key = await crypto.subtle.importKey('raw', encoder.encode(configuration().VPS_EMAIL_SIGNING_KEY), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    expect(headers.get('x-tickets-signature')).toBe(hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${headers.get('x-tickets-timestamp')}\nPOST\n/v1/emails\n${digest}`))));
    expect(JSON.parse(body)).toEqual({ from:configuration().EMAIL_FROM, to:message.recipient, subject:message.subject, html:message.html, text:message.text, idempotencyKey:message.idempotencyKey, kind:message.kind });
    expect(headers.has('authorization')).toBe(false);
    return Response.json({ id:providerId() });
  });
  vi.stubGlobal('fetch', fetcher);
  await sendTransactional(configuration(), 'vps', message);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps the default Resend transport and saves its provider pin with unchanged content', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${env.RESEND_API_KEY}`);
    expect(JSON.parse(String(init?.body))).toEqual({from:env.EMAIL_FROM,to:[message.recipient],subject:message.subject,html:message.html,text:message.text});
    return Response.json({id:'resend-fixture'});
  });
  vi.stubGlobal('fetch',fetcher);
  const id = crypto.randomUUID();
  expect(await sendEmail({db:env.DB,...message,deliveryId:id})).toEqual({sent:true,providerId:'resend-fixture'});
  expect(JSON.parse((await state(id))!.payload).provider).toBe('resend');
});

it('pins an unconfigured first send to VPS and recovers without Resend after configuration rollback', async () => {
  Object.assign(runtime,configuration(),{VPS_EMAIL_SIGNING_KEY:undefined});
  const id = crypto.randomUUID(), fetcher = vi.fn<typeof fetch>(async () => Response.json({id:providerId()}));
  vi.stubGlobal('fetch',fetcher);
  expect(await sendEmail({db:env.DB,...message,deliveryId:id,idempotencyKey:id})).toEqual({sent:false,reason:'not_configured'});
  expect(fetcher).not.toHaveBeenCalled();
  expect(await state(id)).toMatchObject({attempts:0,next:expect.any(String)});
  expect(JSON.parse((await state(id))!.payload).provider).toBe('vps');
  await env.DB.prepare('UPDATE delivery_events SET next_attempt_at=? WHERE id=?').bind(dueAt,id).run();
  await retryFailedDeliveries({...configuration(),TRANSACTIONAL_EMAIL_PROVIDER:'resend',RESEND_API_KEY:undefined});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://mail.becoreops.com/v1/emails');
  expect(await state(id)).toMatchObject({status:'sent',providerId:providerId()});
});

it.each([undefined,'resend'])('keeps legacy or explicitly pinned %s payloads on Resend after opting in', async provider => {
  const id = await queue(provider), fetcher = vi.fn<typeof fetch>(async () => Response.json({id:'resend-fixture'}));
  vi.stubGlobal('fetch',fetcher);
  await retryFailedDeliveries(configuration());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  expect(await state(id)).toMatchObject({status:'sent'});
});

it('does not burn attempts or switch provider when one provider configuration is missing', async () => {
  const id = await queue('vps'), fetcher = vi.fn();
  vi.stubGlobal('fetch',fetcher);
  await retryFailedDeliveries({...configuration(),VPS_EMAIL_SIGNING_KEY:undefined});
  expect(fetcher).not.toHaveBeenCalled();
  expect(await state(id)).toMatchObject({status:'failed',attempts:1,next:expect.any(String)});
});

it.each([429,503])('defers VPS %s responses without exhausting attempts or falling back', async status => {
  Object.assign(runtime,configuration());
  const id = crypto.randomUUID(), fetcher = vi.fn<typeof fetch>(async () => Response.json({message:'Deferred'}, {status,headers:{'retry-after':'120'}}));
  vi.stubGlobal('fetch',fetcher);
  expect(await sendEmail({db:env.DB,...message,deliveryId:id,idempotencyKey:id})).toEqual({sent:false,reason:'provider_quota'});
  expect(await state(id)).toMatchObject({status:'failed',attempts:0,next:expect.any(String)});
  await env.DB.prepare('UPDATE delivery_events SET next_attempt_at=? WHERE id=?').bind(dueAt,id).run();
  await retryFailedDeliveries(configuration());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await state(id)).toMatchObject({status:'failed',attempts:0});
  expect(fetcher.mock.calls.every(([url]) => url === 'https://mail.becoreops.com/v1/emails')).toBe(true);
});

it('retries a lost VPS response with the same key, one lease and no cross-provider fallback', async () => {
  Object.assign(runtime,configuration());
  const id = crypto.randomUUID();
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('Network timeout')).mockResolvedValue(Response.json({id:providerId()}));
  vi.stubGlobal('fetch',fetcher);
  expect(await sendEmail({db:env.DB,...message,deliveryId:id,idempotencyKey:id})).toEqual({sent:false,reason:'provider_error'});
  await env.DB.prepare('UPDATE delivery_events SET next_attempt_at=? WHERE id=?').bind(dueAt,id).run();
  await Promise.all([retryFailedDeliveries({...configuration(),TRANSACTIONAL_EMAIL_PROVIDER:'resend'}),retryFailedDeliveries(configuration())]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url,init] of fetcher.mock.calls) {
    expect(url).toBe('https://mail.becoreops.com/v1/emails');
    expect(JSON.parse(init.body).idempotencyKey).toBe(id);
  }
  expect(await state(id)).toMatchObject({status:'sent',attempts:2});
});

it.each(['failed','queued'])('never retries an already accepted message even if its app status is %s', async status => {
  await queue('vps','operational_alert',providerId(),status);
  const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
  await retryFailedDeliveries(configuration());
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['ticket_transfer','waitlist_offer','registration_access','host_application_verify','team_invitation','organizer_invitation','organizer_report'])('preserves access and expiry checks for queued %s', async kind => {
  const id = await queue(kind === 'host_application_verify' ? 'resend' : 'vps',kind), fetcher = vi.fn();
  vi.stubGlobal('fetch',fetcher);
  await retryFailedDeliveries(configuration());
  expect(fetcher).not.toHaveBeenCalled();
  expect(await state(id)).toMatchObject({status:'suppressed'});
});

it('refuses invalid VPS acceptance IDs without falling back', async () => {
  Object.assign(runtime,configuration());
  const id = crypto.randomUUID(), fetcher = vi.fn<typeof fetch>(async () => Response.json({id:'unexpected-id'}));
  vi.stubGlobal('fetch',fetcher);
  expect(await sendEmail({db:env.DB,...message,deliveryId:id})).toEqual({sent:false,reason:'provider_error'});
  expect(await state(id)).toMatchObject({status:'failed',providerId:null});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reconciles only requested valid status evidence and never resends terminal deliveries', async () => {
  const id = await queue('vps','operational_alert',providerId(),'sent');
  const foreign = await queue('resend','operational_alert','foreign-provider','sent');
  const timestamp = Date.now();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({messages:[
    {id:providerId(),status:'sent',updatedAt:timestamp + 600_000},
    {id:providerId(),status:'sent',updatedAt:'invalid'},
    {id:providerId(),status:'delivered',detail:{invalid:true},updatedAt:timestamp},
    {id:'foreign-provider',status:'delivered',updatedAt:timestamp},
    {id:providerId(),status:'delivered',updatedAt:timestamp},
  ]}));
  vi.stubGlobal('fetch',fetcher);
  await reconcileVpsDeliveries({...configuration(),TRANSACTIONAL_EMAIL_PROVIDER:'resend'});
  expect(await state(id)).toMatchObject({status:'delivered',next:null});
  expect(await state(foreign)).toMatchObject({status:'sent'});
  expect(fetcher.mock.calls[0][0]).toBe('https://mail.becoreops.com/v1/status');
  await reconcileVpsDeliveries(configuration());
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps newer provider evidence when a status response is stale', async () => {
  const id = await queue('vps','operational_alert',providerId(),'delayed');
  await env.DB.prepare('UPDATE delivery_events SET provider_event_at=? WHERE id=?').bind(new Date().toISOString(),id).run();
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(async () => Response.json({messages:[{id:providerId(),status:'sent',updatedAt:Date.now()-60_000}]})));
  await reconcileVpsDeliveries(configuration());
  expect(await state(id)).toMatchObject({status:'delayed'});
});

it.each([null,{}, {messages:{}}])('rejects malformed status responses without changing delivery state', async result => {
  const id = await queue('vps','operational_alert',providerId(),'sent');
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(async () => Response.json(result)));
  await expect(reconcileVpsDeliveries(configuration())).rejects.toThrow();
  expect(await state(id)).toMatchObject({status:'sent'});
});

it('rotates missing provider IDs so old unknown messages cannot starve later status polls', async () => {
  for (let index=0;index<101;index++) await queue('vps','operational_alert',`vps-${index.toString(16).padStart(64,'0')}`,'sent');
  const requested = new Set<string>();
  vi.stubGlobal('fetch',vi.fn(async (_url: string,init?:RequestInit) => {
    for (const id of JSON.parse(String(init?.body)).ids) requested.add(id);
    return Response.json({messages:[]});
  }));
  await reconcileVpsDeliveries(configuration());
  expect(requested.size).toBe(100);
  await reconcileVpsDeliveries(configuration());
  expect(requested.size).toBe(101);
});

it('defers a non-JSON VPS outage response without consuming retry attempts', async () => {
  Object.assign(runtime,configuration());
  const id = crypto.randomUUID();
  vi.stubGlobal('fetch',vi.fn(async () => new Response('Service unavailable',{status:503})));
  expect(await sendEmail({db:env.DB,...message,deliveryId:id,idempotencyKey:id})).toEqual({sent:false,reason:'provider_quota'});
  await env.DB.prepare('UPDATE delivery_events SET next_attempt_at=? WHERE id=?').bind(dueAt,id).run();
  await retryFailedDeliveries(configuration());
  expect(await state(id)).toMatchObject({status:'failed',attempts:0,next:expect.any(String)});
});
