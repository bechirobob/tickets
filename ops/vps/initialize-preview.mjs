// Isolated schema only. Never run this initializer against live customer state.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const file = '/var/lib/becore-tickets-preview/tickets.sqlite';
if (existsSync(file)) process.exit(0);
process.umask(0o077);
const db = new DatabaseSync(file);
try {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(path.join('migrations', name), 'utf8'));
  db.exec('COMMIT;');
} finally { db.close(); }
