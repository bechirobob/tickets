import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DeliveryQueue } from '../runtime/vps/queue.mjs';
import { RateLimiter } from '../runtime/vps/rate-limit.mjs';

test('idle delivery polls reuse one prepared claim statement', async t => {
  const db = new DatabaseSync(':memory:');
  try {
    const prepare = t.mock.method(db, 'prepare');
    const queue = new DeliveryQueue(db);
    for (let poll = 0; poll < 120; poll++) {
      assert.equal(await queue.process(() => assert.fail('An idle queue must not invoke its handler.')), false);
    }
    assert.equal(prepare.mock.callCount(), 1);
  } finally { db.close(); }
});

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



test('confirmation batches persist every unique delivery and preserve per-message delays', async () => {
  const connection = new DatabaseSync(':memory:');
  try {
    const queue = new DeliveryQueue(connection);
    const messages = [
      { body: { deliveryId: 'order-confirmation:BCT-one' } },
      { body: { deliveryId: 'order-confirmation:BCT-two' }, delaySeconds: 120 },
    ];
    await queue.sendBatch(messages);
    await queue.sendBatch(messages);
    assert.equal(connection.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n, 2);
    const rows = connection.prepare('SELECT available-created AS delay FROM delivery_queue ORDER BY available').all();
    assert.deepEqual(rows.map(row => row.delay), [0, 120000]);
    const received = [];
    assert.equal(await queue.process(async batch => { received.push(batch.messages[0].body.deliveryId); batch.messages[0].ack(); }), true);
    assert.deepEqual(received, ['order-confirmation:BCT-one']);
    assert.equal(connection.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n, 1);
  } finally { connection.close(); }
});

for (const action of ['ack', 'retry']) test(`a stale queue consumer cannot ${action} a reclaimed delivery`, async () => {
  const connection = new DatabaseSync(':memory:');
  try {
    const queue = new DeliveryQueue(connection);
    await queue.send({ deliveryId: 'order-confirmation:BCT-leased' });
    let finishOld;
    const old = queue.process(async batch => {
      await new Promise(resolve => { finishOld = resolve; });
      batch.messages[0][action]();
    });
    connection.prepare('UPDATE delivery_queue SET lease=0').run();
    let finishNew;
    const current = queue.process(async batch => {
      await new Promise(resolve => { finishNew = resolve; });
      batch.messages[0].ack();
    });
    const held = connection.prepare('SELECT attempts,lease,available FROM delivery_queue').get();
    assert.equal(held.attempts, 2);
    finishOld(); await old;
    assert.deepEqual(connection.prepare('SELECT attempts,lease,available FROM delivery_queue').get(), held);
    finishNew(); await current;
    assert.equal(connection.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n, 0);
  } finally { connection.close(); }
});
