import { readFileSync, mkdirSync, writeFileSync, existsSync, lstatSync, rmSync, chmodSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { openEnvelope } from './ops/handover/open-envelope.mjs';
import { restoreSqlSnapshot } from './ops/handover/sqlite-snapshot.mjs';
let destination;
try {
  const [envelopeFile, transferId] = process.argv.slice(2);
  if (!/^\d+$/.test(transferId ?? '')) throw new Error();
  const keyFile = '/etc/becore-tickets/handover/recipient.pem';
  if (!lstatSync(keyFile).isFile() || (lstatSync(keyFile).mode & 0o077)) throw new Error();
  const snapshot = openEnvelope(JSON.parse(readFileSync(envelopeFile, 'utf8')), readFileSync(keyFile), 'd1-rehearsal');
  if (snapshot.databaseId !== '8f8723c2-673a-4aba-b025-83c05d67d075' || snapshot.snapshotType !== 'rehearsal-not-cutover' || !/^[a-f0-9]{40}$/.test(snapshot.sourceRevision ?? '')) throw new Error();
  const sql = gunzipSync(Buffer.from(snapshot.sqlGzip, 'base64'), { maxOutputLength: 128 * 1024 * 1024 });
  if (createHash('sha256').update(sql).digest('hex') !== snapshot.sha256) throw new Error();
  const root = '/var/lib/becore-tickets-handover';
  mkdirSync(root, { mode: 0o700, recursive: true });
  const directory = root + '/rehearsal-' + transferId;
  if (existsSync(directory)) throw new Error();
  mkdirSync(directory, { mode: 0o700 });
  destination = directory;
  const evidence = restoreSqlSnapshot(sql.toString('utf8'), directory + '/tickets.sqlite');
  chmodSync(directory + '/tickets.sqlite', 0o600);
  const manifest = { sourceRevision: snapshot.sourceRevision, snapshotType: snapshot.snapshotType, importedAt: new Date().toISOString(), evidence, activated: false };
  writeFileSync(directory + '/manifest.json', JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
  const counts = Object.fromEntries(Object.entries(evidence).map(([name, value]) => [name, value.rows]));
  console.log(JSON.stringify({ databaseRestored: true, integrityCheck: 'ok', foreignKeys: 'ok', sourceRevision: snapshot.sourceRevision, tableCounts: counts, activated: false }));
  destination = undefined;
} catch {
  if (destination) rmSync(destination, { recursive: true, force: true });
  console.error('Encrypted database restore failed; active services unchanged.');
  process.exitCode = 1;
}
