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
  const existing = await query("SELECT id FROM staff_password_recoveries WHERE id = ?", [request.id]);
  if (existing.length) return { status: "already_issued" };
  if (now.getTime() >= Date.parse(request.issueBefore)) return { status: "issuance_window_closed" };
  const owners = await query("SELECT id, normalized_email, updated_at FROM staff_accounts WHERE role = 'owner' AND status IN ('active', 'disabled') LIMIT 101", []);
  if (owners.length > 100) throw new Error("Owner inventory needs manual review.");
  const matches = owners.filter((owner) => createHash("sha256").update(owner.normalized_email.trim().toLowerCase()).digest("hex") === request.emailSha256);
  if (matches.length !== 1) throw new Error("The confirmed email did not match exactly one existing owner. No access changed.");
  const owner = matches[0];
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  await query(`INSERT INTO staff_password_recoveries (id, account_id, token_hash, account_updated_at, expires_at, created_at)
    SELECT ?, id, ?, updated_at, ?, ? FROM staff_accounts
    WHERE id = ? AND normalized_email = ? AND role = 'owner' AND status IN ('active', 'disabled') AND updated_at = ?
    ON CONFLICT(id) DO NOTHING`, [request.id, request.tokenHash, expiresAt, createdAt, owner.id, owner.normalized_email, owner.updated_at]);
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
