import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, lstatSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { roomSnapshot } from './sqlite-snapshot.mjs';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function privateJson(file) {
  const stat = lstatSync(file); assert.ok(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o077));
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function checkpoint(file, value) {
  writeFileSync(file + '.next', JSON.stringify(value), { mode: 0o600 });
  renameSync(file + '.next', file);
}
export function roomReturn(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    return { tables: roomSnapshot(db), sequences: db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name='messages'").all().map(row => ({ ...row })), alarm: db.prepare('SELECT due FROM vps_alarm WHERE id=1').get()?.due ?? null };
  } finally { db.close(); }
}
// Every item here is a persistent work record, not an in-memory provider call.
// In-flight claims must be resolved on the source before a transfer can proceed.
export function reconciliation(db) {
  const checks = {
    pendingOrders: "SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('paid','expired','cancelled','refunded')",
    sendingDeliveries: "SELECT COUNT(*) AS n FROM delivery_events WHERE status='queued'",
    claimedAnnouncements: "SELECT COUNT(*) AS n FROM event_announcement_recipients WHERE status='sending' OR (claimed_at IS NOT NULL AND status NOT IN ('sent','failed','suppressed'))",
    leasedHostAnnouncements: 'SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE lease_token IS NOT NULL',
    leasedMarketing: 'SELECT COUNT(*) AS n FROM marketing_state WHERE lease_token IS NOT NULL',
  };
  const result = Object.fromEntries(Object.entries(checks).map(([name, sql]) => [name, db.prepare(sql).get().n]));
  assert.ok(Object.values(result).every(n => n === 0), 'Unresolved payment or delivery work requires source reconciliation.');
  return result;
}
export function assertNoVpsQueue(state) {
  const file = state + '/operations.sqlite';
  if (!existsSync(file)) return;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const present = db.prepare("SELECT name FROM sqlite_master WHERE name='delivery_queue'").get();
    assert.ok(!present || db.prepare('SELECT COUNT(*) AS n FROM delivery_queue').get().n === 0, 'Drain the VPS delivery queue before returning to Cloudflare.');
  } finally { db.close(); }
}
