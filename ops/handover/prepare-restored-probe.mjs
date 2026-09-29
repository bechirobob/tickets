import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { exportDatabase } from './sqlite-export.mjs';
process.umask(0o077);
function restore(source, destination) {
  const metadata = lstatSync(source);
  assert.ok(metadata.isFile() && metadata.uid === 0 && !(metadata.mode & 0o077));
  const original = new DatabaseSync(source, { readOnly: true });
  const copy = new DatabaseSync(destination);
  try {
    const snapshot = exportDatabase(original);
    copy.exec('BEGIN'); copy.exec(snapshot.sql); copy.exec('COMMIT');
    assert.deepEqual(exportDatabase(copy), snapshot);
  } finally { original.close(); copy.close(); }
}
try {
  const [directory] = process.argv.slice(2);
  assert.match(directory, /^\/srv\/becore-tickets\/temporary\/restored-probe-\d+$/);
  mkdirSync(directory, { mode: 0o700 });
  const state = path.join(directory, 'state'); mkdirSync(state, { mode: 0o700 });
  const root = '/var/lib/becore-tickets-handover';
  restore(root + '/rehearsal-36505772936/tickets.sqlite', path.join(state, 'tickets.sqlite'));
  mkdirSync(path.join(state, 'rooms'), { mode: 0o700 });
  mkdirSync(path.join(state, 'unmapped-rooms'), { mode: 0o700 });
  const rooms = JSON.parse(readFileSync(root + '/rooms-rehearsal-36507909340/manifest.json', 'utf8'));
  assert.equal(rooms.activated, false);
  const mapped = new Set();
  for (const record of rooms.records) {
    assert.match(record.objectId, /^[a-f0-9]{64}$/);
    if (record.nodeFile) { assert.match(record.nodeFile, /^[a-f0-9]{64}\.sqlite$/); assert.ok(!mapped.has(record.nodeFile)); mapped.add(record.nodeFile); }
    const destination = record.nodeFile ? path.join(state, 'rooms', record.nodeFile) : path.join(state, 'unmapped-rooms', record.objectId + '.sqlite');
    restore(root + '/rooms-rehearsal-36507909340/' + record.objectId + '.sqlite', destination);
  }
  const sourceConfig = '/etc/becore-tickets/runtime.pending.json';
  const metadata = lstatSync(sourceConfig); assert.ok(metadata.isFile() && metadata.uid === 0 && !(metadata.mode & 0o077));
  writeFileSync(path.join(directory, 'config.json'), readFileSync(sourceConfig), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ isolatedRealDatabasePrepared: true, roomsPreserved: rooms.records.length, activeSourceChanged: false }));
} catch { console.error('Restored runtime probe preparation failed.'); process.exitCode = 1; }
