import type { RoomReturn } from './room-return';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { sealHandover, requireHandover } from './handover-crypto';
import { controlSchema, requireTransfer } from './handover-control';
import { writerGuardStatements, transitionWriterSql } from '../ops/handover/writer-lock.mjs';

export const configurationNames = [
  'ADMIN_ACCESS_KEY', 'STAFF_LOGIN_DECOY_SECRET', 'PAYSTACK_SECRET_KEY',
  'SEEV_ENABLED', 'SEEV_ENVIRONMENT', 'SEEV_CHECKOUT_API_KEY', 'SEEV_WEBHOOK_SECRET',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_FROM', 'OPS_ALERT_EMAIL',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_GATEWAY_BASE_URL', 'AI_COST_CONTROL_REQUIRED',
  'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_CLASS_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_WALLET_PRIVATE_KEY',
  'APPLE_WALLET_SIGNER_URL', 'APPLE_WALLET_SIGNER_TOKEN', 'APPLE_WALLET_AUTH_SECRET', 'APPLE_WALLET_PASS_TYPE_IDENTIFIER', 'APPLE_WALLET_PUSH_URL',
  'TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY', 'VPS_EMAIL_SIGNING_KEY', 'ENVIRONMENT',
] as const;

// No public HTTP handler. Only an explicitly configured same-account Service
// Binding can invoke this entrypoint; callers cannot choose a decryption key.
export class HandoverEntrypoint extends WorkerEntrypoint<Cloudflare.Env> {
  async prepareSource() {
    requireHandover(this.env);
    await this.env.DB.batch(controlSchema.map(sql => this.env.DB.prepare(sql)));
    return this.sourceStatus();
  }

  async sourceStatus() {
    requireHandover(this.env);
    return {
      revision: this.env.RELEASE_SHA,
      tracking: this.env.HANDOVER_TRACKING === '1',
      admission: await this.env.DB.prepare('SELECT phase,transfer_id,paused_at FROM _bct_handover_admission WHERE id=1').first(),
      operations: (await this.env.DB.prepare('SELECT kind,COUNT(*) AS count,MIN(started_at) AS oldest FROM _bct_handover_operations GROUP BY kind').all()).results,
    };
  }

  async pauseSource(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    if (this.env.HANDOVER_TRACKING !== '1') throw new Error('Tracking must be armed before pausing.');
    const row = await this.env.DB.prepare("UPDATE _bct_handover_admission SET phase='paused',transfer_id=?,paused_at=COALESCE(paused_at,?) WHERE id=1 AND (phase='active' OR (phase='paused' AND transfer_id=?)) RETURNING transfer_id")
      .bind(transferId, new Date().toISOString(), transferId).first();
    if (!row) throw new Error('Source pause belongs to another transfer.');
    return this.sourceStatus();
  }

  async freezeSource(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    const admission = await this.env.DB.prepare("SELECT transfer_id FROM _bct_handover_admission WHERE id=1 AND phase IN ('paused','frozen')").first<{ transfer_id: string }>();
    const active = await this.env.DB.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first<{ n: number }>();
    if (admission?.transfer_id !== transferId || active?.n !== 0) throw new Error('Source has not drained.');
    const tables = (await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_bct_handover_*' ORDER BY name").all<{ name: string }>()).results.map(row => row.name);
    const guards = writerGuardStatements(tables);
    for (let i = 0; i < guards.length; i += 25) await this.env.DB.batch(guards.slice(i, i + 25).map(sql => this.env.DB.prepare(sql)));
    const transition = transitionWriterSql(transferId, true);
    const frozen = await this.env.DB.prepare(transition.sql).bind(...transition.params).first();
    if (!frozen) throw new Error('Writer lock belongs to another transfer.');
    await this.env.DB.prepare("UPDATE _bct_handover_admission SET phase='frozen' WHERE id=1 AND transfer_id=?").bind(transferId).run();
    return this.sourceStatus();
  }

  async freezeRoom(objectId: string, transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error('Invalid Room identifier.');
    return this.env.THE_ROOM.get(this.env.THE_ROOM.idFromString(objectId)).freezeHandover(transferId);
  }

  async restoreRoom(objectId: string, transferId: string, snapshot: RoomReturn) {
    requireHandover(this.env); requireTransfer(transferId);
    if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error('Invalid Room identifier.');
    return this.env.THE_ROOM.get(this.env.THE_ROOM.idFromString(objectId)).restoreHandover(transferId, snapshot);
  }

  async resumeRoom(objectId: string, transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error('Invalid Room identifier.');
    return this.env.THE_ROOM.get(this.env.THE_ROOM.idFromString(objectId)).resumeHandover(transferId);
  }

  async resumeSource(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    const admission = await this.env.DB.prepare("SELECT phase,transfer_id FROM _bct_handover_admission WHERE id=1").first<{ phase: string; transfer_id: string }>();
    if (admission?.transfer_id !== transferId || !['paused', 'frozen'].includes(admission.phase)) throw new Error('A completed transfer requires verified reverse import before release.');
    if (admission.phase === 'frozen') {
      const command = transitionWriterSql(transferId, false);
      if (!await this.env.DB.prepare(command.sql).bind(...command.params).first()) throw new Error('Writer lock belongs to another transfer.');
    }
    await this.env.DB.prepare("UPDATE _bct_handover_admission SET phase='active',paused_at=NULL WHERE id=1 AND transfer_id=?").bind(transferId).run();
    return this.sourceStatus();
  }

  async markTransferred(transferId: string) {
    requireHandover(this.env); requireTransfer(transferId);
    const changed = await this.env.DB.prepare("UPDATE _bct_handover_admission SET phase='transferred' WHERE id=1 AND phase='frozen' AND transfer_id=? RETURNING phase").bind(transferId).first();
    if (!changed) throw new Error('Source is not frozen for this transfer.');
    return changed;
  }

  async backupRecovery() {
    requireHandover(this.env);
    const key = (this.env as unknown as Record<string, unknown>).VPS_BACKUP_RECOVERY_KEY;
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('No backup recovery key.');
    return sealHandover(this.env, 'backup-recovery', { key });
  }

  async roomIdentity(name: string) {
    requireHandover(this.env);
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) throw new Error('Invalid Room name.');
    return { objectId: this.env.THE_ROOM.idFromName(name).toString() };
  }

  async roomSnapshot(objectId: string) {
    requireHandover(this.env);
    if (!/^[a-f0-9]{64}$/.test(objectId)) throw new Error("Invalid Room identifier.");
    return this.env.THE_ROOM.get(this.env.THE_ROOM.idFromString(objectId)).encryptedHandoverSnapshot();
  }

  async configuration() {
    requireHandover(this.env);
    const bindings = this.env as unknown as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const name of configurationNames) {
      if (typeof bindings[name] === 'string') values[name] = bindings[name];
    }
    return sealHandover(this.env, 'configuration', { revision: this.env.RELEASE_SHA, values });
  }
}
