import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { openEnvelope } from '../ops/handover/open-envelope.mjs';

test('internal Worker RPC exports only allowlisted values encrypted for the fixed VPS recipient', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const bundled = await build({ entryPoints: ['worker/handover.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', external: ['cloudflare:workers'] });
  const source = bundled.outputFiles[0].text + '\nexport default { fetch() { return new Response("Not found", { status: 404 }); } };';
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'source', modules: true, script: source, compatibilityDate: '2026-08-11', bindings: {
      HANDOVER_RECIPIENT_SPKI: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      HANDOVER_EXPIRES_AT: new Date(Date.now() + 600000).toISOString(),
      RELEASE_SHA: 'a'.repeat(40), ENVIRONMENT: 'production', VAPID_PRIVATE_KEY: 'synthetic-private-key',
      UNLISTED_SECRET: 'must-not-transfer',
    } },
    { name: 'collector', modules: true, script: 'export default { async fetch(request,env) { return Response.json(await env.SOURCE.configuration()); } };',
      compatibilityDate: '2026-08-11', serviceBindings: { SOURCE: { name: 'source', entrypoint: 'HandoverEntrypoint' } } },
  ] }));
  try {
    const response = await (await mf.getWorker('collector')).fetch('https://internal.test/');
    assert.equal(response.status, 200);
    const envelope = await response.json();
    assert.ok(!JSON.stringify(envelope).includes('synthetic-private-key'));
    const result = openEnvelope(envelope, pair.privateKey, 'configuration');
    assert.deepEqual(result, { revision: 'a'.repeat(40), values: { VAPID_PRIVATE_KEY: 'synthetic-private-key', ENVIRONMENT: 'production' } });
    assert.equal((await (await mf.getWorker('source')).fetch('https://internal.test/')).status, 404);
  } finally { await mf.dispose(); }
});

test('source abort releases its SQL freeze after a lost phase transition, but never releases another transfer', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const bundled = await build({ entryPoints: ['worker/handover.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', external: ['cloudflare:workers'] });
  const source = bundled.outputFiles[0].text + '\nexport default { fetch() { return new Response("Not found", { status: 404 }); } };';
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'source', modules: true, script: source, compatibilityDate: '2026-08-11', d1Databases: ['DB'], bindings: {
      HANDOVER_RECIPIENT_SPKI: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      HANDOVER_EXPIRES_AT: new Date(Date.now() + 600000).toISOString(), RELEASE_SHA: 'a'.repeat(40), HANDOVER_TRACKING: '1',
    } },
    { name: 'collector', modules: true, script: 'export default { async fetch(request,env) { try { const x=await request.json(); return Response.json(await env.SOURCE[x.method](...x.args)); } catch { return new Response("Rejected",{status:409}); } } };',
      compatibilityDate: '2026-08-11', serviceBindings: { SOURCE: { name: 'source', entrypoint: 'HandoverEntrypoint' } } },
  ] }));
  const transfer = '01234567-89ab-4cde-8123-456789abcdef';
  try {
    const collector = await mf.getWorker('collector');
    const rpc = (method,...args) => collector.fetch('https://internal.test/', { method:'POST', body:JSON.stringify({method,args}) });
    assert.equal((await rpc('prepareSource')).status,200);
    assert.equal((await rpc('pauseSource',transfer)).status,200);
    const db = await mf.getD1Database('DB','source');
    await db.exec("CREATE TABLE _bct_handover_state(id INTEGER PRIMARY KEY,frozen INTEGER,transfer_id TEXT)");
    await db.prepare('INSERT INTO _bct_handover_state VALUES(1,1,?)').bind(transfer).run();
    assert.equal((await rpc('resumeSource',transfer)).status,200);
    assert.equal((await db.prepare('SELECT frozen FROM _bct_handover_state').first()).frozen,0);
    assert.equal((await db.prepare('SELECT phase FROM _bct_handover_admission').first()).phase,'active');
    await rpc('pauseSource',transfer);
    await db.prepare('UPDATE _bct_handover_state SET frozen=1,transfer_id=?').bind('11234567-89ab-4cde-8123-456789abcdef').run();
    assert.equal((await rpc('resumeSource',transfer)).status,409);
    assert.equal((await db.prepare('SELECT phase FROM _bct_handover_admission').first()).phase,'paused');
    assert.equal((await db.prepare('SELECT frozen FROM _bct_handover_state').first()).frozen,1);
  } finally { await mf.dispose(); }
});
