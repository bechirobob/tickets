import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writerGuardStatements, transitionWriterSql } from '../ops/handover/writer-lock.mjs';

test('source freeze blocks every mutation atomically, survives reopening, and requires its own transfer identity to release', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tickets-writer-lock-'));
  const file = path.join(directory, 'database.sqlite');
  let db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE tickets(id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id));');
    for (const sql of writerGuardStatements(['orders', 'tickets'])) db.exec(sql);
    db.exec("INSERT INTO orders VALUES('original-order','paid'); INSERT INTO tickets VALUES('original-ticket','original-order');");
    const transferId = randomUUID();
    const freeze = transitionWriterSql(transferId, true);
    assert.equal(db.prepare(freeze.sql).get(...freeze.params).frozen, 1);
    db.close(); db = new DatabaseSync(file);
    for (const sql of ["INSERT INTO orders VALUES('new','pending')", "UPDATE orders SET status='changed'", 'DELETE FROM orders', "INSERT OR REPLACE INTO orders VALUES('original-order','changed')", "INSERT INTO tickets VALUES('new-ticket','original-order')", "UPDATE tickets SET id='changed'", 'DELETE FROM tickets']) assert.throws(() => db.exec(sql), /Source writer is paused/);
    const other = transitionWriterSql(randomUUID(), false);
    assert.equal(db.prepare(other.sql).get(...other.params), undefined);
    const takeover = transitionWriterSql(randomUUID(), true);
    assert.equal(db.prepare(takeover.sql).get(...takeover.params), undefined);
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='original-order'").get().status, 'paid');
    const resume = transitionWriterSql(transferId, false);
    assert.equal(db.prepare(resume.sql).get(...resume.params).frozen, 0);
    db.exec("UPDATE orders SET status='resumed'");
    assert.equal(db.prepare("SELECT status FROM orders WHERE id='original-order'").get().status, 'resumed');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
