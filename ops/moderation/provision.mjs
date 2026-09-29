import { build } from 'esbuild';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sealHandover } from '../../worker/handover-crypto.ts';
const root = 'https://api.cloudflare.com/client/v4/accounts/af75a230de2eea882606db8d9acce473';
const name = 'becore-tickets-moderation';
let attempted = false, complete = false;
async function api(path, method = 'GET', body) {
  const response = await fetch(root + path, { method, headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (response.status === 404 && method === 'GET') return null;
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error('Moderation provisioning API failed.');
  return result.result;
}
try {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error();
  if (await api(`/workers/scripts/${name}/settings`)) throw new Error('Existing moderation service requires review before changing it.');
  const { subdomain } = await api('/workers/subdomain');
  if (subdomain !== 'becoreops') throw new Error();
  const recipient = JSON.parse(await readFile('ops/handover/recipient.json', 'utf8'));
  if (createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex') !== recipient.fingerprint) throw new Error();
  const key = randomBytes(32).toString('hex');
  const bundled = await build({ entryPoints: ['ops/moderation/worker.ts'], bundle: true, write: false, platform: 'browser', format: 'esm' });
  const source = bundled.outputFiles[0].text;
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'moderation.mjs', compatibility_date: '2026-08-11', bindings: [{ name: 'AI', type: 'ai' }, { name: 'VPS_AI_SIGNING_KEY', type: 'secret_text', text: key }], observability: { enabled: false } }));
  form.set('moderation.mjs', new Blob([source], { type: 'application/javascript+module' }), 'moderation.mjs');
  attempted = true;
  await api(`/workers/scripts/${name}`, 'PUT', form);
  await api(`/workers/scripts/${name}/subdomain`, 'POST', { enabled: true });
  const envelope = await sealHandover({ HANDOVER_RECIPIENT_SPKI: recipient.publicKey, HANDOVER_EXPIRES_AT: new Date(Date.now() + 55 * 60000).toISOString() }, 'moderation-configuration', {
    values: { VPS_AI_URL: `https://${name}.${subdomain}.workers.dev/moderate`, VPS_AI_SIGNING_KEY: key },
    sourceRevision: process.env.SOURCE_SHA,
  });
  await mkdir('handover-encrypted', { mode: 0o700 });
  await writeFile('handover-encrypted/moderation.json', JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  complete = true;
  console.log(JSON.stringify({ moderationGatewayCreated: true, callerSelectedModels: false, credentialEncryptedForVps: true, sourceRevision: process.env.SOURCE_SHA }));
} catch {
  console.error('Moderation provisioning failed; existing application routing unchanged.'); process.exitCode = 1;
} finally {
  if (attempted && !complete) {
    try { await api(`/workers/scripts/${name}`, 'DELETE'); }
    catch { console.error('Temporary moderation deployment requires cleanup.'); process.exitCode = 1; }
  }
}
