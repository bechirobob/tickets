import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sealHandover } from './worker/handover-crypto.ts';
const account = 'af75a230de2eea882606db8d9acce473';
const database = '8f8723c2-673a-4aba-b025-83c05d67d075';
try {
  const recipient = JSON.parse(await readFile('ops/handover/recipient.json', 'utf8'));
  if (createHash('sha256').update(Buffer.from(recipient.publicKey, 'base64')).digest('hex') !== recipient.fingerprint) throw new Error();
  const response = await fetch('https://tickets.becoreops.com/api/version', { signal: AbortSignal.timeout(20000) });
  const live = await response.json();
  if (!response.ok || !/^[a-f0-9]{40}$/.test(live.revision ?? '')) throw new Error();
  let bookmark; let result;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/export`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ output_format: 'polling', current_bookmark: bookmark }), signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (!response.ok || !body.success || !body.result?.success || body.result.status === 'error') throw new Error();
    result = body.result;
    if (result.status === 'complete') break;
    bookmark = result.at_bookmark;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (result?.status !== 'complete' || !result.result?.signed_url) throw new Error();
  const url = new URL(result.result.signed_url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error();
  // Signed URL and SQL are never logged or written unencrypted.
  const download = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!download.ok) throw new Error();
  const sql = Buffer.from(await download.arrayBuffer());
  if (!sql.length || sql.length > 128 * 1024 * 1024) throw new Error();
  const envelope = await sealHandover({ HANDOVER_RECIPIENT_SPKI: recipient.publicKey, HANDOVER_EXPIRES_AT: new Date(Date.now() + 55 * 60000).toISOString() }, 'd1-rehearsal', {
    databaseId: database, sourceRevision: live.revision, snapshotType: 'rehearsal-not-cutover',
    sqlGzip: gzipSync(sql).toString('base64'), sha256: createHash('sha256').update(sql).digest('hex'),
  });
  await mkdir('handover-encrypted', { mode: 0o700 });
  await writeFile('handover-encrypted/database.json', JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ encryptedD1Snapshot: true, sourceRevision: live.revision, plaintextBytes: sql.length, cutoverSnapshot: false }));
} catch { console.error('Encrypted D1 snapshot failed; no live data was changed.'); process.exitCode = 1; }
