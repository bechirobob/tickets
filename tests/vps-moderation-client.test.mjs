import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createModerationBinding } from '../runtime/vps/moderation.mjs';

test('VPS moderation authenticates image bytes, fixes destination and fails closed on invalid responses', async () => {
  const original = globalThis.fetch;
  const values = { VPS_AI_URL: 'https://becore-tickets-moderation.becoreops.workers.dev/moderate', VPS_AI_SIGNING_KEY: 'synthetic-client-key' };
  let requests = 0;
  try {
    globalThis.fetch = async (url, options) => {
      requests++;
      assert.equal(String(url), values.VPS_AI_URL);
      assert.equal(options.redirect, 'error');
      assert.deepEqual([...options.body], [255, 216, 255]);
      const digest = createHash('sha256').update(options.body).digest('hex');
      const expected = createHmac('sha256', values.VPS_AI_SIGNING_KEY).update(`tickets-moderation-v1\n${options.headers['x-bct-timestamp']}\n${digest}`).digest('hex');
      assert.equal(options.headers['x-bct-signature'], expected);
      return Response.json({ response: 'ALLOW' });
    };
    const binding = createModerationBinding(values);
    assert.deepEqual(await binding.run('@cf/meta/llama-3.2-11b-vision-instruct', { image: [255,216,255] }), { response: 'ALLOW' });
    await assert.rejects(binding.run('another-model', { image: [255,216,255] }), /Invalid photo/);
    await assert.rejects(createModerationBinding({ ...values, VPS_AI_URL: 'https://untrusted.invalid/moderate' }).run('@cf/meta/llama-3.2-11b-vision-instruct', { image: [255,216,255] }), /destination/);
    assert.equal(requests, 1);
    globalThis.fetch = async () => Response.json({ response: 'maybe' });
    await assert.rejects(binding.run('@cf/meta/llama-3.2-11b-vision-instruct', { image: [255,216,255] }), /invalid response/);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.rejects(binding.run('@cf/meta/llama-3.2-11b-vision-instruct', { image: [255,216,255] }), /unavailable/);
  } finally { globalThis.fetch = original; }
});
