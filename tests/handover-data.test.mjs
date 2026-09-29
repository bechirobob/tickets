import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { databaseEvidence, restoreSqlSnapshot, roomSnapshot, restoreRoomSnapshot } from '../ops/handover/sqlite-snapshot.mjs';

test('SQL restore preserves identifiers, binary values, references and detects corrupt references', () => {
  const sql = "CREATE TABLE parent(id TEXT PRIMARY KEY, secret BLOB); CREATE TABLE child(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id)); INSERT INTO parent VALUES('existing-ticket',X'0001ff'); INSERT INTO child VALUES('existing-scan','existing-ticket');";
  const first = restoreSqlSnapshot(sql, ':memory:');
  const second = restoreSqlSnapshot(sql, ':memory:');
  assert.deepEqual(first, second);
  assert.equal(first.parent.rows, 1);
  assert.throws(() => restoreSqlSnapshot(sql + "INSERT INTO child VALUES('bad','missing');", ':memory:'), /FOREIGN KEY constraint failed|references/);
});

test('Room data round trip preserves sequence, reactions and deleted history; invalid import rolls back', () => {
  const schema = 'CREATE TABLE room_config(id INTEGER PRIMARY KEY, event_slug TEXT); CREATE TABLE messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,content TEXT,deleted_at TEXT); CREATE TABLE reactions(message_id TEXT,attendee_id TEXT,emoji TEXT,PRIMARY KEY(message_id,attendee_id,emoji));';
  const source = new DatabaseSync(':memory:'); const target = new DatabaseSync(':memory:'); const rejected = new DatabaseSync(':memory:');
  try {
    for (const db of [source,target,rejected]) db.exec(schema);
    source.exec("INSERT INTO room_config VALUES(1,'original-room'); INSERT INTO messages VALUES(93,'original-id','Hello 🔥',NULL),(95,'deleted-id','Removed','2026-09-29'); INSERT INTO reactions VALUES('original-id','original-guest','❤️');");
    const snapshot = roomSnapshot(source);
    restoreRoomSnapshot(target, snapshot);
    assert.deepEqual(databaseEvidence(target), databaseEvidence(source));
    assert.deepEqual(roomSnapshot(target), snapshot);
    assert.throws(() => restoreRoomSnapshot(target, snapshot), /empty/);
    const bad = structuredClone(snapshot); bad.reactions[0].unexpected = true;
    assert.throws(() => restoreRoomSnapshot(rejected, bad), /schema/);
    assert.equal(rejected.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
    target.exec("INSERT INTO messages(id,content) VALUES('next','Next')");
    assert.equal(target.prepare("SELECT sequence FROM messages WHERE id='next'").get().sequence, 96);
  } finally { source.close(); target.close(); rejected.close(); }
});
