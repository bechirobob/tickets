// Disposable API verification: no production bindings, domains or rows are changed.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudflare, account } from './control-client.mjs';
import { exportDatabase } from './sqlite-export.mjs';
import { writerGuardStatements } from './writer-lock.mjs';
import { controlSchema } from '../../worker/handover-control.ts';
import { captureFrozenDatabase, createVerifiedReturnDatabase, removeDisposableDatabase, replaceDatabaseBinding } from './database-transfer.mjs';
const id = '01234567-89ab-4cde-8123-456789abcdef';
assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
const directory = mkdtempSync(join(tmpdir(), 'tickets-operator-test-'));
const worker = 'tickets-operator-test-' + process.env.GITHUB_RUN_ID;
const endpoint = '/accounts/' + account + '/workers/scripts/' + worker;
const databases = []; let workerAttempted = false;
try {
  const db = new DatabaseSync(':memory:'); let snapshot;
  try {
    db.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY AUTOINCREMENT,content TEXT); INSERT INTO sample VALUES(6,'disposable operator fixture'); UPDATE sqlite_sequence SET seq=100;");
    for (const sql of controlSchema) db.exec(sql);
    for (const sql of writerGuardStatements(['sample'])) db.exec(sql);
    db.prepare("UPDATE _bct_handover_admission SET phase='frozen',transfer_id=? WHERE id=1").run(id);
    db.prepare('UPDATE _bct_handover_state SET frozen=1,transfer_id=? WHERE id=1').run(id);
    snapshot = exportDatabase(db);
  } finally { db.close(); }
  const first = await createVerifiedReturnDatabase(snapshot, worker + '-a'); databases.push(first);
  const restored = await captureFrozenDatabase(first, join(directory, 'restored.sqlite'), id);
  const second = await createVerifiedReturnDatabase(restored, worker + '-b'); databases.push(second);
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'test.mjs', compatibility_date: '2026-08-11', bindings: [{ name: 'DB', type: 'd1', id: first }, { name: 'MARKER', type: 'plain_text', text: 'preserve-me' }, { name: 'TEST_SECRET', type: 'secret_text', text: 'disposable-test-value' }] }));
  form.set('test.mjs', new Blob(['export default {fetch(){return new Response("Private operator API fixture",{status:404})}}'], { type: 'application/javascript+module' }), 'test.mjs');
  workerAttempted = true; await cloudflare(endpoint, 'PUT', form);
  await replaceDatabaseBinding(worker, second);
  console.log(JSON.stringify({ operatorApiVerified: true, frozenCapture: true, reverseDatabaseImport: true, inheritedBindingsPreserved: true, productionChanged: false }));
} catch {
  console.error('Disposable operator API verification failed; production remains unchanged.'); process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  if (workerAttempted) try { await cloudflare(endpoint, 'DELETE'); } catch { cleanupFailed = true; }
  for (const database of databases.reverse()) try { await removeDisposableDatabase(database); } catch { cleanupFailed = true; }
  rmSync(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ disposableStateRemoved: !cleanupFailed }));
  if (cleanupFailed) process.exitCode = 1;
}
