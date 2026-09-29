// Run only on the authorized operator runner. Never persist or log plaintext.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
const account = 'af75a230de2eea882606db8d9acce473';
const root = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const token = process.env.CLOUDFLARE_API_TOKEN;
const revision = process.env.SOURCE_SHA;
const collector = `tickets-handover-${process.env.GITHUB_RUN_ID}`;
const activated = [];
let collectorAttempted = false;
async function api(path, method = 'GET', body) {
  const response = await fetch(root + path, { method, headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Cloudflare operation failed (${response.status}).`);
  return result.result;
}
try {
  if (!token || !/^[a-f0-9]{40}$/.test(revision ?? '') || !/^tickets-handover-\d+$/.test(collector)) throw new Error('Missing operator configuration.');
  const live = await fetch('https://tickets.becoreops.com/api/version', { cache: 'no-store', signal: AbortSignal.timeout(20000) }).then(response => response.json());
  if (live.revision !== revision) throw new Error('Live source revision does not match verified handover source.');
  const recipient = JSON.parse(await readFile(new URL('./recipient.json', import.meta.url), 'utf8'));
  if (createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex') !== recipient.fingerprint) throw new Error('Recipient fingerprint mismatch.');
  const existing = await api('/workers/scripts/becore-tickets/secrets');
  if (existing.some(item => item.name.startsWith('HANDOVER_'))) throw new Error('Previous handover settings require review before retry.');
  const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  for (const [name, value] of [['HANDOVER_RECIPIENT_SPKI', recipient.publicKey], ['HANDOVER_EXPIRES_AT', expiresAt]]) {
    activated.push(name); // Also clean up a request whose successful response was lost.
    await api('/workers/scripts/becore-tickets/secrets', 'PUT', { name, text: value, type: 'secret_text' });
  }
  const collectorToken = randomBytes(32).toString('hex');
  // This temporary collector returns only ciphertext, and requires a fresh
  // bearer token. Its service binding is the sole caller of the named API.
  const source = `export default { async fetch(request, env) {
    if (request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + env.TOKEN || Date.now() >= Date.parse(env.EXPIRES_AT)) return new Response('Not found', { status: 404 });
    try { return Response.json(await env.SOURCE.configuration(), { headers: { 'cache-control': 'no-store' } }); }
    catch { return new Response('Handover unavailable', { status: 503 }); }
  } };`;
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'collector.mjs', compatibility_date: '2026-08-11', bindings: [
    { type: 'service', name: 'SOURCE', service: 'becore-tickets', entrypoint: 'HandoverEntrypoint' },
    { type: 'secret_text', name: 'TOKEN', text: collectorToken },
    { type: 'plain_text', name: 'EXPIRES_AT', text: expiresAt },
  ], observability: { enabled: false } }));
  form.set('collector.mjs', new Blob([source], { type: 'application/javascript+module' }), 'collector.mjs');
  collectorAttempted = true;
  await api(`/workers/scripts/${collector}`, 'PUT', form);
  await api(`/workers/scripts/${collector}/subdomain`, 'POST', { enabled: true });
  const { subdomain } = await api('/workers/subdomain');
  if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error('Invalid account subdomain.');
  let envelope;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(`https://${collector}.${subdomain}.workers.dev/`, { method: 'POST', headers: { authorization: `Bearer ${collectorToken}` }, signal: AbortSignal.timeout(20000) });
    if (response.ok) { envelope = await response.json(); break; }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!envelope?.ciphertext || !envelope?.wrappedKey || JSON.parse(envelope.header).purpose !== 'configuration') throw new Error('Encrypted configuration was not received.');
  await mkdir('handover-encrypted', { mode: 0o700 });
  await writeFile('handover-encrypted/configuration.json', JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ encryptedConfigurationCollected: true, sourceRevision: revision, recipientFingerprint: recipient.fingerprint }));
} catch (error) {
  // Error messages are deliberately generic; never print provider response bodies.
  console.error(error instanceof Error && /^(Missing operator|Live source|Recipient fingerprint|Previous handover|Cloudflare operation|Invalid account|Encrypted configuration)/.test(error.message) ? error.message : 'Encrypted configuration collection failed.');
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  if (collectorAttempted) {
    try { await api(`/workers/scripts/${collector}`, 'DELETE'); } catch { cleanupFailed = true; }
  }
  for (const name of activated.reverse()) {
    try { await api(`/workers/scripts/becore-tickets/secrets/${name}`, 'DELETE'); } catch { cleanupFailed = true; }
  }
  console.log(JSON.stringify({ temporaryHandoverRemoved: !cleanupFailed }));
  if (cleanupFailed) process.exitCode = 1;
}
