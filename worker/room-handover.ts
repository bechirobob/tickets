import { requireHandover, sealHandover, type HandoverSettings } from './handover-crypto';

// A rehearsal snapshot, never an assertion that Cloudflare has stopped writing.
// Read all application tables synchronously before awaiting crypto or alarms.
export async function encryptedRoomSnapshot(storage: DurableObjectStorage, settings: HandoverSettings, sourceRevision: string | undefined, objectId: string) {
  requireHandover(settings);
  if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error("Invalid Room identity.");
  const names = ['room_config', 'messages', 'reactions'];
  const schema = storage.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND (type='table' OR type='index') AND tbl_name IN ('room_config','messages','reactions') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").toArray().map(row => row.sql);
  const tables: Record<string, Record<string, SqlStorageValue>[]> = {};
  for (const name of names) {
    const { count } = storage.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${name}`).one();
    if (count > 10000) throw new Error('Room snapshot needs pagination before transfer.');
    tables[name] = storage.sql.exec<Record<string, SqlStorageValue>>(`SELECT * FROM ${name} ORDER BY rowid`).toArray();
    if (tables[name].length !== count) throw new Error('Room snapshot count mismatch.');
  }
  const sequences = storage.sql.exec<{ name: string; seq: number }>("SELECT name, seq FROM sqlite_sequence WHERE name='messages'").toArray();
  const capturedAt = new Date().toISOString();
  const alarm = await storage.getAlarm();
  return sealHandover(settings, 'room-rehearsal', { objectId, sourceRevision, snapshotType: 'rehearsal-not-cutover', capturedAt, schema, tables, sequences, alarm });
}
