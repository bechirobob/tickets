import { readFileSync, mkdirSync, writeFileSync, existsSync, lstatSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { openEnvelope } from './open-envelope.mjs';
import { restoreRoomEnvelope } from './sqlite-snapshot.mjs';
let destination;
try {
  const [source, transferId, revision] = process.argv.slice(2);
  if (!/^\d+$/.test(transferId ?? '') || !/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error();
  const keyFile = '/etc/becore-tickets/handover/recipient.pem';
  if (!lstatSync(keyFile).isFile() || (lstatSync(keyFile).mode & 0o077)) throw new Error();
  const key = readFileSync(keyFile);
  const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.mode !== 'rooms' || manifest.sourceRevision !== revision || manifest.cutoverSnapshot !== false || !Array.isArray(manifest.roomIds) || !manifest.roomIds.length || new Set(manifest.roomIds).size !== manifest.roomIds.length) throw new Error();
  const root = '/var/lib/becore-tickets-handover';
  mkdirSync(root, { mode: 0o700, recursive: true });
  const directory = root + '/rooms-rehearsal-' + transferId;
  if (existsSync(directory)) throw new Error();
  mkdirSync(directory, { mode: 0o700 }); destination = directory;
  const records = [];
  for (const objectId of manifest.roomIds) {
    if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error();
    const snapshot = openEnvelope(JSON.parse(readFileSync(path.join(source, 'room-' + objectId + '.json'), 'utf8')), key, 'room-rehearsal');
    if (snapshot.objectId !== objectId || snapshot.sourceRevision !== revision) throw new Error();
    const temporary = path.join(directory, objectId + '.sqlite');
    const result = restoreRoomEnvelope(snapshot, temporary);
    chmodSync(temporary, 0o600);
    // Keep original Cloudflare object identity and Node event-name mapping.
    // Empty/removed Rooms are preserved too; never silently drop an orphan.
    records.push({ objectId, nodeFile: result.eventSlug ? createHash('sha256').update(result.eventSlug).digest('hex') + '.sqlite' : null, eventSlug: result.eventSlug, evidence: result.evidence, capturedAt: snapshot.capturedAt });
  }
  const mapped = records.filter(row => row.nodeFile).map(row => row.nodeFile);
  if (new Set(mapped).size !== mapped.length) throw new Error();
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ sourceRevision: revision, records, cutoverSnapshot: false, activated: false }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ roomsRestored: records.length, mappedRooms: mapped.length, preservedUnmappedRooms: records.length - mapped.length, integrityCheck: 'ok', activated: false }));
  destination = undefined;
} catch {
  if (destination) rmSync(destination, { recursive: true, force: true });
  console.error('Encrypted Room restore failed; active services unchanged.'); process.exitCode = 1;
}
