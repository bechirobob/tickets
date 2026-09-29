import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sealHandover } from '../../worker/handover-crypto.ts';
import { tableDigestQuery, digestRows } from './sqlite-export.mjs';
process.umask(0o077);
const root = 'https://api.cloudflare.com/client/v4/accounts/af75a230de2eea882606db8d9acce473/d1/database';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
let database, retained = false, phase = 'start';
function safeFailure(value) {
  let embeddedError;
  try { embeddedError = JSON.parse(value.error); } catch { /* Plain provider errors use the template below. */ }
  const providerNumbers = embeddedError && typeof embeddedError === 'object' ? Object.fromEntries(Object.entries(embeddedError).filter(([key, item]) => /code|status|retry/i.test(key) && (typeof item === 'number' || typeof item === 'boolean'))) : {};
  const text = JSON.stringify(value);
  const categories = ['SQLITE_AUTH', 'SQLITE_CONSTRAINT', 'SQLITE_TOOBIG', 'FOREIGN KEY', 'no such table', 'syntax error', 'not authorized', 'No uploaded file', 'does not exist', 'incomplete input', 'already exists', 'unrecognized token', 'SQLITE_ERROR', 'too long', 'failed to parse', 'too many', 'constraint failed', 'no such column'].filter(term => text.toLowerCase().includes(term.toLowerCase()));
  const vocabulary = new Set('the a an and or of from to in out on for with is be was has have been not no cannot can could unable found find match mismatch invalid valid expected provided supplied file files upload uploaded uploading download downloaded import importing imported export sql statement statements query queries database databases table column constraint foreign key unique check null error failed failure internal server response request status code number type allowed only read too long large size limit maximum exceeded bytes length empty data input format syntax parse parsing parser transaction token expired permission permissions denied unavailable unknown please retry already currently executing process processing operation run successfully success md5 etag hash checksum under name filename this that does did do it you your must should may value present missing bad required needs content completed complete fetching failed'.split(' '));
  const template = String(value.error?.message ?? value.error ?? '').replace(/(['"])[\s\S]*?\1/g, '[redacted]').replace(/[A-Za-z0-9_]+/g, word => vocabulary.has(word.toLowerCase()) ? word : '_').slice(0,500);
  console.error(JSON.stringify({ phase, errorCategories: categories, errorType: typeof value.error, providerNumbers, errorTemplate: template, apiCodes: Array.isArray(value.errors) ? value.errors.map(row => row.code) : [] }));
}
async function call(url, method, body) {
  const response = await fetch(url, { method, headers: { authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok || !value.success || value.result?.some?.(row => row.success === false)) { safeFailure(value); throw new Error('Scoped D1 operation failed.'); }
  return value.result;
}
const query = async sql => (await call(root + '/' + database + '/query', 'POST', { sql }))[0].results;
try {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'prepare') {
    const expected = JSON.parse(readFileSync(file, 'utf8'));
    assert.match(expected.sqlMD5, /^[a-f0-9]{32}$/);
    for (const key of ['evidenceSHA256', 'schemaSHA256', 'sequencesSHA256']) assert.match(expected[key], /^[a-f0-9]{64}$/);
    phase = 'create';
    const created = await call(root, 'POST', { name: 'tickets-return-' + process.env.GITHUB_RUN_ID });
    assert.match(created.uuid, /^[a-f0-9-]{36}$/); assert.notEqual(created.uuid, '8f8723c2-673a-4aba-b025-83c05d67d075'); database = created.uuid;
    phase = 'prepare-upload';
    const result = await call(root + '/' + database + '/import', 'POST', { action: 'init', etag: expected.sqlMD5 });
    const url = new URL(result.upload_url); assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith('.r2.cloudflarestorage.com'));
    const recipient = JSON.parse(readFileSync('ops/handover/recipient.json', 'utf8'));
    assert.equal(createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex'), recipient.fingerprint);
    const manifest = { runId: process.env.GITHUB_RUN_ID, database, filename: result.filename, expected };
    const envelope = await sealHandover({ HANDOVER_RECIPIENT_SPKI: recipient.publicKey, HANDOVER_EXPIRES_AT: new Date(Date.now() + 55 * 60000).toISOString() }, 'return-upload', { ...manifest, uploadUrl: result.upload_url });
    mkdirSync('scoped-return', { mode: 0o700 });
    writeFileSync('scoped-return/upload.json', JSON.stringify(envelope), { mode: 0o600 });
    writeFileSync('scoped-return/manifest.json', JSON.stringify(manifest), { mode: 0o600 });
    retained = true;
    console.log(JSON.stringify({ temporaryDatabasePrepared: database, scope: 'one SQL upload', broadCredentialsTransferred: false }));
  } else if (mode === 'verify') {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    assert.match(manifest.database, /^[a-f0-9-]{36}$/); assert.match(manifest.runId, /^\d+$/);
    assert.notEqual(manifest.database, '8f8723c2-673a-4aba-b025-83c05d67d075');
    const info = await call(root + '/' + manifest.database, 'GET');
    assert.equal(info.name, 'tickets-return-' + manifest.runId); database = manifest.database;
    phase = 'ingest';
    const endpoint = root + '/' + database + '/import';
    let result = await call(endpoint, 'POST', { action: 'ingest', etag: manifest.expected.sqlMD5, filename: manifest.filename });
    console.log(JSON.stringify({ importResponseKeys: Object.keys(result ?? {}), importStatus: result?.status, bookmarkPresent: Boolean(result?.at_bookmark) }));
    if (result.success === false || result.error) { safeFailure(result); throw new Error('Import rejected.'); }
    for (let attempt = 0; attempt < 60 && result.status !== 'complete'; attempt++) {
      if (result.status === 'error') { safeFailure(result); throw new Error('Import failed.'); } assert.ok(result.at_bookmark);
      await new Promise(resolve => setTimeout(resolve, 2000));
      result = await call(endpoint, 'POST', { action: 'poll', current_bookmark: result.at_bookmark });
      if (result.success === false || result.error) { safeFailure(result); throw new Error('Import rejected.'); }
    }
    assert.equal(result.status, 'complete');
    phase = 'foreign-keys'; assert.deepEqual(await query('PRAGMA foreign_key_check'), []);
    phase = 'schema';
    const schema = await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name");
    assert.equal(hash(schema), manifest.expected.schemaSHA256);
    phase = 'rows';
    const evidence = {};
    for (const table of schema.filter(row => row.type === 'table')) {
      const columns = (await query(`PRAGMA table_xinfo(${quote(table.name)})`)).filter(row => row.hidden === 0).map(row => row.name);
      evidence[table.name] = { columns, ...digestRows(await query(tableDigestQuery(table.name, columns)), columns) };
    }
    assert.equal(hash(evidence), manifest.expected.evidenceSHA256);
    phase = 'sequences';
    const present = await query("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'");
    const sequences = present.length ? await query('SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name') : [];
    assert.equal(hash(sequences), manifest.expected.sequencesSHA256);
    console.log(JSON.stringify({ actualVpsSqlRestoredInCloudflare: true, tables: Object.keys(evidence).length, rows: Object.values(evidence).reduce((sum, row) => sum + row.rows, 0), exactSchemaRowsAndSequences: true, productionChanged: false }));
  } else throw new Error('Unknown scoped return mode.');
} catch (error) { console.error(JSON.stringify({ scopedReturnFailedAt: phase, productionChanged: false, errorType: error?.name, errorCode: error?.code, frames: error?.stack?.split('\n').slice(1, 4) })); process.exitCode = 1; }
finally {
  if (database && !retained) {
    try { await call(root + '/' + database, 'DELETE'); console.log(JSON.stringify({ temporaryDatabaseRemoved: database })); }
    catch { console.error(JSON.stringify({ temporaryDatabaseCleanupRequired: database })); process.exitCode = 1; }
  }
}
