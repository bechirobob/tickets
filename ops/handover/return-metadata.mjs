import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { exportDatabase } from './sqlite-export.mjs';
export function restoredReturnSnapshot() {
  const file = '/var/lib/becore-tickets-handover/rehearsal-36505772936/tickets.sqlite';
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.uid !== 0 || (metadata.mode & 0o077)) throw new Error('Private source required.');
  const db = new DatabaseSync(file, { readOnly: true });
  try { return exportDatabase(db); } finally { db.close(); }
}
export function returnMetadata(snapshot) {
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { sqlMD5: createHash('md5').update(snapshot.sql).digest('hex'), phases: Object.fromEntries(Object.entries(snapshot.phases).map(([name, sql]) => [name, { md5: createHash('md5').update(sql).digest('hex'), bytes: Buffer.byteLength(sql) }])), evidenceSHA256: sha(snapshot.evidence), schemaSHA256: sha(snapshot.schema), sequencesSHA256: sha(snapshot.sequences), tables: Object.keys(snapshot.evidence).length, rows: Object.values(snapshot.evidence).reduce((sum, row) => sum + row.rows, 0) };
}
if (process.argv[2] === '--inspect') {
  try { console.log(JSON.stringify({ returnMetadata: returnMetadata(restoredReturnSnapshot()) })); }
  catch { console.error('Private export metadata check failed.'); process.exitCode = 1; }
}
