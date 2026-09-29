import { createHash } from 'node:crypto';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const stagingTable = '_bct_export_large_values';
const maxStatementBytes = 64000;
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
  if (tables.some(row => row.name === stagingTable)) throw new Error('Export staging table already exists.');
  const statements = ['PRAGMA defer_foreign_keys=TRUE;', ...tables.map(row => row.sql + ';')];
  let stagingCreated = false;
  const evidence = {};
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_xinfo(${quote(table.name)})`).all().filter(row => row.hidden === 0).map(row => row.name);
    evidence[table.name] = { columns, ...digestRows(db.prepare(tableDigestQuery(table.name, columns)).all(), columns) };
    const query = db.prepare(`SELECT * FROM ${quote(table.name)}`); query.setReadBigInts(true);
    for (const row of query.iterate()) {
      const values = columns.map(column => literal(row[column]));
      const insert = () => `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(',')}) VALUES (${values.join(',')});`;
      let staged = false;
      if (Buffer.byteLength(insert()) > maxStatementBytes) {
        if (!stagingCreated) {
          statements.push(`CREATE TABLE ${quote(stagingTable)}(id INTEGER PRIMARY KEY,value BLOB NOT NULL);`);
          stagingCreated = true;
        }
        // Assemble large values outside application tables, so NOT NULL/CHECK
        // constraints only see the finished value. Keep blobs binary throughout.
        const candidates = columns.map((column, index) => ({ column, index, size: Buffer.byteLength(values[index]) })).sort((a, b) => b.size - a.size);
        for (const { column, index } of candidates) {
          if (Buffer.byteLength(insert()) <= maxStatementBytes) break;
          const value = row[column];
          if (typeof value !== 'string' && !(value instanceof Uint8Array)) continue;
          const bytes = Buffer.from(value);
          statements.push(`INSERT INTO ${quote(stagingTable)} VALUES(${index},X'');`);
          for (let offset = 0; offset < bytes.length; offset += 16000) {
            statements.push(`UPDATE ${quote(stagingTable)} SET value=CAST(value||X'${bytes.subarray(offset, offset + 16000).toString('hex')}' AS BLOB) WHERE id=${index};`);
          }
          const select = `(SELECT value FROM ${quote(stagingTable)} WHERE id=${index})`;
          values[index] = typeof value === 'string' ? `CAST(${select} AS TEXT)` : select;
          staged = true;
        }
      }
      statements.push(insert());
      if (staged) statements.push(`DELETE FROM ${quote(stagingTable)};`);
    }
  }
  if (stagingCreated) statements.push(`DROP TABLE ${quote(stagingTable)};`);
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
  // D1 can reset when schema creation and private-data import share one job.
  // Keep independently committed phases on a disposable, inactive destination.
  // Indexes must exist before rows for foreign-key parent uniqueness; triggers
  // must follow rows so restoration cannot duplicate application side effects.
  const phases = {
    schema: [...tables.map(row => row.sql + ';'), ...['index', 'view'].flatMap(type => schema.filter(row => row.type === type).map(row => row.sql + ';'))].join('\n') + '\n',
    data: ['PRAGMA defer_foreign_keys=TRUE;', ...statements.slice(1 + tables.length)].join('\n') + '\n',
    triggers: ['SELECT 1;', ...schema.filter(row => row.type === 'trigger').map(row => row.sql + ';')].join('\n') + '\n',
  };
  for (const type of ['index', 'view', 'trigger']) statements.push(...schema.filter(row => row.type === type).map(row => row.sql + ';'));
  if (statements.some(sql => Buffer.byteLength(sql) > maxStatementBytes)) throw new Error('Schema or row cannot fit bounded SQL export.');
  return { sql: statements.join('\n') + '\n', phases, evidence, schema, sequences: sequences.map(row => ({ name: row.name, seq: String(row.seq) })) };
}
