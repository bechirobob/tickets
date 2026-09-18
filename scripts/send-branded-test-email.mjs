import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const expectedSender = 'BeCore Tickets <tickets@becoreops.com>';

export function validateRequest(request, now = Date.now()) {
  if (!/^[a-z0-9-]{8,90}$/.test(request.requestId ?? '') || request.template !== 'october-rsvp') throw new Error('Invalid test request.');
  if (!/^\[TEST[^\r\n]*\] .{3,110}$/u.test(request.subject ?? '') || /[\r\n]/u.test(request.subject)) throw new Error('A test-labelled subject is required.');
  if (!/^[a-f0-9]{64}$/.test(request.recipientSha256 ?? '')) throw new Error('An exact approved recipient fingerprint is required.');
  const expiry = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 48 * 3600_000) throw new Error('Test authorization must expire within 48 hours.');
  if (Object.keys(request).some(key => !['requestId', 'template', 'subject', 'recipientSha256', 'expiresAt'].includes(key))) throw new Error('Unexpected test request fields.');
}

export function resolveRecipient(accounts, fingerprint) {
  const matches = [...new Set(accounts.map(account => account.normalized_email))].filter(email => typeof email === 'string' && sha256(email) === fingerprint);
  if (matches.length !== 1) throw new Error('Exactly one known, explicitly approved test recipient is required.');
  return matches[0];
}

export function makePayload(request, html, text, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('An immutable GitHub revision is required.');
  if (!html.includes('TEST EMAIL') || !text.includes('TEST EMAIL') || !html.includes('{{FLIER_URL}}')) throw new Error('The approved test template is incomplete.');
  const flierUrl = `https://raw.githubusercontent.com/bechirobob/tickets/${revision}/emails/tests/on-the-guest-list.jpg`;
  return { subject: request.subject, html: html.replaceAll('{{FLIER_URL}}', flierUrl), text, idempotencyKey: `email-preview/${request.requestId}` };
}

// This operator-only workflow queues ONE email for the existing production sender.
// No credentials are copied out of Cloudflare and no guest/RSVP record is created.
export async function enqueuePreview(query, request, recipient, payload) {
  const id = payload.idempotencyKey;
  const payloadJson = JSON.stringify(payload);
  const now = new Date().toISOString();
  await query(`INSERT OR IGNORE INTO delivery_events
    (id,kind,recipient,status,attempt_count,payload_json,created_at,updated_at)
    VALUES (?,'email_preview',?,'queued',0,?,?,?)`, [id, recipient, payloadJson, now, now]);
  const [row] = await query('SELECT recipient,payload_json,status,provider_id FROM delivery_events WHERE id=?', [id]);
  if (!row || row.recipient !== recipient || row.payload_json !== payloadJson) throw new Error('This request ID already belongs to different content. Use a newly authorized request ID.');
  return row;
}

async function main() {
  const request = JSON.parse(await readFile('emails/tests/request.json', 'utf8'));
  validateRequest(request);
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  if (config.vars?.EMAIL_FROM !== expectedSender) throw new Error('The production sender does not match BeCore Tickets.');
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('The existing Cloudflare operator connection is required.');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
  const listed = await fetch(`${root}?name=becore-tickets-db`, { headers, signal: AbortSignal.timeout(30_000) });
  const databases = await listed.json();
  const database = databases.result?.filter(row => row.name === 'becore-tickets-db');
  if (!listed.ok || !databases.success || database?.length !== 1) throw new Error('Could not resolve the production mail queue.');
  const query = async (sql, params = []) => {
    const response = await fetch(`${root}/${database[0].uuid}/query`, { method: 'POST', headers, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30_000) });
    const result = await response.json();
    if (!response.ok || !result.success || result.result?.length !== 1 || !result.result[0].success) throw new Error('The production mail queue operation failed.');
    return result.result[0].results;
  };
  // Receiving a requested test does not require an active staff login. Resolve
  // the explicit recipient against existing private records; never alter access.
  const accounts = await query('SELECT normalized_email FROM staff_accounts UNION SELECT recipient AS normalized_email FROM delivery_events');
  const recipient = resolveRecipient(accounts, request.recipientSha256);
  const [event] = await query("SELECT schedule_status,status,removed_at FROM curated_event_records WHERE slug='sun-chasers-labadi'");
  if (!event || event.status !== 'published' || event.removed_at || event.schedule_status !== 'coming_soon') throw new Error('The event has changed; review this reminder before sending.');
  const [html, text] = await Promise.all(['html', 'txt'].map(extension => readFile(`emails/tests/october-rsvp.${extension}`, 'utf8')));
  const payload = makePayload(request, html, text, process.env.GITHUB_SHA ?? '');
  // Verify both image responses before queuing the message. Never log recipients.
  for (const url of [payload.html.match(/src="(https:[^"]+\.png[^\"]*)"/)?.[1], payload.html.match(/src="(https:[^"]+\.jpg)"/)?.[1]]) {
    if (!url) throw new Error('The branded email image URL is missing.');
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('A branded email image is not available.');
    await response.arrayBuffer();
  }
  const row = await enqueuePreview(query, request, recipient, payload);
  console.log(JSON.stringify({ requestId: request.requestId, sender: expectedSender, recipientCount: 1, status: row.status }));
  // The existing five-minute cron picks up queued rows after their five-minute lease.
  // Never reset state or resend here: provider idempotency also survives reruns.
  for (let attempt = 0; attempt < 42; attempt += 1) {
    const [delivery] = await query('SELECT status,provider_id,attempt_count,next_attempt_at FROM delivery_events WHERE id=?', [payload.idempotencyKey]);
    if (['sent', 'delivered'].includes(delivery?.status) && delivery.provider_id) {
      console.log(JSON.stringify({ requestId: request.requestId, status: delivery.status, providerId: delivery.provider_id, sender: expectedSender, recipientCount: 1 }));
      return;
    }
    if (['bounced', 'complained', 'suppressed'].includes(delivery?.status) || (delivery?.status === 'failed' && !delivery.next_attempt_at)) throw new Error('The provider did not deliver the test. Inspect the delivery record; do not send a duplicate.');
    await new Promise(resolve => setTimeout(resolve, 20_000));
  }
  throw new Error('The test remains in the existing mail queue. Check this request ID before retrying.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
