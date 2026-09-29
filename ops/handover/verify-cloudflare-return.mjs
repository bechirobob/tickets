// Rehearse ONLY in newly created, unbound D1 databases. Never import over live D1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openEnvelope } from './open-envelope.mjs';
import { tableDigestQuery, digestRows } from './sqlite-export.mjs';
const root = 'https://api.cloudflare.com/client/v4/accounts/af75a230de2eea882606db8d9acce473/d1/database';
let database, phase = 'decrypt';
async function call(url, method, body) {
  const response = await fetch(url, { method, headers: { authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok || !value.success || value.result?.some?.(row => row.success === false)) throw new Error('Cloudflare operation failed.');
  return value.result;
}
const query = async sql => (await call(root + '/' + database + '/query', 'POST', { sql }))[0].results;
async function remove() {
  if (!database) return;
  await call(root + '/' + database, 'DELETE');
  console.log(JSON.stringify({ temporaryDatabaseRemoved: database })); database = undefined;
}
try {
  const [envelopeFile, privateKeyFile, recipientFile] = process.argv.slice(2);
  const recipient = JSON.parse(readFileSync(recipientFile, 'utf8'));
  const payload = openEnvelope(JSON.parse(readFileSync(envelopeFile, 'utf8')), readFileSync(privateKeyFile), 'vps-return-rehearsal');
  assert.equal(payload.runId, process.env.GITHUB_RUN_ID); assert.equal(payload.fingerprint, recipient.fingerprint);
  assert.equal(payload.snapshots.length, 7);
  for (const [index, snapshot] of payload.snapshots.entries()) {
    phase = 'create';
    const created = await call(root, 'POST', { name: 'tickets-return-' + process.env.GITHUB_RUN_ID + '-' + index });
    assert.match(created.uuid, /^[a-f0-9-]{36}$/);
    assert.notEqual(created.uuid, '8f8723c2-673a-4aba-b025-83c05d67d075');
    database = created.uuid;
    console.log(JSON.stringify({ temporaryDatabaseCreated: database, snapshot: index }));
    try {
      phase = 'upload';
      const sql = Buffer.from(snapshot.sql);
      const etag = createHash('md5').update(sql).digest('hex');
      const endpoint = root + '/' + database + '/import';
      let result = await call(endpoint, 'POST', { action: 'init', etag });
      if (result.upload_url) {
        const url = new URL(result.upload_url);
        assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith('.r2.cloudflarestorage.com'));
        const uploaded = await fetch(url, { method: 'PUT', body: sql, signal: AbortSignal.timeout(60000) });
        assert.ok(uploaded.ok);
        assert.equal(uploaded.headers.get('etag')?.replaceAll('"', ''), etag);
        phase = 'ingest';
        result = await call(endpoint, 'POST', { action: 'ingest', etag, filename: result.filename });
      }
      for (let attempt = 0; attempt < 60 && result.status !== 'complete'; attempt++) {
        assert.notEqual(result.status, 'error'); assert.ok(result.at_bookmark);
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = await call(endpoint, 'POST', { action: 'poll', current_bookmark: result.at_bookmark });
      }
      assert.equal(result.status, 'complete');
      phase = 'compare';
      assert.deepEqual(await query('PRAGMA foreign_key_check'), []);
      const schema = await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name");
      assert.deepEqual(schema, snapshot.schema);
      for (const [name, expected] of Object.entries(snapshot.evidence)) {
        const rows = await query(tableDigestQuery(name, expected.columns));
        assert.deepEqual(digestRows(rows, expected.columns), { rows: expected.rows, sha256: expected.sha256 });
      }
      const sequenceTable = await query("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'");
      if (sequenceTable.length) assert.deepEqual(await query('SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name'), snapshot.sequences);
      console.log(JSON.stringify({ snapshot: index, cloudflareSqlRestoreVerified: true, tables: Object.keys(snapshot.evidence).length, productionDatabaseChanged: false }));
    } finally { await remove(); }
  }
  console.log(JSON.stringify({ reverseCloudflareSqlVerified: true, snapshots: payload.snapshots.length, productionDatabaseChanged: false, liveRoomsImported: false }));
} catch {
  console.error(JSON.stringify({ reverseRehearsalFailedAt: phase, productionDatabaseChanged: false })); process.exitCode = 1;
} finally {
  if (database) { try { await remove(); } catch { console.error(JSON.stringify({ cleanupRequiredForTemporaryDatabase: database })); process.exitCode = 1; } }
}
