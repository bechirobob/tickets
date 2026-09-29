// Restore into a new private directory only; never activate a backup implicitly.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
process.umask(0o077);
const [file, keyFile, destination] = process.argv.slice(2);
assert.ok(file && keyFile && destination && path.isAbsolute(destination) && !existsSync(destination));
assert.ok(lstatSync(keyFile).isFile() && !(lstatSync(keyFile).mode & 0o077));
const bytes = readFileSync(file), key = readFileSync(keyFile), header = Buffer.from('BCTBACKUP1');
assert.equal(key.length, 32); assert.ok(bytes.subarray(0, header.length).equals(header));
const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(header.length, header.length + 12));
decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(header.length + 12, header.length + 28));
const archive = Buffer.concat([decipher.update(bytes.subarray(header.length + 28)), decipher.final()]);
mkdirSync(destination, { mode: 0o700 });
try {
  execFileSync('tar', ['--no-same-owner', '-xzf', '-', '-C', destination], { input: archive });
  let count = 0;
  function verify(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      assert.ok(!item.isSymbolicLink()); const file = path.join(directory, item.name);
      if (item.isDirectory()) verify(file);
      else if (item.name.endsWith('.sqlite')) {
        const db = new DatabaseSync(file, { readOnly: true });
        try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0); count++; } finally { db.close(); }
      }
    }
  }
  verify(destination);
  assert.equal(count, JSON.parse(readFileSync(destination + '/manifest.json', 'utf8')).databases);
  console.log(JSON.stringify({ restored: true, databases: count, activated: false }));
} catch { rmSync(destination, { recursive: true, force: true }); console.error('Backup restore rejected; active state unchanged.'); process.exitCode = 1; }
