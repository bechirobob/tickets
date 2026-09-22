import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function bindValue(value) {
  if (typeof value === 'boolean') return Number(value);
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) return new Uint8Array(value);
  throw new TypeError('Unsupported SQL binding.');
}

function resultRows(rows) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? [...value] : value])));
}

class Prepared {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new Prepared(this.owner, this.sql, values.map(bindValue)); }
  execute() {
    const start = performance.now();
    const statement = this.owner.connection.prepare(this.sql);
    const before = this.owner.connection.prepare('SELECT total_changes() AS n').get().n;
    const rows = statement.columns().length ? resultRows(statement.all(...this.values)) : (statement.run(...this.values), []);
    const after = this.owner.connection.prepare('SELECT total_changes() AS n, last_insert_rowid() AS id').get();
    return { success: true, results: rows, meta: { changes: after.n - before, last_row_id: after.id, duration: performance.now() - start, changed_db: after.n !== before, rows_read: rows.length, rows_written: after.n - before, size_after: 0, served_by: 'vps' } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first(column) {
    const row = this.execute().results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!(column in row)) throw new Error('SQL result column does not exist.');
    return row[column];
  }
  async raw(options = {}) {
    const result = this.execute();
    const columns = this.owner.connection.prepare(this.sql).columns().map(c => c.name);
    const rows = result.results.map(row => columns.map(name => row[name]));
    return options.columnNames ? [columns, ...rows] : rows;
  }
}

export class SqliteDatabase {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  }
  prepare(sql) { return new Prepared(this, sql); }
  async batch(statements) {
    // All statements run synchronously inside one transaction. A promise cannot
    // yield midway and let another booking see partially reserved inventory.
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => {
        if (!(statement instanceof Prepared) || statement.owner !== this) throw new Error('Foreign SQL statement.');
        return statement.execute();
      });
      this.connection.exec('COMMIT');
      return results;
    } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { const start = performance.now(); this.connection.exec(sql); return { count: 1, duration: performance.now() - start }; }
  withSession() { return this; }
  getBookmark() { return null; }
  close() { this.connection.close(); }
}
