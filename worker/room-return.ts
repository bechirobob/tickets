import { requireTransfer } from './handover-control';

export type RoomReturn = {
  tables: Record<string, Record<string, SqlStorageValue>[]>;
  sequences: { name: string; seq: number }[];
  alarm: number | null;
};
const names = ['room_config', 'messages', 'reactions'];
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

// The target remains frozen throughout the externally visible operation.
// All row replacement and the sequence high-water mark commit atomically.
export function restoreFrozenRoom(storage: DurableObjectStorage, transferId: string, snapshot: RoomReturn): void {
  requireTransfer(transferId);
  if (!snapshot || !snapshot.tables || Object.keys(snapshot.tables).sort().join(',') !== [...names].sort().join(',') || !Array.isArray(snapshot.sequences)) throw new Error('Invalid Room return.');
  if (snapshot.alarm !== null && (!Number.isSafeInteger(snapshot.alarm) || snapshot.alarm < 0)) throw new Error('Invalid Room alarm.');
  if (snapshot.sequences.length > 1 || snapshot.sequences.some(row => row.name !== 'messages' || !Number.isSafeInteger(row.seq) || row.seq < 0)) throw new Error('Invalid sequence state.');
  for (const name of names) {
    const rows = snapshot.tables[name];
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error('Room return requires pagination.');
    const columns = storage.sql.exec<{ name: string }>(`PRAGMA table_info(${quote(name)})`).toArray().map(row => row.name).sort();
    for (const row of rows) {
      if (!row || Object.keys(row).sort().join(',') !== columns.join(',') || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Room return schema mismatch.');
    }
  }
  const maximum = Math.max(0, ...snapshot.tables.messages.map(row => Number(row.sequence)));
  if ((snapshot.sequences[0]?.seq ?? 0) < maximum) throw new Error('Room sequence would move backwards.');
  storage.transactionSync(() => {
    const state = storage.sql.exec<{ frozen: number; transfer_id: string }>('SELECT frozen,transfer_id FROM _bct_handover_state WHERE id=1').one();
    if (state.frozen !== 1 || state.transfer_id !== transferId) throw new Error('Room return requires its own frozen target.');
    storage.sql.exec('UPDATE _bct_handover_state SET frozen=0 WHERE id=1');
    for (const name of ['reactions', 'messages', 'room_config']) storage.sql.exec(`DELETE FROM ${quote(name)}`);
    for (const name of names) {
      const columns = storage.sql.exec<{ name: string }>(`PRAGMA table_info(${quote(name)})`).toArray().map(row => row.name);
      for (const row of snapshot.tables[name]) storage.sql.exec(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, ...columns.map(column => row[column]));
    }
    storage.sql.exec("DELETE FROM sqlite_sequence WHERE name='messages'");
    for (const row of snapshot.sequences) storage.sql.exec('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)', row.name, row.seq);
    storage.sql.exec('UPDATE _bct_handover_state SET frozen=1 WHERE id=1');
  });
}
