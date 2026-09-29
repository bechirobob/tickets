import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { sealHandover } from '../worker/handover-crypto.ts';
import { openEnvelope } from '../ops/handover/open-envelope.mjs';
test('Worker encryption interoperates with VPS decryption and rejects tampering, expiry, purpose and wrong recipient', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const settings = { HANDOVER_RECIPIENT_SPKI: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), HANDOVER_EXPIRES_AT: new Date(Date.now() + 600000).toISOString() };
  const payload = { values: { VAPID_PRIVATE_KEY: 'synthetic-secret-only', ENVIRONMENT: 'production' } };
  const envelope = await sealHandover(settings, 'configuration', payload);
  assert.deepEqual(openEnvelope(envelope, pair.privateKey, 'configuration'), payload);
  assert.throws(() => openEnvelope(envelope, pair.privateKey, 'rooms'));
  assert.throws(() => openEnvelope(envelope, pair.privateKey, 'configuration', Date.now() + 7200000));
  assert.throws(() => openEnvelope({ ...envelope, header: envelope.header + ' ' }, pair.privateKey, 'configuration'));
  const altered = Buffer.from(envelope.ciphertext, 'base64'); altered[0] ^= 1;
  assert.throws(() => openEnvelope({ ...envelope, ciphertext: altered.toString('base64') }, pair.privateKey, 'configuration'));
  const other = generateKeyPairSync('rsa', { modulusLength: 3072 });
  assert.throws(() => openEnvelope(envelope, other.privateKey, 'configuration'));
});
