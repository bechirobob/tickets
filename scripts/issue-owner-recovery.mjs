import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Called only by the authorised production release. No issuance endpoint is
// exposed to the public, and neither the email nor the bearer token is logged.
export async function issueOwnerRecovery(query, request, now = new Date()) {
  if (!/^[a-f0-9-]{36}$/u.test(request.id) || !/^[a-f0-9]{64}$/u.test(request.emailSha256)
    || !/^[A-Za-z0-9_-]{43}$/u.test(request.tokenHash) || !Number.isFinite(Date.parse(request.issueBefore))) {
    throw new Error("Invalid owner recovery request.");
  }
  if (request.renewSetupFrom !== undefined && (!/^[a-f0-9-]{36}$/u.test(request.renewSetupFrom) || request.createOwner === true)) {
    throw new Error("Invalid pending-owner renewal request.");
  }
  const existing = await query("SELECT id FROM staff_password_recoveries WHERE id = ?", [request.id]);
  if (existing.length) return { status: "already_issued" };
  if (now.getTime() >= Date.parse(request.issueBefore)) return { status: "issuance_window_closed" };
  const createdAt = now.toISOString();
  let owner;
  let targetEmailHash = request.createOwner === true ? request.emailSha256 : null;
  if (request.createOwner === true) {
    // New-owner creation requires a separate, explicit approval. The real email
    // is bound by hash and supplied privately by its holder during activation.
    const accounts = await query("SELECT id, normalized_email FROM staff_accounts LIMIT 1001", []);
    if (accounts.length > 1000) throw new Error("Staff inventory needs manual review.");
    if (accounts.some((account) => createHash("sha256").update(account.normalized_email.trim().toLowerCase()).digest("hex") === request.emailSha256)) {
      throw new Error("An account already uses the approved email. No existing account was changed.");
    }
    const accountId = `owner-setup-${request.id}`;
    const pendingEmail = `${request.id}@owner-setup.invalid`;
    const createdBy = `system:approved-owner-setup:${request.id}`;
    await query(`INSERT INTO staff_accounts
      (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
        must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at)
      VALUES (?, ?, 'BeCore Owner', 'owner', 'setup-pending', 'setup-pending', 600000, 1, 'disabled', 0, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`, [accountId, pendingEmail, createdAt, createdAt, createdBy, createdAt]);
    const pending = await query(`SELECT id, normalized_email, updated_at FROM staff_accounts
      WHERE id = ? AND normalized_email = ? AND created_by = ? AND role = 'owner'
        AND status = 'disabled' AND password_hash = 'setup-pending'`, [accountId, pendingEmail, createdBy]);
    if (pending.length !== 1) throw new Error("The pending owner does not match this approval. No existing account was changed.");
    owner = pending[0];
  } else {
    const owners = await query("SELECT id, normalized_email, updated_at FROM staff_accounts WHERE role = 'owner' AND status IN ('active', 'disabled') LIMIT 101", []);
    if (owners.length > 100) throw new Error("Owner inventory needs manual review.");
    const matches = owners.filter((owner) => createHash("sha256").update(owner.normalized_email.trim().toLowerCase()).digest("hex") === request.emailSha256);
    if (matches.length === 0 && request.renewSetupFrom) {
      // Renew the original, unclaimed setup for this approved email. Never create
      // another owner or bind an unrelated disabled account to a real email.
      const pending = await query(`SELECT account.id, account.normalized_email, account.updated_at
        FROM staff_accounts account JOIN staff_password_recoveries original ON original.account_id = account.id
        WHERE original.id = ? AND original.target_email_hash = ? AND original.used_at IS NULL
          AND original.account_updated_at = account.updated_at
          AND account.id = ? AND account.normalized_email = ? AND account.created_by = ?
          AND account.role = 'owner' AND account.status = 'disabled' AND account.password_hash = 'setup-pending'`,
        [request.renewSetupFrom, request.emailSha256, `owner-setup-${request.renewSetupFrom}`,
          `${request.renewSetupFrom}@owner-setup.invalid`, `system:approved-owner-setup:${request.renewSetupFrom}`]);
      if (pending.length !== 1) throw new Error("The original pending owner setup could not be verified. No access changed.");
      owner = pending[0];
      targetEmailHash = request.emailSha256;
    } else {
      if (matches.length !== 1) throw new Error("The confirmed email did not match exactly one existing owner. No access changed.");
      owner = matches[0];
    }
  }
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  await query(`INSERT INTO staff_password_recoveries (id, account_id, token_hash, account_updated_at, expires_at, created_at, target_email_hash)
    SELECT ?, id, ?, updated_at, ?, ?, ? FROM staff_accounts
    WHERE id = ? AND normalized_email = ? AND role = 'owner' AND status IN ('active', 'disabled') AND updated_at = ?
    ON CONFLICT(id) DO NOTHING`, [request.id, request.tokenHash, expiresAt, createdAt, targetEmailHash, owner.id, owner.normalized_email, owner.updated_at]);
  const issued = await query("SELECT id, expires_at FROM staff_password_recoveries WHERE id = ? AND token_hash = ?", [request.id, request.tokenHash]);
  if (issued.length !== 1) throw new Error("The owner account changed during recovery issuance. No access changed.");
  await query(`INSERT INTO operational_audit_events
    (id, actor_role, action, target_type, target_id, outcome, detail, created_at)
    VALUES (?, 'system', 'staff.owner_recovery_issued', 'staff_account', ?, 'success', ?, ?)`,
    [randomUUID(), owner.id, `Operator-authorised recovery ${request.id}; expires ${issued[0].expires_at}`, createdAt]);
  return { status: "issued", expiresAt: issued[0].expires_at };
}

async function main() {
  const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  const databaseId = config.d1_databases?.find((binding) => binding.binding === "DB")?.database_id;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!databaseId || !accountId || !apiToken) throw new Error("Production database access is not configured.");
  const request = JSON.parse(await readFile("scripts/owner-recovery-request.json", "utf8"));
  const query = async (sql, params) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method: "POST", headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.result?.[0]?.success) throw new Error("Production recovery database operation failed.");
    return payload.result[0].results ?? [];
  };
  const result = await issueOwnerRecovery(query, request);
  console.log(JSON.stringify({ ownerRecovery: result.status, expiresAt: result.expiresAt ?? null }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
