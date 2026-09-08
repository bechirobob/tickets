import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { issueOwnerRecovery } from "../scripts/issue-owner-recovery.mjs";

function fixture() {
  const request = { id: randomUUID(), emailSha256: createHash("sha256").update("owner@example.com").digest("hex"), tokenHash: "A".repeat(43), issueBefore: "2030-01-01T00:00:00.000Z" };
  const calls = [];
  let issued = false;
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id FROM staff_password_recoveries")) return issued ? [{ id: request.id }] : [];
    if (sql.includes("FROM staff_accounts WHERE role")) return [{ id: "existing-owner", normalized_email: "owner@example.com", updated_at: "2026-09-08T00:00:00.000Z" }];
    if (sql.startsWith("INSERT INTO staff_password_recoveries")) issued = true;
    if (sql.startsWith("SELECT id, expires_at")) return issued ? [{ id: request.id, expires_at: "2026-09-08T01:00:00.000Z" }] : [];
    return [];
  };
  return { request, calls, query };
}

test("owner issuance only inserts a grant for the confirmed owner and never reissues", async () => {
  const item = fixture();
  assert.equal((await issueOwnerRecovery(item.query, item.request, new Date("2026-09-08T00:00:00Z"))).status, "issued");
  assert.equal((await issueOwnerRecovery(item.query, item.request)).status, "already_issued");
  assert.equal(item.calls.filter(({ sql }) => sql.startsWith("INSERT INTO staff_password_recoveries")).length, 1);
  assert.ok(item.calls.every(({ sql }) => !/UPDATE staff_accounts|INSERT INTO staff_accounts/.test(sql)));
});

test("owner issuance fails closed for an unmatched email", async () => {
  const item = fixture();
  item.request.emailSha256 = "0".repeat(64);
  await assert.rejects(issueOwnerRecovery(item.query, item.request), /exactly one existing owner/);
  assert.ok(item.calls.every(({ sql }) => !sql.startsWith("INSERT")));
});

test("a stale authorisation cannot issue on a future deployment", async () => {
  const item = fixture();
  assert.equal((await issueOwnerRecovery(item.query, item.request, new Date("2031-01-01T00:00:00Z"))).status, "issuance_window_closed");
  assert.equal(item.calls.length, 1);
});
