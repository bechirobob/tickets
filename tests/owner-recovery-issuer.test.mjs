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

test("explicit new-owner approval creates only a disabled pending owner and binds its grant to the approved email hash", async () => {
  const item = fixture();
  item.request.createOwner = true;
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT id, normalized_email FROM staff_accounts")) return [];
    if (sql.startsWith("INSERT INTO staff_accounts")) { item.calls.push({ sql, params }); return []; }
    if (sql.includes("password_hash = 'setup-pending'")) return [{ id: `owner-setup-${item.request.id}`, normalized_email: `${item.request.id}@owner-setup.invalid`, updated_at: "2026-09-08T00:00:00.000Z" }];
    return item.query(sql, params);
  };
  assert.equal((await issueOwnerRecovery(query, item.request)).status, "issued");
  const create = item.calls.find(({ sql }) => sql.startsWith("INSERT INTO staff_accounts"));
  assert.match(create.sql, /'disabled'/);
  assert.match(create.sql, /ON CONFLICT\(id\) DO NOTHING/);
  const grant = item.calls.find(({ sql }) => sql.startsWith("INSERT INTO staff_password_recoveries"));
  assert.ok(grant.params.includes(item.request.emailSha256));
  assert.ok(item.calls.every(({ sql }) => !sql.startsWith("UPDATE staff_accounts")));
  assert.equal((await issueOwnerRecovery(query, item.request)).status, "already_issued");
});

test("new-owner creation refuses to take over an existing account with the approved email", async () => {
  const item = fixture();
  item.request.createOwner = true;
  const query = async (sql, params) => sql.startsWith("SELECT id, normalized_email FROM staff_accounts")
    ? [{ id: "existing-staff", normalized_email: "owner@example.com" }] : item.query(sql, params);
  await assert.rejects(issueOwnerRecovery(query, item.request), /already uses the approved email/);
  assert.ok(item.calls.every(({ sql }) => !sql.startsWith("INSERT")));
});

test("expired unclaimed owner setup renews the same account with the original email binding", async () => {
  const item = fixture();
  item.request.renewSetupFrom = randomUUID();
  const query = async (sql, params) => {
    if (sql.includes('FROM staff_accounts WHERE role')) return [];
    if (sql.includes('JOIN staff_password_recoveries original')) {
      item.calls.push({ sql, params });
      assert.deepEqual(params, [item.request.renewSetupFrom, item.request.emailSha256, `owner-setup-${item.request.renewSetupFrom}`, `${item.request.renewSetupFrom}@owner-setup.invalid`, `system:approved-owner-setup:${item.request.renewSetupFrom}`]);
      assert.match(sql, /original.used_at IS NULL/);
      assert.match(sql, /original.account_updated_at = account.updated_at/);
      assert.match(sql, /account.role = 'owner'/);
      assert.match(sql, /account.password_hash = 'setup-pending'/);
      return [{ id: `owner-setup-${item.request.renewSetupFrom}`, normalized_email: `${item.request.renewSetupFrom}@owner-setup.invalid`, updated_at: '2026-09-08T00:00:00.000Z' }];
    }
    return item.query(sql, params);
  };
  assert.equal((await issueOwnerRecovery(query, item.request)).status, 'issued');
  const grant = item.calls.find(({ sql }) => sql.startsWith('INSERT INTO staff_password_recoveries'));
  assert.equal(grant.params[4], item.request.emailSha256);
  assert.equal(grant.params[5], `owner-setup-${item.request.renewSetupFrom}`);
  assert.ok(item.calls.every(({ sql }) => !/UPDATE staff_accounts|INSERT INTO staff_accounts/.test(sql)));
  assert.equal((await issueOwnerRecovery(query, item.request)).status, 'already_issued');
});

test("renewal refuses an absent, changed, claimed or differently bound pending setup", async () => {
  const item = fixture(); item.request.renewSetupFrom = randomUUID();
  const query = async (sql, params) => sql.includes('FROM staff_accounts WHERE role') || sql.includes('JOIN staff_password_recoveries original') ? [] : item.query(sql, params);
  await assert.rejects(issueOwnerRecovery(query, item.request), /original pending owner setup could not be verified/);
  assert.ok(item.calls.every(({ sql }) => !sql.startsWith('INSERT')));
});

test("an already activated owner gets a normal reset without another setup or changed email", async () => {
  const item = fixture(); item.request.renewSetupFrom = randomUUID();
  assert.equal((await issueOwnerRecovery(item.query, item.request)).status, 'issued');
  const grant = item.calls.find(({ sql }) => sql.startsWith('INSERT INTO staff_password_recoveries'));
  assert.equal(grant.params[4], null);
  assert.equal(grant.params[5], 'existing-owner');
  assert.ok(item.calls.every(({ sql }) => !sql.includes('JOIN staff_password_recoveries original')));
});

test("renewal cannot be combined with creating another owner", async () => {
  const item = fixture(); item.request.createOwner = true; item.request.renewSetupFrom = randomUUID();
  await assert.rejects(issueOwnerRecovery(item.query, item.request), /Invalid pending-owner renewal/);
  assert.equal(item.calls.length, 0);
});
