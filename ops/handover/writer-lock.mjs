// SQL-level write exclusion also stops older in-flight application instances.
// Install guards while unfrozen, verify the complete schema, then flip one row.
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
const control = '_bct_handover_state';
export function writerGuardStatements(tableNames) {
  if (!Array.isArray(tableNames) || !tableNames.length || new Set(tableNames).size !== tableNames.length || tableNames.some(name => typeof name !== 'string' || name.startsWith('sqlite_') || name.startsWith('_cf_') || name === control)) throw new Error('Invalid writer-guard schema.');
  return [
    `CREATE TABLE IF NOT EXISTS ${control}(id INTEGER PRIMARY KEY CHECK(id=1), frozen INTEGER NOT NULL CHECK(frozen IN (0,1)), transfer_id TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO ${control}(id,frozen,transfer_id) VALUES(1,0,'')`,
    ...tableNames.flatMap(name => ['INSERT', 'UPDATE', 'DELETE'].map(operation => `CREATE TRIGGER IF NOT EXISTS ${identifier('_bct_guard_' + name + '_' + operation.toLowerCase())} BEFORE ${operation} ON ${identifier(name)} WHEN (SELECT frozen FROM ${control} WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'Source writer is paused for verified handover'); END`)),
  ];
}
export function transitionWriterSql(transferId, freeze) {
  if (!/^[a-f0-9-]{36}$/.test(transferId)) throw new Error('Invalid transfer identity.');
  // A different operation cannot unfreeze or take over an existing freeze.
  return freeze
    ? { sql: `UPDATE ${control} SET frozen=1,transfer_id=? WHERE id=1 AND (frozen=0 OR transfer_id=?) RETURNING frozen,transfer_id`, params: [transferId, transferId] }
    : { sql: `UPDATE ${control} SET frozen=0 WHERE id=1 AND transfer_id=? RETURNING frozen,transfer_id`, params: [transferId] };
}
