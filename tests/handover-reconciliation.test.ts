import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { controlSchema } from '../worker/handover-control';
import { archiveFencedOperations, inventoryDigest, isLegacyInventory, restoreReconciledOperations } from '../worker/handover-reconciliation';
import { writerGuardStatements, transitionWriterSql } from '../ops/handover/writer-lock.mjs';
const transfer = '01234567-89ab-4cde-8123-456789abcdef';
const record = { id: 'synthetic', kind: 'http', started_at: '2000-01-01T00:00:00Z' };
beforeEach(async () => {
  await env.DB.batch(controlSchema.map(sql => env.DB.prepare(sql)));
  await env.DB.prepare('DELETE FROM _bct_handover_operations').run();
  await env.DB.prepare("UPDATE _bct_handover_admission SET phase='paused',transfer_id=?").bind(transfer).run();
  await env.DB.prepare('INSERT INTO _bct_handover_operations VALUES(?,?,?)').bind(record.id, record.kind, record.started_at).run();
  for (const sql of writerGuardStatements(['orders', 'delivery_events'])) await env.DB.prepare(sql).run();
  await env.DB.prepare("UPDATE _bct_handover_state SET frozen=0,transfer_id='' WHERE id=1").run();
});
async function freeze() {
  const sql = transitionWriterSql(transfer, true);
  await env.DB.prepare(sql.sql).bind(...sql.params).run();
}
async function count() { return (await env.DB.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first<{ n: number }>())!.n; }
it('never accepts aged or substituted records as the known incident', async () => {
  expect(await isLegacyInventory([record])).toBe(false);
  expect(await isLegacyInventory(Array.from({ length: 116 }, (_, i) => ({ ...record, id: String(i) })))).toBe(false);
});
it('requires the correct exclusive fence and unchanged inventory', async () => {
  const digest = await inventoryDigest([record]);
  await expect(archiveFencedOperations(env.DB, transfer, digest, 'test')).rejects.toThrow('fence');
  await freeze();
  await expect(archiveFencedOperations(env.DB, crypto.randomUUID(), digest, 'test')).rejects.toThrow('fence');
  await expect(archiveFencedOperations(env.DB, transfer, 'changed', 'test')).rejects.toThrow('inventory changed');
  expect(await count()).toBe(1);
});
it('preserves every operation and evidence while preventing late writes, restoring obligations on abort', async () => {
  await freeze();
  await archiveFencedOperations(env.DB, transfer, await inventoryDigest([record]), 'test');
  expect(await count()).toBe(0);
  const archived = await env.DB.prepare('SELECT * FROM _bct_handover_reconciled_operations').first<{ id: string; evidence_json: string }>();
  expect(archived?.id).toBe(record.id);
  expect(JSON.parse(archived!.evidence_json).completionClaimed).toBe(false);
  // INSERT triggers run even when the existing table is empty.
  await expect(env.DB.prepare("INSERT INTO orders(id) VALUES('late-write')").run()).rejects.toThrow('paused');
  await restoreReconciledOperations(env.DB, transfer);
  expect(await count()).toBe(1);
  expect(await env.DB.prepare('SELECT id,kind,started_at FROM _bct_handover_operations').first()).toEqual(record);
});
it('blocks reconciliation for unresolved delivery work without discarding the record', async () => {
  await env.DB.prepare("INSERT INTO delivery_events(id,kind,recipient,status,attempt_count,created_at,updated_at) VALUES('pending','operational_alert','test@example.invalid','queued',0,'2000','2000')").run();
  await freeze();
  await expect(archiveFencedOperations(env.DB, transfer, await inventoryDigest([record]), 'test')).rejects.toThrow('deliveries');
  expect(await count()).toBe(1);
});
