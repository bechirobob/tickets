import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDatabase } from '../runtime/vps/database.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('prepared statement reuse never carries bindings between guests and stays bounded', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    assert.equal(await db.prepare('SELECT ? AS guest').bind('first').first('guest'), 'first');
    assert.equal(await db.prepare('SELECT ? AS guest').bind('second').first('guest'), 'second');
    assert.equal(await db.prepare('SELECT ? AS guest').first('guest'), null);
    for (let i = 0; i < 300; i++) await db.prepare(`SELECT ${i} AS n`).first();
    assert.ok(db.statements.size <= 256);
    await db.exec('CREATE TABLE fixture(id INTEGER)');
    assert.equal(db.statements.size, 0);
    assert.deepEqual(await db.prepare('SELECT * FROM fixture').raw({ columnNames: true }), [['id']]);
    await db.exec('ALTER TABLE fixture ADD COLUMN label TEXT');
    assert.deepEqual(await db.prepare('SELECT * FROM fixture').raw({ columnNames: true }), [['id', 'label']]);
  } finally { db.close(); }
});

test('concurrent commits preserve independent rollback, inventory limits and restart durability', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tickets-group-commit-'));
  const file = path.join(directory, 'tickets.sqlite');
  let db = new SqliteDatabase(file);
  try {
    await db.exec('CREATE TABLE inventory(id INTEGER PRIMARY KEY, remaining INTEGER); INSERT INTO inventory VALUES (1, 40); CREATE TABLE claims(id INTEGER PRIMARY KEY);');
    const outcomes = await Promise.allSettled(Array.from({ length: 80 }, (_, i) => db.batch([
      db.prepare('UPDATE inventory SET remaining=remaining-1 WHERE id=1 AND remaining>0'),
      db.prepare('INSERT INTO claims(id) SELECT ? WHERE changes()=1').bind(i),
      ...(i === 0 ? [db.prepare('INSERT INTO inventory VALUES (1, 9)')] : []),
    ])));
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM claims').first('n'), 40);
    assert.equal(await db.prepare('SELECT remaining FROM inventory').first('remaining'), 0);
    assert.equal(await db.prepare('SELECT id FROM claims WHERE id=0').first(), null);
    db.close(); db = new SqliteDatabase(file);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM claims').first('n'), 40);
    assert.equal(db.connection.prepare('PRAGMA synchronous').get().synchronous, 2);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a physical commit failure rejects every grouped success and leaves no partial writes', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE claims(id INTEGER PRIMARY KEY)');
    const execute = db.connection.exec.bind(db.connection);
    db.connection.exec = sql => { if (sql === 'COMMIT') throw new Error('Synthetic disk failure'); return execute(sql); };
    const outcomes = await Promise.allSettled([1, 2, 3].map(id => db.batch([db.prepare('INSERT INTO claims VALUES (?)').bind(id)])));
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 3);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM claims').first('n'), 0);
  } finally { db.close(); }
});

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


test('standalone conditional writes keep one winner under a simultaneous burst', async () => {
  const db = new SqliteDatabase(':memory:');
  try {
    await db.exec('CREATE TABLE admission(id INTEGER PRIMARY KEY, used INTEGER); INSERT INTO admission VALUES(1,0)');
    const results = await Promise.all(Array.from({ length: 100 }, () => db.prepare('UPDATE admission SET used=1 WHERE id=1 AND used=0').run()));
    assert.equal(results.reduce((sum, result) => sum + result.meta.changes, 0), 1);
    assert.equal(await db.prepare('SELECT used FROM admission').first('used'), 1);
  } finally { db.close(); }
});
