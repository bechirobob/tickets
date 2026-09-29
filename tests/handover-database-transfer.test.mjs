import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureFrozenDatabase } from '../ops/handover/database-transfer.mjs';
import { writerGuardStatements } from '../ops/handover/writer-lock.mjs';
const id = '01234567-89ab-4cde-8123-456789abcdef';
test('frozen D1 transport retains exact types, triggers, sequence high-water marks and writer exclusion', async () => {
  const source = new DatabaseSync(':memory:');
  source.exec("CREATE TABLE data(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT,bytes BLOB,large INTEGER); INSERT INTO data VALUES(10,'original',X'0000ff',9223372036854775807); UPDATE sqlite_sequence SET seq=100; CREATE TABLE _bct_handover_operations(id TEXT); CREATE TABLE _bct_handover_admission(id INTEGER PRIMARY KEY,phase TEXT,transfer_id TEXT); ");
  source.prepare('INSERT INTO _bct_handover_admission VALUES(1,?,?)').run('frozen', id);
  for (const sql of writerGuardStatements(['data'])) source.exec(sql);
  source.prepare('UPDATE _bct_handover_state SET frozen=1,transfer_id=?').run(id);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith('/query'));
    const input = JSON.parse(options.body);
    const rows = source.prepare(input.sql).all(...(input.params ?? []));
    return Response.json({ success: true, result: [{ success: true, results: rows }] });
  };
  const directory = mkdtempSync(path.join(os.tmpdir(), 'tickets-frozen-d1-'));
  try {
    const target = path.join(directory, 'restored.sqlite');
    const evidence = await captureFrozenDatabase('01234567-89ab-4cde-8123-456789abcdef', target, id);
    assert.equal(evidence.evidence.data.rows, 1);
    const restored = new DatabaseSync(target);
    try {
      assert.throws(() => restored.exec("INSERT INTO data(value) VALUES('forbidden')"), /paused/);
      const statement = restored.prepare('SELECT large FROM data'); statement.setReadBigInts(true);
      assert.equal(statement.get().large, 9223372036854775807n);
      restored.exec('UPDATE _bct_handover_state SET frozen=0');
      restored.exec("INSERT INTO data(value) VALUES('new')");
      assert.equal(restored.prepare('SELECT MAX(id) AS n FROM data').get().n, 101);
    } finally { restored.close(); }
    await assert.rejects(captureFrozenDatabase('01234567-89ab-4cde-8123-456789abcdef', ':memory:', '11234567-89ab-4cde-8123-456789abcdef'));
  } finally { globalThis.fetch = originalFetch; source.close(); rmSync(directory, { recursive: true, force: true }); }
});
