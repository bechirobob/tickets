import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as readWorkspace, PATCH as updateWorkspace } from "../app/api/organizer/workspace/route";
import { GET as readFeeConfig } from "../app/api/config/booking-fee/route";
import { POST as bootstrapOwner } from "../app/api/admin/bootstrap/route";
import { GET as readOperations, POST as updateOperations } from "../app/api/admin/operations/route";
import { GET as readSupport } from "../app/api/admin/support/route";
import {
  adminCookieHeader,
  authenticateStaff,
  createPasswordRecord,
  createStaffSession,
  hasPermission,
  readAdminSession,
  verifyStaffPassword,
  type StaffRole,
} from "../lib/admin-session";
import { PASSWORD_ITERATIONS } from "../lib/staff-password-policy";
import { isWorkspacePathAllowed } from "../lib/staff-roles";

const password = "CorrectHorse9Battery";
const passwordProof = "XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI";
const passwordSalt = "AAECAwQFBgcICQoLDA0ODw";

async function passwordRecord() {
  return createPasswordRecord({ password, passwordProof, passwordSalt, passwordIterations: PASSWORD_ITERATIONS });
}

async function staff(role: StaffRole, suffix: string) {
  const id = `${role}-${suffix}`;
  const email = `${id}@example.com`;
  const now = new Date().toISOString();
  const record = await passwordRecord();
  await env.DB.prepare(`INSERT INTO staff_accounts (
    id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
    must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', 0, ?, ?, 'test', ?)`)
    .bind(id, email, `${role} ${suffix}`, role, record.hash, record.salt, record.iterations, now, now, now).run();
  const token = await createStaffSession(env.DB, { id });
  return { id, email, cookie: adminCookieHeader(token).split(";")[0] };
}

async function event(slug: string, title: string) {
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 30 * 86_400_000 + 21_600_000).toISOString();
  await env.DB.prepare(`INSERT INTO curated_event_records (
    id, submission_id, slug, title, venue, venue_map_url, area, starts_at, ends_at, vibe,
    price_from_minor, capacity, sales_open_at, sales_close_at, age_restriction, lineup,
    event_state, image_url, curation_note, status, published_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'The Test Venue', 'https://maps.google.com/?q=venue', 'Accra', ?, ?,
    'Late night', 10000, 200, ?, ?, '18+', 'Test line-up', 'on_sale',
    'https://example.com/event.jpg', 'A test event for staff authorization boundaries.', 'published', ?, ?, ?)`)
    .bind(`id-${slug}`, `submission-${slug}`, slug, title, startsAt, endsAt, now, startsAt, now, now, now).run();
}

