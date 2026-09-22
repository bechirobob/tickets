import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { deliverConfirmation } from '../lib/confirmation-delivery';
import { hashToken, attendeeCookieHeader } from '../lib/attendee-auth';
import { GET as settings, POST as subscribe } from '../app/api/customer/notifications/subscription/route';

const origin = 'https://tickets.becoreops.com';
const encode = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
const original = { VAPID_PUBLIC_KEY:env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY:env.VAPID_PRIVATE_KEY,VAPID_SUBJECT:env.VAPID_SUBJECT };
let attendeeId:string, cookie:string, endpoint:string, keys:{p256dh:string;auth:string};
beforeEach(async () => {
  attendeeId=crypto.randomUUID(); const token=crypto.randomUUID(), now=new Date().toISOString();
  endpoint=`https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  env.VAPID_PUBLIC_KEY=encode(await crypto.subtle.exportKey('raw',pair.publicKey));
  env.VAPID_PRIVATE_KEY=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d!;
  env.VAPID_SUBJECT='mailto:test@example.com';
  keys={p256dh:env.VAPID_PUBLIC_KEY,auth:encode(crypto.getRandomValues(new Uint8Array(16)).buffer)};
  await env.DB.batch([
    env.DB.prepare("INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES (?,?,'Guest','active',?,?)").bind(attendeeId,`${attendeeId}@example.com`,now,now),
    env.DB.prepare('INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),attendeeId,await hashToken(token),new Date(Date.now()+3600000).toISOString(),now,now),
  ]);
  cookie=attendeeCookieHeader(token);
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:201}));
});
afterEach(()=>{ Object.assign(env,original); vi.restoreAllMocks(); });
function request(confirmationUpdates?:boolean) { return new Request(`${origin}/api/customer/notifications/subscription`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({endpoint,keys,confirmationUpdates})}); }
function delivery(email=vi.fn(async()=>{}),id=crypto.randomUUID()) { return {env,id,attendeeId,payload:{kind:'purchase_confirmation' as const,title:'Ticket confirmed',body:'Open My Nights',url:'/my-nights',sourceId:id,tag:id},email}; }

it('keeps Room subscriptions separate, confirms server ownership and persists a single inbox update',async()=>{
  expect((await subscribe(request())).status).toBe(201);
  const input=delivery();
  expect(await deliverConfirmation(input)).toBe('email');
  expect(input.email).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
  await deliverConfirmation(input);
  expect(input.email).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM attendee_notifications WHERE source_id=?').bind(input.id).first()).toEqual({n:1});
  expect(await (await settings(new Request(`${origin}/api/customer/notifications/subscription?endpoint=${encodeURIComponent(endpoint)}`,{headers:{cookie}}))).json()).toMatchObject({deviceSubscribed:true,confirmationUpdates:false,available:true});
});
it('sends encrypted push after explicit consent and suppresses duplicate callbacks and email',async()=>{
  expect((await subscribe(request(true))).status).toBe(201);
  expect(await env.DB.prepare('SELECT room_updates AS rooms FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toEqual({rooms:0});
  // A Room subscription refresh cannot erase explicit confirmation consent.
  expect((await subscribe(request())).status).toBe(201);
  const input=delivery(); const results=await Promise.all([deliverConfirmation(input),deliverConfirmation(input)]);
  expect(results).toContain('push'); expect(input.email).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(endpoint);
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toBeTruthy();
  expect(await deliverConfirmation(input)).toBe('push'); expect(fetch).toHaveBeenCalledTimes(1);
  expect((await subscribe(request(false))).status).toBe(201);
  const next=delivery(); expect(await deliverConfirmation(next)).toBe('email');
  expect(await env.DB.prepare('SELECT revoked_at FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toEqual({revoked_at:null});
});
it.each([410,503])('falls back to email when the push service returns %i',async status=>{
  await subscribe(request(true)); vi.mocked(fetch).mockResolvedValue(new Response(null,{status}));
  const input=delivery(); expect(await deliverConfirmation(input)).toBe('email'); expect(input.email).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare('SELECT failure_count AS count,revoked_at AS revoked FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first()).toMatchObject({count:1,revoked:status===410?expect.any(String):null});
});
it('retries a failed fallback and recovers an expired processing lease',async()=>{
  const email=vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined);
  const input=delivery(email);
  await expect(deliverConfirmation(input)).rejects.toThrow('database unavailable');
  await env.DB.prepare("UPDATE confirmation_deliveries SET status='processing',lease_token='crashed',lease_until='2020-01-01T00:00:00Z' WHERE id=?").bind(input.id).run();
  expect(await deliverConfirmation(input)).toBe('email'); expect(email).toHaveBeenCalledTimes(2);
});
it('uses email after session expiry and refuses confirmation consent without complete push configuration',async()=>{
  await subscribe(request(true));
  await env.DB.prepare("UPDATE attendee_sessions SET expires_at='2020-01-01T00:00:00Z' WHERE attendee_id=?").bind(attendeeId).run();
  const input=delivery(); expect(await deliverConfirmation(input)).toBe('email'); expect(fetch).not.toHaveBeenCalled();
  await env.DB.prepare('UPDATE attendee_sessions SET expires_at=? WHERE attendee_id=?').bind(new Date(Date.now()+3600000).toISOString(),attendeeId).run();
  env.VAPID_PRIVATE_KEY=''; expect((await subscribe(request(true))).status).toBe(503);
});
