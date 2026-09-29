import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { exportDatabase } from './sqlite-export.mjs';
import { sealHandover } from '../../worker/handover-crypto.ts';
process.umask(0o077);
try {
  const [recipientFile, output] = process.argv.slice(2);
  const recipient = JSON.parse(readFileSync(recipientFile, 'utf8'));
  assert.match(recipient.runId, /^\d+$/);
  assert.equal(createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex'), recipient.fingerprint);
  const root = '/var/lib/becore-tickets-handover';
  const manifest = JSON.parse(readFileSync(root + '/rooms-rehearsal-36507909340/manifest.json', 'utf8'));
  assert.equal(manifest.activated, false);
  const files = [root + '/rehearsal-36505772936/tickets.sqlite', ...manifest.records.map(record => {
    assert.match(record.objectId, /^[a-f0-9]{64}$/);
    return root + '/rooms-rehearsal-36507909340/' + record.objectId + '.sqlite';
  })];
  const snapshots = files.map(file => {
    const metadata = lstatSync(file);
    assert.ok(metadata.isFile() && metadata.uid === 0 && !(metadata.mode & 0o077));
    const db = new DatabaseSync(file, { readOnly: true });
    try { return exportDatabase(db); } finally { db.close(); }
  });
  const envelope = await sealHandover({ HANDOVER_RECIPIENT_SPKI: recipient.publicKey, HANDOVER_EXPIRES_AT: recipient.expiresAt }, 'vps-return-rehearsal', { runId: recipient.runId, fingerprint: recipient.fingerprint, snapshots });
  writeFileSync(output, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ encryptedReturnSnapshots: snapshots.length, liveStateChanged: false }));
} catch { console.error('Private return export failed; no live state changed.'); process.exitCode = 1; }