describe("named staff access", () => {
  it("creates and verifies the production-strength password record in the Workers runtime", async () => {
    const record = await passwordRecord();
    expect(record.iterations).toBe(PASSWORD_ITERATIONS);
    expect(record.hash).toBe("client-pbkdf2-sha256-v1.8Pvq8lsNWJGWQ-cR8vPdPCDZCpAHW4s3R_BI3DnBDcI");
    await expect(verifyStaffPassword(passwordProof, {
      passwordHash: record.hash,
      passwordSalt: record.salt,
      passwordIterations: record.iterations,
    })).resolves.toBe(true);
    await expect(verifyStaffPassword("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", {
      passwordHash: record.hash,
      passwordSalt: record.salt,
      passwordIterations: record.iterations,
    })).resolves.toBe(false);
  });

  it("bootstraps the first owner without running PBKDF2 inside the Worker", async () => {
    const response = await bootstrapOwner(new Request("https://tickets.becoreops.com/api/admin/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({
        accessKey: "bootstrap-test-key",
        displayName: "Test Owner",
        email: "owner-bootstrap@example.com",
        password,
        passwordProof,
        passwordSalt,
        passwordIterations: PASSWORD_ITERATIONS,
      }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ returnTo: "/admin/accounts", removeLegacySecret: true });
    await expect(env.DB.prepare("SELECT role, password_iterations AS iterations FROM staff_accounts WHERE normalized_email = ?")
      .bind("owner-bootstrap@example.com").first()).resolves.toMatchObject({ role: "owner", iterations: PASSWORD_ITERATIONS });
  });

  it("uses role permissions and opaque, revocable server-side sessions", async () => {
    expect(hasPermission({ role: "owner" }, "accounts.manage")).toBe(true);
    expect(hasPermission({ role: "finance" }, "orders.manage")).toBe(true);
    expect(hasPermission({ role: "finance" }, "curation.manage")).toBe(false);
    expect(hasPermission({ role: "finance" }, "support.manage")).toBe(false);
    expect(hasPermission({ role: "support" }, "support.manage")).toBe(true);
    expect(hasPermission({ role: "support" }, "orders.manage")).toBe(false);
    expect(hasPermission({ role: "gate" }, "gate.scan")).toBe(true);
    expect(hasPermission({ role: "gate" }, "orders.manage")).toBe(false);
    expect(isWorkspacePathAllowed("finance", "/admin/fees")).toBe(true);
    expect(isWorkspacePathAllowed("finance", "/admin/support")).toBe(false);
    expect(isWorkspacePathAllowed("support", "/admin/support")).toBe(true);
    expect(isWorkspacePathAllowed("support", "/admin/orders")).toBe(false);
    expect(isWorkspacePathAllowed("moderator", "/admin/rooms")).toBe(true);
    expect(isWorkspacePathAllowed("moderator", "/admin/fees")).toBe(false);
    expect(isWorkspacePathAllowed("owner", "/organizer/workspace")).toBe(true);

    const account = await staff("curator", crypto.randomUUID().slice(0, 8));
    const authenticated = await authenticateStaff(env.DB, account.email.toUpperCase(), passwordProof);
    expect(authenticated.account).toMatchObject({ id: account.id, role: "curator" });
    const session = await readAdminSession(account.cookie, env.DB);
    expect(session).toMatchObject({ accountId: account.id, email: account.email, role: "curator" });
    expect(account.cookie).not.toContain(account.id);

    await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), session!.sessionId).run();
    expect(await readAdminSession(account.cookie, env.DB)).toBeNull();
  });

  it("limits organisers to their assigned events and writes an audit trail", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const organizer = await staff("organizer", suffix);
    const assignedSlug = `assigned-${suffix}`;
    const otherSlug = `other-${suffix}`;
    await event(assignedSlug, "Assigned Night");
    await event(otherSlug, "Someone Else's Night");
    await env.DB.prepare("INSERT INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, 'test', ?)")
      .bind(organizer.id, assignedSlug, new Date().toISOString()).run();

    const response = await readWorkspace(new Request("https://tickets.becoreops.com/api/organizer/workspace", {
      headers: { cookie: organizer.cookie },
    }));
    expect(response.status).toBe(200);
    const workspace = await response.json() as { events: Array<{ slug: string; title: string }> };
    expect(workspace.events).toEqual([expect.objectContaining({ slug: assignedSlug, title: "Assigned Night" })]);
    expect(JSON.stringify(workspace)).not.toContain("Someone Else's Night");

    const denied = await updateWorkspace(new Request("https://tickets.becoreops.com/api/organizer/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: organizer.cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ eventSlug: otherSlug, venue: "Changed Venue", venueMapUrl: "https://maps.google.com/changed", lineup: "Changed line-up" }),
    }));
    expect(denied.status).toBe(403);

    const updated = await updateWorkspace(new Request("https://tickets.becoreops.com/api/organizer/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: organizer.cookie, origin: "https://tickets.becoreops.com", "cf-ray": `test-${suffix}` },
      body: JSON.stringify({ eventSlug: assignedSlug, venue: "Updated Venue", venueMapUrl: "https://maps.google.com/updated", lineup: "Updated line-up" }),
    }));
    expect(updated.status).toBe(200);
    expect(await env.DB.prepare("SELECT venue FROM curated_event_records WHERE slug = ?").bind(assignedSlug).first()).toMatchObject({ venue: "Updated Venue" });
    expect(await env.DB.prepare("SELECT actor_account_id AS actorId, action, target_id AS targetId FROM operational_audit_events WHERE request_id = ?")
      .bind(`test-${suffix}`).first()).toMatchObject({ actorId: organizer.id, action: "organizer.event_details_updated", targetId: assignedSlug });
  });

  it("keeps event, finance and support workspaces separated on the server", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const curator = await staff("curator", `curator-${suffix}`);
    const finance = await staff("finance", `finance-${suffix}`);
    const support = await staff("support", `support-${suffix}`);
    const slug = `boundary-${suffix}`;
    await event(slug, "Boundary Night");
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO approval_requests (id, kind, event_slug, payload_json, status, requested_by, requested_by_email, requested_at) VALUES (?, 'event_cancellation', ?, '{}', 'pending', 'requester-a', 'curation@example.com', ?)")
        .bind(`cancel-${suffix}`, slug, now),
      env.DB.prepare("INSERT INTO approval_requests (id, kind, event_slug, payload_json, status, requested_by, requested_by_email, requested_at) VALUES (?, 'mass_refund', ?, '{}', 'pending', 'requester-b', 'finance@example.com', ?)")
        .bind(`refund-${suffix}`, slug, now),
    ]);

    const curatorResponse = await readOperations(new Request("https://tickets.becoreops.com/api/admin/operations", { headers: { cookie: curator.cookie } }));
    expect(curatorResponse.status).toBe(200);
    const curatorData = await curatorResponse.json() as { metrics: Array<Record<string, unknown>>; checks: unknown[]; approvals: Array<{ kind: string }> };
    expect(curatorData.metrics[0]).not.toHaveProperty("grossMinor");
    expect(curatorData.metrics[0]).toHaveProperty("activeTickets");
    expect(curatorData.checks.length).toBeGreaterThan(0);
    expect(curatorData.approvals.map((item) => item.kind)).toContain("event_cancellation");
    expect(curatorData.approvals.map((item) => item.kind)).not.toContain("mass_refund");

    const financeResponse = await readOperations(new Request("https://tickets.becoreops.com/api/admin/operations", { headers: { cookie: finance.cookie } }));
    expect(financeResponse.status).toBe(200);
    const financeData = await financeResponse.json() as { metrics: Array<Record<string, unknown>>; checks: unknown[]; devices: unknown[]; incidents: unknown[]; approvals: Array<{ kind: string }> };
    expect(financeData.metrics[0]).toHaveProperty("grossMinor");
    expect(financeData.metrics[0]).not.toHaveProperty("activeTickets");
    expect(financeData.checks).toEqual([]);
    expect(financeData.devices).toEqual([]);
    expect(financeData.incidents).toEqual([]);
    expect(financeData.approvals.map((item) => item.kind)).toContain("mass_refund");
    expect(financeData.approvals.map((item) => item.kind)).not.toContain("event_cancellation");

    const deniedReadiness = await updateOperations(new Request("https://tickets.becoreops.com/api/admin/operations", {
      method: "POST",
      headers: { cookie: finance.cookie, origin: "https://tickets.becoreops.com", "content-type": "application/json" },
      body: JSON.stringify({ action: "readiness", eventSlug: slug, checkKey: "venue", status: "passed" }),
    }));
    expect(deniedReadiness.status).toBe(403);
    const deniedFinanceApproval = await updateOperations(new Request("https://tickets.becoreops.com/api/admin/operations", {
      method: "POST",
      headers: { cookie: curator.cookie, origin: "https://tickets.becoreops.com", "content-type": "application/json" },
      body: JSON.stringify({ action: "approval", approvalId: `refund-${suffix}`, decision: "approve" }),
    }));
    expect(deniedFinanceApproval.status).toBe(403);

    expect((await readSupport(new Request("https://tickets.becoreops.com/api/admin/support", { headers: { cookie: finance.cookie } }))).status).toBe(403);
    expect((await readSupport(new Request("https://tickets.becoreops.com/api/admin/support", { headers: { cookie: support.cookie } }))).status).toBe(200);
  });

  it("keeps fee audit identities out of the public configuration response", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO booking_fee_rules (id, percentage_basis_points, scope, effective_at, created_at, created_by) VALUES (?, 825, 'global', ?, ?, 'Sensitive Finance Identity')")
      .bind(`fee-${suffix}`, now, now).run();
    await env.DB.prepare("INSERT INTO booking_fee_rules (id, percentage_basis_points, scope, effective_at, created_at, created_by) VALUES (?, 990, 'global', ?, ?, 'Future Finance Identity')")
      .bind(`fee-future-${suffix}`, new Date(Date.now() + 86_400_000).toISOString(), now).run();
    const publicResult = await (await readFeeConfig(new Request("https://tickets.becoreops.com/api/config/booking-fee"))).json() as Record<string, unknown>;
    expect(publicResult).toEqual({ percentage: 8.25 });
    expect(JSON.stringify(publicResult)).not.toContain("Sensitive Finance Identity");

    const finance = await staff("finance", suffix);
    const privateResult = await (await readFeeConfig(new Request("https://tickets.becoreops.com/api/config/booking-fee", { headers: { cookie: finance.cookie } }))).json() as { history: Array<{ createdBy: string }> };
    expect(privateResult.history.map((item) => item.createdBy)).toEqual(expect.arrayContaining(["Sensitive Finance Identity", "Future Finance Identity"]));
  });
});
