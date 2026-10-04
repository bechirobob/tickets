import { env } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import { POST as paystackWebhook } from '../app/api/payments/webhook/route';
import { POST as emailWebhook } from '../app/api/email/webhook/route';

const origin = 'https://tickets.becoreops.com';
const runtime = env as unknown as Cloudflare.Env;
const emailSecret = 'audit-fixture-secret-only-32-bytes';
afterEach(() => { delete runtime.RESEND_WEBHOOK_SECRET; });
async function hmac(value: string, secret: string, hash: 'SHA-256' | 'SHA-512') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
async function paystackRequest(raw: string) {
  const bytes = await hmac(raw, runtime.PAYSTACK_SECRET_KEY!, 'SHA-512');
  return new Request(`${origin}/api/payments/webhook`, { method: 'POST', body: raw,
    headers: { 'x-paystack-signature': [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') } });
}
async function emailRequest(raw: string, timestamp = Math.floor(Date.now() / 1000)) {
  runtime.RESEND_WEBHOOK_SECRET = `whsec_${btoa(emailSecret)}`;
  const id = `fixture-${crypto.randomUUID()}`;
  const bytes = await hmac(`${id}.${timestamp}.${raw}`, emailSecret, 'SHA-256');
  return new Request(`${origin}/api/email/webhook`, { method: 'POST', body: raw,
    headers: { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${btoa(String.fromCharCode(...bytes))}` } });
}

it('rejects forged and tampered Paystack callbacks before recording an event', async () => {
  const reference = `signature-${crypto.randomUUID()}`;
  const raw = JSON.stringify({ event: 'charge.success', data: { reference, amount: 100, currency: 'GHS', status: 'success' } });
  const signed = await paystackRequest(raw);
  for (const request of [
    new Request(`${origin}/api/payments/webhook`, { method: 'POST', body: raw }),
    new Request(`${origin}/api/payments/webhook`, { method: 'POST', body: raw, headers: { 'x-paystack-signature': '0'.repeat(128) } }),
    new Request(`${origin}/api/payments/webhook`, { method: 'POST', body: raw.replace('100', '101'), headers: signed.headers }),
  ]) expect((await paystackWebhook(request)).status).toBe(401);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM payment_events WHERE reference=?').bind(reference).first()).toEqual({ count: 0 });
});

it('accepts a signed Paystack callback and deduplicates its event evidence', async () => {
  const reference = `signature-${crypto.randomUUID()}`;
  const raw = JSON.stringify({ event: 'charge.success', data: { reference, amount: 100, currency: 'GHS', status: 'success' } });
  expect((await paystackWebhook(await paystackRequest(raw))).status).toBe(200);
  expect((await paystackWebhook(await paystackRequest(raw))).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM payment_events WHERE reference=?').bind(reference).first()).toEqual({ count: 1 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM orders WHERE reference=?').bind(reference).first()).toEqual({ count: 0 });
});

it('rejects forged, expired, future and tampered email callbacks', async () => {
  const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'signature-fixture' } });
  const now = Math.floor(Date.now() / 1000);
  expect((await emailWebhook(await emailRequest(raw, now - 301))).status).toBe(401);
  expect((await emailWebhook(await emailRequest(raw, now + 301))).status).toBe(401);
  const forged = await emailRequest(raw); forged.headers.set('svix-signature', 'v1,Zm9yZ2Vk');
  expect((await emailWebhook(forged)).status).toBe(401);
  const signed = await emailRequest(raw);
  expect((await emailWebhook(new Request(`${origin}/api/email/webhook`, { method: 'POST', body: raw.replace('delivered','failed'), headers: signed.headers }))).status).toBe(401);
});

it('applies an authenticated delivery exactly once and retains delivered state through older callbacks', async () => {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,provider_id,created_at,updated_at) VALUES (?,'payment_confirmation','fixture@example.com','sent',?,?,?)")
    .bind(id,id,now,now).run();
  const raw = JSON.stringify({ type: 'email.delivered', created_at: now, data: { email_id: id } });
  for (let index = 0; index < 2; index++) expect((await emailWebhook(await emailRequest(raw))).status).toBe(200);
  const previous = JSON.stringify({ type: 'email.sent', created_at: new Date(Date.now() - 1000).toISOString(), data: { email_id: id } });
  expect((await emailWebhook(await emailRequest(previous))).status).toBe(200);
  expect(await env.DB.prepare('SELECT status,provider_event_at FROM delivery_events WHERE id=?').bind(id).first()).toEqual({ status: 'delivered', provider_event_at: now });
});
