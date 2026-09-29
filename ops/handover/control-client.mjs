// Authenticated, short-lived operator RPC. No credentials or private payloads
// may be written to logs. Persistent writer locks outlive this temporary caller.
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
export const account = 'af75a230de2eea882606db8d9acce473';
export async function cloudflare(path, method = 'GET', body) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method, headers: { authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.text();
  // Some domain mutations return a successful empty response. Callers verify
  // the resulting resource separately rather than treating JSON absence as failure.
  if (response.ok && !payload) return null;
  const result = JSON.parse(payload);
  if (!response.ok || !result.success || result.result?.some?.(row => row.success === false)) throw new Error(`Cloudflare operator request failed (${response.status}).`);
  return result.result;
}
export async function withControl(revision, operation) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{40}$/.test(revision) || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')) throw new Error('Invalid operator context.');
  const prefix = '/accounts/' + account;
  const worker = prefix + '/workers/scripts/becore-tickets';
  const collector = 'tickets-control-' + process.env.GITHUB_RUN_ID;
  const collectorPath = prefix + '/workers/scripts/' + collector;
  const recipient = JSON.parse(await readFile(new URL('./recipient.json', import.meta.url), 'utf8'));
  if (createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex') !== recipient.fingerprint) throw new Error('Invalid recipient.');
  const existing = await cloudflare(worker + '/secrets');
  const names = ['HANDOVER_RECIPIENT_SPKI', 'HANDOVER_EXPIRES_AT'];
  if (existing.some(item => names.includes(item.name))) throw new Error('Previous handover window requires review.');
  const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  const enabled = []; let attempted = false;
  try {
    for (const [name, text] of [[names[0], recipient.publicKey], [names[1], expiresAt]]) {
      enabled.push(name);
      await cloudflare(worker + '/secrets', 'PUT', { name, text, type: 'secret_text' });
    }
    const token = randomBytes(32).toString('hex');
    const methods = ['configuration', 'backupRecovery', 'roomIdentity', 'prepareSource', 'sourceStatus', 'pauseSource', 'freezeSource', 'freezeRoom', 'roomSnapshot', 'restoreRoom', 'resumeRoom', 'resumeSource', 'markTransferred'];
    const script = `const allowed=${JSON.stringify(methods)}; export default {async fetch(request,env){
      if(request.method!=='POST'||request.headers.get('authorization')!=='Bearer '+env.TOKEN||Date.now()>=Date.parse(env.EXPIRES_AT))return new Response('Not found',{status:404});
      try{const input=await request.json();if(!allowed.includes(input.method)||!Array.isArray(input.args))throw new Error();
        const value=await env.SOURCE[input.method](...input.args);return Response.json(value,{headers:{'cache-control':'no-store'}});
      }catch{return new Response('Handover operation rejected',{status:409});}
    }};`;
    const form = new FormData();
    form.set('metadata', JSON.stringify({ main_module: 'control.mjs', compatibility_date: '2026-08-11', bindings: [
      { type: 'service', name: 'SOURCE', service: 'becore-tickets', entrypoint: 'HandoverEntrypoint' },
      { type: 'secret_text', name: 'TOKEN', text: token }, { type: 'plain_text', name: 'EXPIRES_AT', text: expiresAt },
    ], observability: { enabled: false } }));
    form.set('control.mjs', new Blob([script], { type: 'application/javascript+module' }), 'control.mjs');
    attempted = true; await cloudflare(collectorPath, 'PUT', form);
    await cloudflare(collectorPath + '/subdomain', 'POST', { enabled: true });
    const { subdomain } = await cloudflare(prefix + '/workers/subdomain');
    if (!/^[a-z0-9-]+$/.test(subdomain)) throw new Error('Invalid subdomain.');
    const rpc = async (method, ...args) => {
      if (!methods.includes(method)) throw new Error('Invalid operator method.');
      const response = await fetch(`https://${collector}.${subdomain}.workers.dev/`, {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`Operator RPC ${method} rejected (${response.status}); inspect state before retrying.`);
      return response.json();
    };
    // Poll only a read-only readiness check. Never retry a lost mutation blindly.
    let ready = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      try { const status = await rpc('sourceStatus'); if (status.revision !== revision) throw new Error('revision'); ready = true; break; }
      catch { if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000)); }
    }
    if (!ready) throw new Error('Source control is not initialized at the expected revision.');
    return await operation(rpc, { expiresAt, recipient });
  } finally {
    let failed = false;
    if (attempted) try { await cloudflare(collectorPath, 'DELETE'); } catch { failed = true; }
    for (const name of enabled.reverse()) try { await cloudflare(worker + '/secrets/' + name, 'DELETE'); } catch { failed = true; }
    if (failed) throw new Error('Temporary operator cleanup needs intervention; persistent writer state was not changed.');
  }
}
