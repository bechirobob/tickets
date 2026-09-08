import { createPasswordRecord, hashToken } from "./admin-session";
import type { StaffPasswordPayload } from "./staff-password-policy";
import { RECOVERY_ERROR, isRecoveryToken } from "./staff-password-recovery-client";
export { RECOVERY_ERROR, isRecoveryToken } from "./staff-password-recovery-client";

const eligibleAccount = `SELECT id FROM staff_accounts
  WHERE role = 'owner' AND status IN ('active', 'disabled')
    AND id = staff_password_recoveries.account_id
    AND updated_at = staff_password_recoveries.account_updated_at`;

export async function inspectPasswordRecovery(db: D1Database, token: string) {
  if (!isRecoveryToken(token)) return null;
  return db.prepare(`SELECT expires_at AS expiresAt, target_email_hash AS targetEmailHash FROM staff_password_recoveries
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      AND EXISTS (${eligibleAccount}) LIMIT 1`)
    .bind(await hashToken(token), new Date().toISOString()).first<{ expiresAt: string; targetEmailHash: string | null }>();
}

export async function claimPasswordRecovery(db: D1Database, token: string, payload: StaffPasswordPayload, email = "") {
  const grant = isRecoveryToken(token) ? await inspectPasswordRecovery(db, token) : null;
  if (!grant) throw new Error(RECOVERY_ERROR);
  const normalizedEmail = email.trim().toLowerCase();
  if (grant.targetEmailHash) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedEmail)));
    const emailHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail) || emailHash !== grant.targetEmailHash) {
      throw new Error("Use the email approved for this owner setup.");
    }
  }
  const password = await createPasswordRecord(payload);
  const now = new Date().toISOString();
  const claimId = crypto.randomUUID();
  const claimedAccount = "SELECT account_id FROM staff_password_recoveries WHERE claim_id = ?";
  // One transaction owns the grant before it changes any credentials. A concurrent
  // claim cannot update the account, revoke sessions or write a success audit.
  const results = await db.batch([
    db.prepare(`UPDATE staff_password_recoveries SET used_at = ?, claim_id = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND EXISTS (${eligibleAccount})`)
      .bind(now, claimId, await hashToken(token), now),
    db.prepare(`UPDATE staff_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?,
      normalized_email = CASE WHEN ? = 1 THEN ? ELSE normalized_email END,
      status = 'active', must_change_password = 0, failed_login_count = 0, locked_until = NULL,
      password_changed_at = ?, updated_at = ? WHERE id IN (${claimedAccount})`)
      .bind(password.hash, password.salt, password.iterations, grant.targetEmailHash ? 1 : 0, normalizedEmail, now, now, claimId),
    db.prepare(`UPDATE staff_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND account_id IN (${claimedAccount})`).bind(now, claimId),
    db.prepare(`UPDATE staff_auth_challenges SET used_at = ? WHERE used_at IS NULL AND account_id IN (${claimedAccount})`).bind(now, claimId),
    db.prepare(`UPDATE staff_password_recoveries SET used_at = ? WHERE used_at IS NULL AND account_id IN (${claimedAccount})`).bind(now, claimId),
    db.prepare(`INSERT INTO operational_audit_events
      (id, actor_account_id, actor_email, actor_role, action, target_type, target_id, outcome, detail, created_at)
      SELECT ?, id, normalized_email, role, 'staff.owner_password_recovered', 'staff_account', id,
        'success', 'Operator-authorised recovery; sessions revoked; MFA retained.', ?
      FROM staff_accounts WHERE id IN (${claimedAccount})`).bind(crypto.randomUUID(), now, claimId),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new Error(RECOVERY_ERROR);
}
