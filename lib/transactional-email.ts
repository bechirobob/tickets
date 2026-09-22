type Provider = 'resend' | 'vps';
type Message = { recipient: string; subject: string; html: string; text: string; idempotencyKey: string; kind: string };
const VPS_ORIGIN = 'https://mail.becoreops.com';

export function transactionalProvider(env: Cloudflare.Env, kind: string): Provider {
  return kind !== 'event_announcement' && env.TRANSACTIONAL_EMAIL_PROVIDER === 'vps' ? 'vps' : 'resend';
}

export function transactionalConfigured(env: Cloudflare.Env, provider: Provider): boolean {
  return Boolean(env.EMAIL_FROM && (provider === 'vps' ? env.VPS_EMAIL_SIGNING_KEY && env.VPS_EMAIL_SIGNING_KEY.length >= 32 : env.RESEND_API_KEY));
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function vpsMailRequest(env: Cloudflare.Env, path: '/v1/emails' | '/v1/status', value: unknown) {
  if (!env.VPS_EMAIL_SIGNING_KEY || env.VPS_EMAIL_SIGNING_KEY.length < 32) throw new Error('VPS email connection is missing.');
  const body = JSON.stringify(value), timestamp = String(Math.floor(Date.now() / 1000));
  const encoder = new TextEncoder();
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.VPS_EMAIL_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}\nPOST\n${path}\n${digest}`)));
  return fetch(`${VPS_ORIGIN}${path}`, {
    method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-tickets-timestamp': timestamp, 'x-tickets-signature': signature }, body,
  });
}

export function sendTransactional(env: Cloudflare.Env, provider: Provider, message: Message) {
  if (!transactionalConfigured(env, provider)) throw new Error('Transactional email is not configured.');
  if (provider === 'vps') {
    if (message.kind === 'event_announcement') throw new Error('Campaigns must use Resend.');
    return vpsMailRequest(env, '/v1/emails', { from: env.EMAIL_FROM, to: message.recipient, subject: message.subject, html: message.html, text: message.text, idempotencyKey: message.idempotencyKey.slice(0, 256), kind: message.kind });
  }
  return fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': message.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.recipient], subject: message.subject, html: message.html, text: message.text }),
  });
}

export async function reconcileVpsDeliveries(env: Cloudflare.Env) {
  if (!env.VPS_EMAIL_SIGNING_KEY) return;
  const due = await env.DB.prepare("SELECT provider_id AS id FROM delivery_events WHERE provider_id LIKE 'vps-%' AND status IN ('sent','delayed') ORDER BY updated_at,created_at LIMIT 100").all<{ id: string }>();
  if (!due.results.length) return;
  const response = await vpsMailRequest(env, '/v1/status', { ids: due.results.map(row => row.id) });
  if (!response.ok) throw new Error(`VPS delivery status unavailable (${response.status}).`);
  const result = await response.json() as { messages?: Array<{ id: string; status: string; detail?: string; updatedAt: number }> };
  const expected = new Set(due.results.map(row => row.id));
  const updates = (result.messages ?? []).filter(item => expected.has(item.id) && ['sent', 'delayed', 'delivered', 'bounced', 'failed'].includes(item.status) && Number.isFinite(item.updatedAt) && item.updatedAt > 0 && item.updatedAt <= Date.now() + 300_000);
  for (const item of updates) {
    // Every accepted handoff stays with its provider. Polling never resends mail.
    await env.DB.prepare("UPDATE delivery_events SET status=?,failure_reason=?,provider_event_at=?,next_attempt_at=NULL,updated_at=? WHERE provider_id=? AND status IN ('sent','delayed') AND (provider_event_at IS NULL OR julianday(provider_event_at)<=julianday(?))")
      .bind(item.status, item.status === 'delivered' || item.status === 'sent' ? null : (item.detail ?? 'Email delivery is pending.').slice(0, 250), new Date(item.updatedAt).toISOString(), new Date().toISOString(), item.id, new Date(item.updatedAt).toISOString()).run();
  }
}
