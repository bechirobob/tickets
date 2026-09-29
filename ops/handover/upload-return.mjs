import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openEnvelope } from './open-envelope.mjs';
import { restoredReturnSnapshot, returnMetadata } from './return-metadata.mjs';
try {
  const [file, runId] = process.argv.slice(2);
  const payload = openEnvelope(JSON.parse(readFileSync(file, 'utf8')), readFileSync('/etc/becore-tickets/handover/recipient.pem'), 'return-upload');
  assert.equal(payload.runId, runId);
  const snapshot = restoredReturnSnapshot(); assert.deepEqual(returnMetadata(snapshot), payload.expected);
  const url = new URL(payload.uploadUrl); assert.equal(url.protocol, 'https:'); assert.ok(url.hostname.endsWith('.r2.cloudflarestorage.com'));
  const response = await fetch(url, { method: 'PUT', body: snapshot.sql, redirect: 'error', signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok); assert.equal(response.headers.get('etag')?.replaceAll('"', ''), payload.expected.sqlMD5);
  console.log(JSON.stringify({ privateSqlUploadedDirectly: true, temporaryDatabase: payload.database, broadCredentialsReceived: false, productionChanged: false }));
} catch { console.error('Scoped private SQL upload failed; production unchanged.'); process.exitCode = 1; }
