import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DeliveryQueue } from '../runtime/vps/queue.mjs';
import { RateLimiter } from '../runtime/vps/rate-limit.mjs';

test('delivery retries survive adapter restarts and duplicate enqueues do not multiply work', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const queue = new DeliveryQueue(db);
    await queue.send({ deliveryId: 'order-confirmation:one' });
    await queue.send({ deliveryId: 'order-confirmation:one' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n, 1);
    await queue.process(async batch => batch.messages[0].retry({ delaySeconds: 0 }));
    assert.equal(db.prepare('SELECT attempts FROM delivery_queue').get().attempts, 1);
    const restarted = new DeliveryQueue(db);
    await restarted.process(async batch => {
      assert.equal(batch.messages[0].body.deliveryId, 'order-confirmation:one');
      batch.messages[0].ack();
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n, 0);
  } finally { db.close(); }
});

test('rate limits persist across process adapters without storing raw client identifiers', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const limiter = new RateLimiter(db, 'login', 1);
    assert.equal((await limiter.limit({ key: 'private-client-address' })).success, true);
    const restarted = new RateLimiter(db, 'login', 1);
    assert.equal((await restarted.limit({ key: 'private-client-address' })).success, false);
    const row = db.prepare('SELECT key FROM rate_limits').get();
    assert.match(row.key, /^[a-f0-9]{64}$/);
    assert.notEqual(row.key, 'private-client-address');
  } finally { db.close(); }
});
