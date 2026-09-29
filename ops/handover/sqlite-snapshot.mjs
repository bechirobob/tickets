import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(row => row.name);
const canonical = value => JSON.stringify(value, (_, item) => item instanceof Uint8Array ? { binary: Buffer.from(item).toString('base64') } : typeof item === 'bigint' ? { integer: item.toString() } : item);
export function databaseEvidence(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Database integrity failed.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database references failed.');
  const result = {};
  for (const name of tables(db)) {
    const statement = db.prepare(`SELECT * FROM ${quote(name)}`);
    statement.setReadBigInts(true);
    const rows = statement.all().map(row => canonical(row)).sort();
    result[name] = { rows: rows.length, sha256: createHash('sha256').update(rows.join('\n')).digest('hex') };
  }
  return result;
}
export function restoreSqlSnapshot(sql, destination) {
  if (typeof sql !== 'string' || sql.length > 128 * 1024 * 1024) throw new Error('Invalid SQL snapshot.');
  // Cloudflare-generated SQL only, received through authenticated operator
  // access and an encrypted envelope. Never accept SQL from public requests.
  const db = new DatabaseSync(destination);
  try {
    if (tables(db).length) throw new Error('Restore target must be empty.');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=OFF;');
    db.exec(sql);
    db.exec('PRAGMA foreign_keys=ON;');
    return databaseEvidence(db);
  } finally { db.close(); }
}
export function roomSnapshot(db) {
  return Object.fromEntries(['room_config', 'messages', 'reactions'].map(name => [name, db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all().map(row => ({ ...row }))]));
}
export function restoreRoomSnapshot(db, snapshot) {
  if (!snapshot || Object.keys(snapshot).sort().join(',') !== 'messages,reactions,room_config') throw new Error('Invalid Room snapshot.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const name of ['room_config', 'messages', 'reactions']) {
      if (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n) throw new Error('Room restore target must be empty.');
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      const rows = snapshot[name];
      if (!Array.isArray(rows)) throw new Error('Invalid Room rows.');
      const insert = db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows) {
        if (!row || Object.keys(row).sort().join(',') !== [...columns].sort().join(',')) throw new Error('Room schema mismatch.');
        insert.run(...columns.map(name => row[name]));
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
