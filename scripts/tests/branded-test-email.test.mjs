import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueuePreview, makePayload, resolveRecipient, sha256, validateRequest } from '../send-branded-test-email.mjs';

const now = Date.now();
const request = { requestId: 'test-request-01', template: 'october-rsvp', subject: '[TEST] Event reminder', recipientSha256: sha256('owner@example.com'), expiresAt: new Date(now + 3600_000).toISOString() };
test('requires a recent test authorization and rejects additional recipients', () => {
  validateRequest(request, now);
  assert.throws(() => validateRequest({ ...request, expiresAt: new Date(now - 1).toISOString() }, now));
  assert.throws(() => validateRequest({ ...request, cc: ['guest@example.com'] }, now));
  assert.throws(() => validateRequest({ ...request, subject: '[TEST] x\r\nBcc: other@example.com' }, now));
});
test('resolves only the exact authorized address without requiring or changing staff access', () => {
  const owner = { normalized_email: 'owner@example.com', role: 'owner', status: 'active' };
  assert.equal(resolveRecipient([owner, { ...owner, normalized_email: 'other@example.com' }], request.recipientSha256), owner.normalized_email);
  assert.equal(resolveRecipient([{ ...owner, status: 'disabled' }], request.recipientSha256), owner.normalized_email);
  assert.equal(resolveRecipient([owner, owner], request.recipientSha256), owner.normalized_email);
  assert.throws(() => resolveRecipient([{ ...owner, normalized_email: 'other@example.com' }], request.recipientSha256));
  assert.throws(() => resolveRecipient([], request.recipientSha256));
});
test('uses immutable public artwork and keeps the test warning', () => {
  const payload = makePayload(request, '<p>TEST EMAIL</p><img src="{{FLIER_URL}}">', 'TEST EMAIL', 'a'.repeat(40));
  assert.match(payload.html, /\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/emails\/tests\/on-the-guest-list.jpg/);
  assert.equal(payload.idempotencyKey, 'email-preview/test-request-01');
  assert.throws(() => makePayload(request, 'TEST EMAIL {{FLIER_URL}}', 'TEST EMAIL', 'main'));
});
test('replays do not enqueue a second email and changed content cannot reuse an ID', async () => {
  let saved;
  let insertions = 0;
  const query = async (sql, params) => {
    if (sql.startsWith('INSERT')) { if (!saved) { insertions++; saved = { recipient: params[1], payload_json: params[2], status: 'queued' }; } return []; }
    return [saved];
  };
  const payload = makePayload(request, 'TEST EMAIL {{FLIER_URL}}', 'TEST EMAIL', 'a'.repeat(40));
  await enqueuePreview(query, request, 'owner@example.com', payload);
  await enqueuePreview(query, request, 'owner@example.com', payload);
  assert.equal(insertions, 1);
  await assert.rejects(enqueuePreview(query, request, 'owner@example.com', { ...payload, subject: '[TEST] Changed' }));
  await assert.rejects(enqueuePreview(query, request, 'other@example.com', payload));
});
