import { createHash } from 'node:crypto';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
export function tableDigestQuery(name, columns) {
  return `SELECT ${columns.map((column, index) => `typeof(${quote(column)})||':'||hex(${quote(column)}) AS c${index}`).join(',')} FROM ${quote(name)}`;
}
export function digestRows(rows, columns) {
  const records = rows.map(row => JSON.stringify(columns.map((_, index) => row['c' + index]))).sort();
  return { rows: records.length, sha256: createHash('sha256').update(records.join('\n')).digest('hex') };
}
function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = String(value);
    return /[.e]/i.test(text) ? text : text + '.0';
  }
  if (value instanceof Uint8Array) return "X'" + Buffer.from(value).toString('hex') + "'";
  if (typeof value === 'string') return value.includes('\0') ? "CAST(X'" + Buffer.from(value).toString('hex') + "' AS TEXT)" : "'" + value.replaceAll("'", "''") + "'";
  throw new Error('Unsupported snapshot value.');
}
export function exportDatabase(db) {
  if (db.isTransaction) throw new Error('Export requires its own consistent read transaction.');
  db.exec('BEGIN');
  try {
    const result = exportSnapshot(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function exportSnapshot(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source database integrity failed.');
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all();
  const tables = schema.filter(row => row.type === 'table');
  if (tables.some(row => /^CREATE VIRTUAL TABLE/i.test(row.sql))) throw new Error('Virtual tables require a dedicated export.');
  const statements = ['PRAGMA defer_foreign_keys=TRUE;', ...tables.map(row => row.sql + ';')];
  const evidence = {};
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_xinfo(${quote(table.name)})`).all().filter(row => row.hidden === 0).map(row => row.name);
    evidence[table.name] = { columns, ...digestRows(db.prepare(tableDigestQuery(table.name, columns)).all(), columns) };
    const query = db.prepare(`SELECT * FROM ${quote(table.name)}`); query.setReadBigInts(true);
    for (const row of query.iterate()) statements.push(`INSERT INTO ${quote(table.name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(column => literal(row[column])).join(',')});`);
  }
  let sequences = [];
  if (db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    statements.push('DELETE FROM sqlite_sequence;');
    const sequenceQuery = db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name');
    sequenceQuery.setReadBigInts(true);
    sequences = sequenceQuery.all().filter(row => tables.some(table => table.name === row.name));
    for (const row of sequences) {
      if (tables.some(table => table.name === row.name)) statements.push(`INSERT INTO sqlite_sequence(name,seq) VALUES(${literal(row.name)},${literal(row.seq)});`);
    }
  }
  for (const type of ['index', 'view', 'trigger']) statements.push(...schema.filter(row => row.type === type).map(row => row.sql + ';'));
  return { sql: statements.join('\n') + '\n', evidence, schema, sequences: sequences.map(row => ({ name: row.name, seq: String(row.seq) })) };
}
