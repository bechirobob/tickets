// Explicit incident reconciliation, never time-based lease expiry. The exact
// historical inventory is preserved after SQL fencing and durable-work checks.
export const legacyHttpIncident = {
  count: 116,
  digest: '1ce09ef54981765646448a424926738d477790a85ccb8dc31b646c3d3716b4eb',
  evidenceRun: '36558791879',
} as const;
export type OperationRecord = { id: string; kind: string; started_at: string };
export async function inventoryDigest(rows: OperationRecord[]): Promise<string> {
  const canonical = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(row => ({ id: row.id, kind: row.kind, started_at: row.started_at }));
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function isLegacyInventory(rows: OperationRecord[]): Promise<boolean> {
  return rows.length === legacyHttpIncident.count && rows.every(row => row.kind === 'http')
    && await inventoryDigest(rows) === legacyHttpIncident.digest;
}
export const durableWorkChecks = {
  orders: "SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('paid','expired','cancelled','refunded','failed')",
  refunds: "SELECT COUNT(*) AS n FROM payment_refunds WHERE status IN ('pending','processing')",
  payouts: "SELECT COUNT(*) AS n FROM payout_transfers WHERE status IN ('queued','otp','pending')",
  refundBatches: "SELECT COUNT(*) AS n FROM refund_batches WHERE status IN ('queued','processing')",
  approvals: "SELECT COUNT(*) AS n FROM approval_requests WHERE status='executing'",
  deliveries: "SELECT COUNT(*) AS n FROM delivery_events WHERE status IN ('queued','sent','delayed')",
  confirmations: "SELECT COUNT(*) AS n FROM confirmation_deliveries WHERE status IN ('pending','processing') OR lease_token IS NOT NULL",
  announcements: "SELECT COUNT(*) AS n FROM event_announcement_recipients WHERE status='sending' OR claimed_at IS NOT NULL",
  roomAnnouncements: "SELECT COUNT(*) AS n FROM room_announcement_deliveries WHERE status='processing' OR lease_token IS NOT NULL",
  marketing: "SELECT COUNT(*) AS n FROM marketing_state WHERE lease_token IS NOT NULL",
  marketingCampaigns: "SELECT COUNT(*) AS n FROM marketing_campaigns WHERE status IN ('queued','preparing','sending')",
  reservations: "SELECT COUNT(*) AS n FROM inventory_reservations WHERE status='held'",
} as const;
export const archiveSchema = "CREATE TABLE IF NOT EXISTS _bct_handover_reconciled_operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,started_at TEXT NOT NULL,transfer_id TEXT NOT NULL,evidence_json TEXT NOT NULL)";

export async function archiveFencedOperations(db: D1Database, transferId: string,
  expectedDigest: string, evidenceRun: string): Promise<void> {
  const lock = await db.prepare('SELECT frozen,transfer_id FROM _bct_handover_state WHERE id=1')
    .first<{ frozen: number; transfer_id: string }>();
  const admission = await db.prepare('SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1')
    .first<{ phase: string; transfer_id: string }>();
  if (lock?.frozen !== 1 || lock.transfer_id !== transferId || admission?.phase !== 'paused'
      || admission.transfer_id !== transferId) throw new Error('Exclusive source fence required.');
  const rows = (await db.prepare('SELECT id,kind,started_at FROM _bct_handover_operations ORDER BY id').all<OperationRecord>()).results;
  if (!rows.length || rows.some(row => row.kind !== 'http') || await inventoryDigest(rows) !== expectedDigest)
    throw new Error('Historical operation inventory changed.');
  const counts: Record<string, number> = {};
  for (const [name, sql] of Object.entries(durableWorkChecks)) {
    const result = await db.prepare(sql).first<{ n: number }>();
    if (!result || result.n !== 0) throw new Error('Unresolved durable work: ' + name);
    counts[name] = result.n;
  }
  await db.prepare(archiveSchema).run();
  const evidence = JSON.stringify({ method: 'exclusive-sql-fence-and-terminal-durable-work', digest: expectedDigest,
    evidenceRun, counts, reconciledAt: new Date().toISOString(), completionClaimed: false });
  await db.batch([
    db.prepare('INSERT INTO _bct_handover_reconciled_operations SELECT id,kind,started_at,?,? FROM _bct_handover_operations').bind(transferId, evidence),
    db.prepare('DELETE FROM _bct_handover_operations WHERE id IN (SELECT id FROM _bct_handover_reconciled_operations WHERE transfer_id=?)').bind(transferId),
  ]);
}
export async function restoreReconciledOperations(db: D1Database, transferId: string): Promise<void> {
  const present = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='_bct_handover_reconciled_operations'").first();
  if (!present) return;
  // If capture aborts, restore the original obligations before removing the fence.
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO _bct_handover_operations(id,kind,started_at) SELECT id,kind,started_at FROM _bct_handover_reconciled_operations WHERE transfer_id=?').bind(transferId),
    db.prepare('DELETE FROM _bct_handover_reconciled_operations WHERE transfer_id=?').bind(transferId),
  ]);
}
