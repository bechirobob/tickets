import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST } from "../app/api/admin/recovery/route";
import { authenticateStaff, createPasswordRecord, createStaffSession, hashToken } from "../lib/admin-session";
import { claimPasswordRecovery, inspectPasswordRecovery, RECOVERY_ERROR } from "../lib/staff-password-recovery";
import { bytesToBase64Url, PASSWORD_ITERATIONS } from "../lib/staff-password-policy";

const oldProof = "XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI";
const payload = { password: "BrandNewPassword9", passwordProof: bytesToBase64Url(new Uint8Array(32).fill(12)), passwordSalt: "AAECAwQFBgcICQoLDA0ODw", passwordIterations: PASSWORD_ITERATIONS };

async function fixture() {
  const id = crypto.randomUUID();
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date(Date.now() - 5000).toISOString();
  const record = await createPasswordRecord({ ...payload, passwordProof: oldProof });
  await env.DB.prepare(`INSERT INTO staff_accounts
    (id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
      status, must_change_password, failed_login_count, locked_until, mfa_required, password_changed_at, created_at, created_by, updated_at)
    VALUES (?, ?, 'Owner fixture', 'owner', ?, ?, ?, 'disabled', 1, 4, ?, 1, ?, ?, 'test', ?)`)
    .bind(id, `${id}@example.com`, record.hash, record.salt, record.iterations, new Date(Date.now() + 60000).toISOString(), now, now, now).run();
  await env.DB.prepare(`INSERT INTO staff_password_recoveries
    (id, account_id, token_hash, account_updated_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, id, await hashToken(token), now, new Date(Date.now() + 60000).toISOString(), now).run();
  return { id, token, email: `${id}@example.com` };
}

describe("operator-authorised owner recovery", () => {
  it("activates a fresh pending owner only under the approved email", async () => {
    const item = await fixture();
    const email = `new-${item.id}@example.com`;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
    const emailHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("UPDATE staff_password_recoveries SET target_email_hash = ? WHERE id = ?").bind(emailHash, item.id).run();
    await expect(claimPasswordRecovery(env.DB, item.token, payload, "wrong@example.com")).rejects.toThrow("approved");
    expect(await inspectPasswordRecovery(env.DB, item.token)).not.toBeNull();
    await claimPasswordRecovery(env.DB, item.token, payload, email.toUpperCase());
    expect((await authenticateStaff(env.DB, email, payload.passwordProof)).account?.id).toBe(item.id);
    expect((await authenticateStaff(env.DB, item.email, payload.passwordProof)).account).toBeNull();
  });

  it("rolls back activation and token consumption if the approved email becomes occupied", async () => {
    const item = await fixture();
    const other = await fixture();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(other.email)));
    const emailHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("UPDATE staff_password_recoveries SET target_email_hash = ? WHERE id = ?").bind(emailHash, item.id).run();
    await expect(claimPasswordRecovery(env.DB, item.token, payload, other.email)).rejects.toThrow();
    expect((await env.DB.prepare("SELECT used_at FROM staff_password_recoveries WHERE id = ?").bind(item.id).first())?.used_at).toBeNull();
    expect((await env.DB.prepare("SELECT status FROM staff_accounts WHERE id = ?").bind(item.id).first())?.status).toBe("disabled");
  });

  it("never changes an existing owner's email during ordinary password recovery", async () => {
    const item = await fixture();
    await claimPasswordRecovery(env.DB, item.token, payload, "different@example.com");
    expect((await env.DB.prepare("SELECT normalized_email FROM staff_accounts WHERE id = ?").bind(item.id).first())?.normalized_email).toBe(item.email);
  });

  it("restores only the existing owner, replaces the password, revokes sessions and pending challenges, and retains MFA", async () => {
    const item = await fixture();
    const other = await fixture();
    await createStaffSession(env.DB, { id: item.id });
    await createStaffSession(env.DB, { id: other.id });
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO staff_auth_challenges (id, account_id, purpose, challenge, exchange_token_hash, expires_at, created_at)
      VALUES (?, ?, 'authentication', 'fixture', 'fixture-exchange', ?, ?)`)
      .bind(item.id, item.id, new Date(Date.now() + 60000).toISOString(), now).run();
    await env.DB.prepare("INSERT INTO staff_recovery_codes (id, account_id, code_hash, created_at) VALUES (?, ?, 'fixture-code', ?)")
      .bind(item.id, item.id, now).run();
    expect(await inspectPasswordRecovery(env.DB, item.token)).not.toBeNull();
    expect((await env.DB.prepare("SELECT status FROM staff_accounts WHERE id = ?").bind(item.id).first())?.status).toBe("disabled");
    await claimPasswordRecovery(env.DB, item.token, payload);
    const account = await env.DB.prepare("SELECT status, role, must_change_password, mfa_required, locked_until FROM staff_accounts WHERE id = ?").bind(item.id).first();
    expect(account).toMatchObject({ status: "active", role: "owner", must_change_password: 0, mfa_required: 1, locked_until: null });
    expect((await env.DB.prepare("SELECT revoked_at FROM staff_sessions WHERE account_id = ?").bind(item.id).first())?.revoked_at).toBeTruthy();
    expect((await env.DB.prepare("SELECT revoked_at FROM staff_sessions WHERE account_id = ?").bind(other.id).first())?.revoked_at).toBeNull();
    expect((await env.DB.prepare("SELECT used_at FROM staff_auth_challenges WHERE id = ?").bind(item.id).first())?.used_at).toBeTruthy();
    expect((await env.DB.prepare("SELECT used_at FROM staff_recovery_codes WHERE id = ?").bind(item.id).first())?.used_at).toBeNull();
    expect((await authenticateStaff(env.DB, item.email, oldProof)).account).toBeNull();
    expect((await authenticateStaff(env.DB, item.email, payload.passwordProof)).account?.id).toBe(item.id);
    expect(await inspectPasswordRecovery(env.DB, item.token)).toBeNull();
  });

  it("does not consume links during inspection and does not permit replay", async () => {
    const item = await fixture();
    expect(await inspectPasswordRecovery(env.DB, item.token)).not.toBeNull();
    expect(await inspectPasswordRecovery(env.DB, item.token)).not.toBeNull();
    await claimPasswordRecovery(env.DB, item.token, payload);
    await expect(claimPasswordRecovery(env.DB, item.token, payload)).rejects.toThrow(RECOVERY_ERROR);
  });

  it("allows only one concurrent claimant", async () => {
    const item = await fixture();
    const attempts = await Promise.allSettled([claimPasswordRecovery(env.DB, item.token, payload), claimPasswordRecovery(env.DB, item.token, payload)]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const audit = await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_audit_events WHERE target_id = ? AND action = 'staff.owner_password_recovered'").bind(item.id).first();
    expect(audit?.count).toBe(1);
  });

  it.each(["expired", "demoted", "changed", "missing"])("rejects a %s account/grant without changing credentials", async (mode) => {
    const item = await fixture();
    if (mode === "expired") await env.DB.prepare("UPDATE staff_password_recoveries SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(item.id).run();
    if (mode === "demoted") await env.DB.prepare("UPDATE staff_accounts SET role = 'curator' WHERE id = ?").bind(item.id).run();
    if (mode === "changed") await env.DB.prepare("UPDATE staff_accounts SET updated_at = 'changed' WHERE id = ?").bind(item.id).run();
    if (mode === "missing") await env.DB.prepare("DELETE FROM staff_accounts WHERE id = ?").bind(item.id).run();
    await expect(claimPasswordRecovery(env.DB, item.token, payload)).rejects.toThrow(RECOVERY_ERROR);
    expect((await env.DB.prepare("SELECT used_at FROM staff_password_recoveries WHERE id = ?").bind(item.id).first())?.used_at).toBeNull();
  });

  it("rejects weak password records without consuming the link", async () => {
    const item = await fixture();
    await expect(claimPasswordRecovery(env.DB, item.token, { ...payload, password: "short" })).rejects.toThrow("Use a password");
    await expect(claimPasswordRecovery(env.DB, item.token, { ...payload, passwordIterations: 1 })).rejects.toThrow("work factor");
    expect(await inspectPasswordRecovery(env.DB, item.token)).not.toBeNull();
  });

  it("rejects cross-origin, invalid and oversized requests without account enumeration", async () => {
    const request = (body: string, origin = "https://tickets.becoreops.com") => new Request("https://tickets.becoreops.com/api/admin/recovery", { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    expect((await POST(request("{}", "https://untrusted.example"))).status).toBe(403);
    expect((await POST(request("null"))).status).toBe(400);
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(4097)))).status).toBe(413);
    const invalid = await POST(request(JSON.stringify({ action: "inspect", token: "A".repeat(43) })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: RECOVERY_ERROR });
    expect(invalid.headers.get("cache-control")).toBe("no-store");
  });

  it("returns no session when the password is reset", async () => {
    const item = await fixture();
    const response = await POST(new Request("https://tickets.becoreops.com/api/admin/recovery", {
      method: "POST", headers: { origin: "https://tickets.becoreops.com", "content-type": "application/json" },
      body: JSON.stringify({ action: "claim", token: item.token, ...payload }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({ changed: true });
  });
});
