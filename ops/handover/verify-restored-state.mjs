// Runs on Hermes. Private rows and SQL never leave the host or enter logs.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, lstatSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { exportDatabase } from './sqlite-export.mjs';
import { writerGuardStatements, transitionWriterSql } from './writer-lock.mjs';

process.umask(0o077);
const root = '/var/lib/becore-tickets-handover';
let temporary;
function privateFile(file) {
  const metadata = lstatSync(file);
  assert.ok(metadata.isFile() && metadata.uid === 0 && !(metadata.mode & 0o077), 'Private file permission check failed.');
  return file;
}
function roundTrip(file) {
  const source = new DatabaseSync(privateFile(file), { readOnly: true });
  const destination = path.join(temporary, randomUUID() + '.sqlite');
  const target = new DatabaseSync(destination);
  try {
    const snapshot = exportDatabase(source);
    target.exec('PRAGMA foreign_keys=ON; BEGIN');
    try { target.exec(snapshot.sql); target.exec('COMMIT'); }
    catch (error) { if (target.isTransaction) target.exec('ROLLBACK'); throw error; }
    assert.deepEqual(exportDatabase(target), snapshot, 'Reverse SQL round-trip mismatch.');
    // Exercise a durable stop/resume on the disposable restored copy only.
    const names = snapshot.schema.filter(row => row.type === 'table').map(row => row.name);
    assert.ok(!names.includes('_bct_handover_state'), 'Unexpected pre-existing writer state.');
    for (const sql of writerGuardStatements(names)) target.exec(sql);
    const transfer = randomUUID();
    const freeze = transitionWriterSql(transfer, true);
    assert.equal(target.prepare(freeze.sql).get(...freeze.params).frozen, 1);
    for (const name of names) {
      // A no-op update on a populated table must still be blocked by its guard.
      if (!snapshot.evidence[name].rows) continue;
      const column = snapshot.evidence[name].columns[0];
      const quote = value => '"' + value.replaceAll('"', '""') + '"';
      assert.throws(() => target.exec(`UPDATE ${quote(name)} SET ${quote(column)}=${quote(column)}`), /Source writer is paused/);
    }
    const resume = transitionWriterSql(transfer, false);
    assert.equal(target.prepare(resume.sql).get(...resume.params).frozen, 0);
    return { tables: names.length, rows: Object.values(snapshot.evidence).reduce((total, table) => total + table.rows, 0), reverseSqlVerified: true, isolatedWriterGuardVerified: true };
  } finally { source.close(); target.close(); }
}
try {
  const [databaseTransfer, roomTransfer, revision] = process.argv.slice(2);
  assert.match(databaseTransfer ?? '', /^\d+$/); assert.match(roomTransfer ?? '', /^\d+$/); assert.match(revision ?? '', /^[a-f0-9]{40}$/);
  assert.equal(process.getuid(), 0);
  const databaseDirectory = path.join(root, 'rehearsal-' + databaseTransfer);
  const roomDirectory = path.join(root, 'rooms-rehearsal-' + roomTransfer);
  const databaseManifest = JSON.parse(readFileSync(privateFile(path.join(databaseDirectory, 'manifest.json')), 'utf8'));
  const roomManifest = JSON.parse(readFileSync(privateFile(path.join(roomDirectory, 'manifest.json')), 'utf8'));
  assert.equal(databaseManifest.activated, false); assert.equal(databaseManifest.snapshotType, 'rehearsal-not-cutover');
  assert.equal(roomManifest.activated, false); assert.equal(roomManifest.cutoverSnapshot, false);
  assert.ok(Array.isArray(roomManifest.records) && roomManifest.records.length > 0);
  temporary = mkdtempSync(path.join(root, 'verify-'));
  const database = roundTrip(path.join(databaseDirectory, 'tickets.sqlite'));
  const rooms = roomManifest.records.map(record => {
    assert.match(record.objectId, /^[a-f0-9]{64}$/);
    return roundTrip(path.join(roomDirectory, record.objectId + '.sqlite'));
  });
  const configuration = JSON.parse(readFileSync(privateFile('/etc/becore-tickets/runtime.pending.json'), 'utf8'));
  for (const name of ['STAFF_LOGIN_DECOY_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY']) assert.ok(configuration[name]);
  const report = { verifiedAt: new Date().toISOString(), verifierRevision: revision, databaseTransfer, roomTransfer,
    database, rooms: { restored: rooms.length, allReverseSqlVerified: rooms.every(row => row.reverseSqlVerified), allIsolatedWriterGuardsVerified: rooms.every(row => row.isolatedWriterGuardVerified) },
    configurationPrivate: true, liveWritesPaused: false, cutoverReady: false, activated: false,
    remaining: 'Coordinated Cloudflare D1/Room/queue freeze, fresh final snapshot, reverse import to Cloudflare, and secured public routing rehearsal.' };
  const reportFile = path.join(root, 'standby-verification.json');
  writeFileSync(reportFile + '.pending', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  renameSync(reportFile + '.pending', reportFile);
  console.log(JSON.stringify(report));
} catch {
  console.error('Standby round-trip verification failed. Private data and active services were not changed.');
  process.exitCode = 1;
} finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
