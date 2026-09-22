import { env } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { reconcileVpsDeliveries, sendTransactional, transactionalConfigured, transactionalProvider } from '../lib/transactional-email';
import { retryFailedDeliveries } from '../lib/email-delivery';

afterEach(() => vi.unstubAllGlobals());
const message = { recipient: 'fixture@example.com', subject: 'Your tickets', html: '<p>Your tickets</p>', text: 'Your tickets', idempotencyKey: 'receipt/fixture', kind: 'payment_confirmation' };
const configuration = () => ({ ...env, TRANSACTIONAL_EMAIL_PROVIDER: 'vps', VPS_EMAIL_SIGNING_KEY: 'a'.repeat(64), EMAIL_FROM: 'BeCore Tickets <tickets@becoreops.com>' });

it('keeps campaigns on Resend and fails closed when the VPS connection is missing', async () => {
  expect(transactionalProvider(configuration(), 'payment_confirmation')).toBe('vps');
  expect(transactionalProvider(configuration(), 'event_announcement')).toBe('resend');
  expect(transactionalProvider(env, 'payment_confirmation')).toBe('resend');
  expect(transactionalConfigured({ ...configuration(), VPS_EMAIL_SIGNING_KEY: undefined }, 'vps')).toBe(false);
  expect(() => sendTransactional({ ...configuration(), VPS_EMAIL_SIGNING_KEY: undefined }, 'vps', message)).toThrow('not configured');
  expect(() => sendTransactional(configuration(), 'vps', { ...message, kind: 'event_announcement' })).toThrow('Campaigns');
});

it('signs the exact body, path and timestamp while retaining the Tickets sender', async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://mail.becoreops.com/v1/emails');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers), body = String(init?.body);
    const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
    const encoder = new TextEncoder();
    const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const key = await crypto.subtle.importKey('raw', encoder.encode(configuration().VPS_EMAIL_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    expect(headers.get('x-tickets-signature')).toBe(hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${headers.get('x-tickets-timestamp')}\nPOST\n/v1/emails\n${digest}`))));
    expect(JSON.parse(body)).toMatchObject({ from: configuration().EMAIL_FROM, to: message.recipient, idempotencyKey: message.idempotencyKey });
    return Response.json({ id: 'vps-' + 'a'.repeat(64) });
  });
  vi.stubGlobal('fetch', fetcher);
  await sendTransactional(configuration(), 'vps', message);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps a queued message with its original provider after a configuration rollback', async () => {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,payload_json,next_attempt_at,created_at,updated_at) VALUES (?,'operational_alert','fixture@example.com','failed',1,?,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')")
    .bind(id, JSON.stringify({ ...message, provider: 'vps', idempotencyKey: id })).run();
  const fetcher = vi.fn(async (url: string) => { expect(url).toContain('mail.becoreops.com'); return Response.json({ id: 'vps-' + 'b'.repeat(64) }); });
  vi.stubGlobal('fetch', fetcher);
  await retryFailedDeliveries({ ...configuration(), TRANSACTIONAL_EMAIL_PROVIDER: 'resend' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await env.DB.prepare('SELECT status FROM delivery_events WHERE id=?').bind(id).first())?.status).toBe('sent');
});

it('updates delivery evidence without resending or trusting unrelated provider IDs', async () => {
  const id = crypto.randomUUID(), providerId = 'vps-' + 'c'.repeat(64);
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,provider_id,attempt_count,created_at,updated_at) VALUES (?,'operational_alert','fixture@example.com','sent',?,1,?,?)").bind(id, providerId, new Date().toISOString(), new Date().toISOString()).run();
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toBe('https://mail.becoreops.com/v1/status');
    return Response.json({ messages: [{ id: providerId, status: 'delivered', updatedAt: Date.now() }, { id: 'unrelated', status: 'delivered', updatedAt: Date.now() }] });
  });
  vi.stubGlobal('fetch', fetcher);
  await reconcileVpsDeliveries(configuration());
  const state = await env.DB.prepare('SELECT status,next_attempt_at FROM delivery_events WHERE id=?').bind(id).first();
  expect(state).toEqual({ status: 'delivered', next_attempt_at: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
