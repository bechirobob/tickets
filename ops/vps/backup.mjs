// Root-only encrypted backup. Every SQLite file is copied with SQLite's online
// backup API and restore-checked; no plaintext database is exported off-host.
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, lstatSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { join } from 'node:path';
assert.equal(process.getuid(), 0); process.umask(0o077);
const state = '/var/lib/becore-tickets';
const keyFile = '/etc/becore-tickets/backup.key';
assert.ok(lstatSync(keyFile).isFile() && !(lstatSync(keyFile).mode & 0o077));
const key = readFileSync(keyFile); assert.equal(key.length, 32);
const root = '/var/backups/becore-tickets'; mkdirSync(root, { recursive: true, mode: 0o700 });
const temporary = mkdtempSync(root + '/verify-');
let count = 0;
async function copy(directory, output) {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    assert.ok(!item.isSymbolicLink());
    const source = join(directory, item.name), target = join(output, item.name);
    if (item.isDirectory()) await copy(source, target);
    else if (item.name.endsWith('.sqlite')) {
      const db = new DatabaseSync(source, { readOnly: true });
      try { await backup(db, target); } finally { db.close(); }
      const restored = new DatabaseSync(target, { readOnly: true });
      try { assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0); } finally { restored.close(); }
      count++;
    } else if (item.name === 'handoff.json') copyFileSync(source, target);
  }
}
try {
  await copy(state, temporary + '/state');
  assert.ok(count >= 1);
  copyFileSync('/etc/becore-tickets/runtime.json', temporary + '/runtime.json');
  writeFileSync(temporary + '/manifest.json', JSON.stringify({ version: 1, capturedAt: new Date().toISOString(), consistency: 'SQLite online snapshot per database', databases: count }));
  const archive = execFileSync('tar', ['-C', temporary, '-czf', '-', '.'], { maxBuffer: 256 * 1024 * 1024 });
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  const header = Buffer.from('BCTBACKUP1'); cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  const sealed = Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext]);
  const restored = createDecipheriv('aes-256-gcm', key, nonce); restored.setAAD(header); restored.setAuthTag(sealed.subarray(header.length + 12, header.length + 28));
  const reopened = Buffer.concat([restored.update(sealed.subarray(header.length + 28)), restored.final()]);
  assert.equal(createHash('sha256').update(reopened).digest('hex'), createHash('sha256').update(archive).digest('hex'));
  const filename = 'tickets-' + new Date().toISOString().replaceAll(':', '-') + '.tar.gz.enc';
  writeFileSync(root + '/' + filename, sealed, { mode: 0o600, flag: 'wx' });
  const files = readdirSync(root).filter(n => /^tickets-[0-9TZ.:-]+\.tar\.gz\.enc$/.test(n)).sort().reverse();
  for (const file of files.slice(7)) rmSync(root + '/' + file);
  console.log(JSON.stringify({ ok: true, filename, databases: count, restoredAndAuthenticated: true }));
} catch { console.error('Encrypted Tickets backup failed; no plaintext exported.'); process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); }
