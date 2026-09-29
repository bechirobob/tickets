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
