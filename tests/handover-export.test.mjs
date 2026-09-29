import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { exportDatabase } from '../ops/handover/sqlite-export.mjs';

test('reverse SQL export preserves binary, Unicode, embedded NUL, quotes, large integers, deleted sequences and new writes', () => {
  const source = new DatabaseSync(':memory:'); const target = new DatabaseSync(':memory:');
  try {
    source.exec('CREATE TABLE records(id INTEGER PRIMARY KEY AUTOINCREMENT,text_value TEXT,blob_value BLOB,integer_value INTEGER); CREATE INDEX records_value_idx ON records(text_value);');
    source.prepare('INSERT INTO records(id,text_value,blob_value,integer_value) VALUES(?,?,?,?)').run(1, "a\0quote'🔥", new Uint8Array([0,255,128]), 9007199254740993n);
    source.exec("INSERT INTO records(id,text_value) VALUES(999,'deleted'); DELETE FROM records WHERE id=999;");
    const snapshot = exportDatabase(source);
    target.exec('BEGIN;'); target.exec(snapshot.sql); target.exec('COMMIT;');
    assert.deepEqual(exportDatabase(target).evidence, snapshot.evidence);
    assert.equal(target.prepare('SELECT text_value FROM records').get().text_value, "a\0quote'🔥");
    target.exec("INSERT INTO records(text_value) VALUES('post-switch')");
    assert.equal(target.prepare("SELECT id FROM records WHERE text_value='post-switch'").get().id,1000);
  } finally { source.close(); target.close(); }
});

test('export retains generated columns, SQL objects, real storage types and 64-bit sequence high-water marks', () => {
  const source = new DatabaseSync(':memory:'), target = new DatabaseSync(':memory:');
  try {
    source.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY AUTOINCREMENT, value, doubled GENERATED ALWAYS AS (value*2) STORED);
      CREATE TABLE audit(id INTEGER);
      CREATE VIEW z_view AS SELECT id,value FROM records;
      CREATE TRIGGER a_view_write INSTEAD OF INSERT ON z_view BEGIN INSERT INTO records(value) VALUES(NEW.value); END;
      CREATE TRIGGER record_audit AFTER INSERT ON records BEGIN INSERT INTO audit VALUES(NEW.id); END;
      INSERT INTO records(value) VALUES(1.0), (1.2345678901234567), (NULL);
      UPDATE sqlite_sequence SET seq=9007199254740993 WHERE name='records';`);
    const snapshot = exportDatabase(source);
    target.exec('BEGIN'); target.exec(snapshot.sql); target.exec('COMMIT');
    const copy = exportDatabase(target);
    assert.deepEqual(copy, snapshot);
    assert.equal(target.prepare('SELECT typeof(value) AS t FROM records WHERE id=1').get().t, 'real');
    assert.equal(target.prepare('SELECT value FROM records WHERE id=2').get().value, 1.2345678901234567);
    target.exec('INSERT INTO z_view(value) VALUES(4)');
    const query = target.prepare('SELECT MAX(id) AS id FROM records'); query.setReadBigInts(true);
    assert.equal(query.get().id, 9007199254740994n);
  } finally { source.close(); target.close(); }
});

test('rejects invalid references and nested transactions without committing caller data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(parent_id REFERENCES parent(id)); BEGIN;');
    assert.throws(() => exportDatabase(db), /own consistent read transaction/);
    assert.equal(db.isTransaction, true); db.exec('ROLLBACK; PRAGMA foreign_keys=OFF; INSERT INTO child VALUES(1);');
    assert.throws(() => exportDatabase(db), /integrity failed/);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});
