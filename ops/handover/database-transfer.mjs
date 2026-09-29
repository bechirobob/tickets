// Private operator transport. Raw rows and signed upload URLs never leave memory.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cloudflare, account } from './control-client.mjs';
import { exportDatabase, tableDigestQuery, digestRows } from './sqlite-export.mjs';
const root = '/accounts/' + account + '/d1/database';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name";
export async function query(database, sql, params) {
  assert.match(database, /^[a-f0-9-]{36}$/);
  return (await cloudflare(root + '/' + database + '/query', 'POST', { sql, ...(params ? { params } : {}) }))[0].results;
}
export async function verifyCloudflareDatabase(database, snapshot) {
  assert.deepEqual(await query(database, 'PRAGMA foreign_key_check'), []);
  assert.deepEqual(await query(database, schemaSql), snapshot.schema);
  for (const [table, expected] of Object.entries(snapshot.evidence)) {
    const rows = await query(database, tableDigestQuery(table, expected.columns));
    assert.deepEqual(digestRows(rows, expected.columns), { rows: expected.rows, sha256: expected.sha256 });
  }
  const present = await query(database, "SELECT name FROM sqlite_master WHERE name='sqlite_sequence'");
  const sequences = present.length ? await query(database, 'SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name') : [];
  assert.deepEqual(sequences, snapshot.sequences);
}
function decode(value) {
  assert.equal(typeof value, 'string');
  const separator = value.indexOf(':');
  const type = value.slice(0, separator), encoded = value.slice(separator + 1);
  assert.match(encoded, /^(?:[0-9a-f]{2})*$/i);
  const bytes = Buffer.from(encoded, 'hex');
  if (type === 'null') return null;
  if (type === 'text') return bytes.toString('utf8');
  if (type === 'blob') return bytes;
  if (type === 'integer') return BigInt(bytes.toString('utf8'));
  if (type === 'real') { const n = Number(bytes.toString('utf8')); assert.ok(Number.isFinite(n)); return n; }
  throw new Error('Unsupported database storage class.');
}
export async function captureFrozenDatabase(database, destination, transferId) {
  const state = await query(database, "SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1");
  assert.deepEqual(state, [{ phase: 'frozen', transfer_id: transferId }]);
  assert.deepEqual(await query(database, 'SELECT frozen,transfer_id FROM _bct_handover_state WHERE id=1'), [{ frozen: 1, transfer_id: transferId }]);
  assert.equal((await query(database, 'SELECT COUNT(*) AS n FROM _bct_handover_operations'))[0].n, 0);
  const schema = await query(database, schemaSql);
  const db = new DatabaseSync(destination);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, 0);
    db.exec('PRAGMA foreign_keys=OFF; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
    for (const type of ['table', 'index', 'view']) for (const row of schema.filter(row => row.type === type)) {
      assert.ok(!/^CREATE VIRTUAL TABLE/i.test(row.sql)); db.exec(row.sql);
    }
    for (const row of schema.filter(row => row.type === 'table')) {
      const columns = db.prepare(`PRAGMA table_xinfo(${quote(row.name)})`).all().filter(row => row.hidden === 0).map(row => row.name);
      const count = (await query(database, `SELECT COUNT(*) AS n FROM ${quote(row.name)}`))[0].n;
      assert.ok(count <= 10000, 'Database table requires paginated transfer.');
      const rows = await query(database, tableDigestQuery(row.name, columns));
      assert.equal(rows.length, count);
      const insert = db.prepare(`INSERT INTO ${quote(row.name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const value of rows) insert.run(...columns.map((_, i) => decode(value['c' + i])));
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
      db.exec('DELETE FROM sqlite_sequence');
      for (const row of await query(database, 'SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name')) db.prepare('INSERT INTO sqlite_sequence VALUES(?,?)').run(row.name, BigInt(row.seq));
    }
    for (const row of schema.filter(row => row.type === 'trigger')) db.exec(row.sql);
    db.exec('COMMIT; PRAGMA foreign_keys=ON;');
    const snapshot = exportDatabase(db);
    await verifyCloudflareDatabase(database, snapshot);
    assert.deepEqual(await query(database, "SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1"), state);
    return snapshot;
  } finally { db.close(); }
}
export async function createVerifiedReturnDatabase(snapshot, label) {
  assert.match(label, /^[a-z0-9-]{1,55}$/);
  const created = await cloudflare(root, 'POST', { name: label });
  const database = created.uuid;
  assert.match(database, /^[a-f0-9-]{36}$/);
  try {
    for (const sql of Object.values(snapshot.phases)) {
      const etag = createHash('md5').update(sql).digest('hex');
      const endpoint = root + '/' + database + '/import';
      const upload = await cloudflare(endpoint, 'POST', { action: 'init', etag });
      const url = new URL(upload.upload_url);
      assert.ok(url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com'));
      const sent = await fetch(url, { method: 'PUT', body: sql, signal: AbortSignal.timeout(60000) });
      assert.ok(sent.ok, 'Private database upload failed.');
      let result = await cloudflare(endpoint, 'POST', { action: 'ingest', etag, filename: upload.filename });
      for (let i = 0; i < 120 && result.status !== 'complete'; i++) {
        assert.ok(result.status !== 'error' && !result.error && result.success !== false && result.at_bookmark, 'Database import failed.');
        await new Promise(resolve => setTimeout(resolve, 1500));
        result = await cloudflare(endpoint, 'POST', { action: 'poll', current_bookmark: result.at_bookmark });
      }
      assert.ok(result.status === 'complete' && !result.error && result.success !== false);
    }
    await verifyCloudflareDatabase(database, snapshot);
    return database;
  } catch (error) {
    await cloudflare(root + '/' + database, 'DELETE');
    throw error;
  }
}
export async function removeDisposableDatabase(database) { await cloudflare(root + '/' + database, 'DELETE'); }
