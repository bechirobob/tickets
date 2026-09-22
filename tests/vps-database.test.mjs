import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../runtime/vps/database.mjs';

test('a failed batch rolls back all inventory changes', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE tickets(id TEXT PRIMARY KEY, quantity INTEGER); INSERT INTO tickets VALUES ("a", 5);'.replaceAll('"', "'"));
    await assert.rejects(db.batch([db.prepare('UPDATE tickets SET quantity=quantity-1 WHERE id=?').bind('a'), db.prepare('INSERT INTO tickets VALUES (?,?)').bind('a', 3)]));
    assert.equal(await db.prepare('SELECT quantity FROM tickets WHERE id=?').bind('a').first('quantity'), 5);
  } finally { db.close(); }
});

test('RETURNING, change counts and binary data preserve the D1 contract', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE photos(id INTEGER PRIMARY KEY, body BLOB)');
    const inserted = await db.prepare('INSERT INTO photos(body) VALUES (?) RETURNING id').bind(new Uint8Array([0, 255])).all();
    assert.equal(inserted.meta.changes, 1);
    assert.equal(inserted.results[0].id, 1);
    assert.deepEqual(await db.prepare('SELECT body FROM photos').first('body'), [0, 255]);
    assert.equal((await db.prepare('UPDATE photos SET body=? WHERE id=99').bind([1]).run()).meta.changes, 0);
  } finally { db.close(); }
});
