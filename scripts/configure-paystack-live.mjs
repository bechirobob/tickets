import { createHmac } from 'node:crypto';

const key = process.env.PAYSTACK_SECRET_KEY;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!key || !/^sk_live_[a-zA-Z0-9]+$/.test(key)) throw new Error('A live PAYSTACK_SECRET_KEY must be saved in the repository secret store. No configuration changed.');
if (!token) throw new Error('The existing Cloudflare connection is missing.');
const account = 'af75a230de2eea882606db8d9acce473';
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/becore-tickets/secrets`;
async function cloudflare(method, body) {
  const response = await fetch(endpoint, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Cloudflare secret configuration failed (HTTP ${response.status}).`);
  return result.result;
}
// A read-only, authenticated provider check; no charge or customer is created.
const verification = await fetch('https://api.paystack.co/integration/payment_session_timeout', {
  headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
});
const provider = await verification.json();
if (!verification.ok || provider.status !== true) throw new Error(`Paystack did not authenticate the live key (HTTP ${verification.status}). No configuration changed.`);
console.log('Paystack authenticated the live key. No payment was initiated.');
const before = new Set((await cloudflare('GET')).map(secret => secret.name));
if (!before.has('PAYSTACK_SECRET_KEY')) throw new Error('Expected existing Paystack binding is missing; configuration was not changed.');
await cloudflare('PUT', { name: 'PAYSTACK_SECRET_KEY', text: key, type: 'secret_text' });
const after = new Set((await cloudflare('GET')).map(secret => secret.name));
if (!after.has('PAYSTACK_SECRET_KEY') || [...before].some(name => !after.has(name))) throw new Error('Secret name verification failed.');
console.log('Replaced the existing Worker Paystack binding with the authenticated live key; unrelated secrets were preserved.');
const raw = JSON.stringify({ event: 'connection.check', data: {} });
const signed = createHmac('sha512', key).update(raw).digest('hex');
const response = await fetch('https://tickets.becoreops.com/api/payments/webhook', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': signed },
  body: raw, redirect: 'manual', signal: AbortSignal.timeout(20000),
});
const responseText = await response.text();
if (response.status === 429 && /1027|plan limits|exceeded.*limit/i.test(responseText)) {
  console.log('Live key installed. Production webhook verification is blocked by the existing Cloudflare quota outage; payment readiness remains unverified.');
} else {
  if (response.status !== 200 || responseText !== 'OK') throw new Error(`Live webhook signature probe failed (HTTP ${response.status}).`);
  const unsigned = await fetch('https://tickets.becoreops.com/api/payments/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
    redirect: 'manual', signal: AbortSignal.timeout(20000),
  });
  if (unsigned.status !== 401) throw new Error(`Unsigned webhook was not rejected (HTTP ${unsigned.status}).`);
  console.log('Production accepts the live signature and rejects unsigned requests. The reference-free probe creates no orders or payment records.');
}
console.log('Required Paystack dashboard callback: https://tickets.becoreops.com/payment/return');
console.log('Required Paystack dashboard webhook: https://tickets.becoreops.com/api/payments/webhook');
console.log('Dashboard settings and an end-to-end real payment must be verified separately.');
