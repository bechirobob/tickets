import {
  createPasswordRecord,
  hasPermission,
  mutationHasValidOrigin,
  normalizeStaffEmail,
  readAdminSession,
  recordAudit,
  requestMetadata,
  type StaffRole,
} from "../../../../lib/admin-session";
import type { StaffPasswordPayload } from "../../../../lib/staff-password-policy";
import { isEventScopedRole, STAFF_ROLES } from "../../../../lib/staff-roles";

async function owner(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "accounts.manage") ? session : null };
}

export async function GET(request: Request) {
  const { env, session } = await owner(request);
  if (!session) return Response.json({ error: "Owner access is required." }, { status: 403 });
  const [accounts, assignments, events] = await Promise.all([
    env.DB.prepare(`SELECT id, normalized_email AS email, display_name AS displayName, role, must_change_password AS mustChangePassword,
      status, locked_until AS lockedUntil, last_login_at AS lastLoginAt, created_at AS createdAt FROM staff_accounts ORDER BY created_at`)
      .all<Record<string, unknown>>(),
    env.DB.prepare("SELECT account_id AS accountId, event_slug AS eventSlug FROM staff_event_assignments ORDER BY event_slug").all<{ accountId: string; eventSlug: string }>(),
    env.DB.prepare("SELECT slug, title, starts_at AS startsAt FROM curated_event_records ORDER BY starts_at DESC").all<Record<string, unknown>>(),
  ]);
  return Response.json({
    accounts: accounts.results.map((account) => ({ ...account, eventSlugs: assignments.results.filter((item) => item.accountId === account.id).map((item) => item.eventSlug) })),
    events: events.results,
    currentAccountId: session.accountId,
  }, { headers: { "cache-control": "no-store" } });
}

function accountInput(body: Record<string, unknown>) {
  const role = String(body.role ?? "") as StaffRole;
  const email = normalizeStaffEmail(String(body.email ?? ""));
  const displayName = String(body.displayName ?? "").trim();
  if (!(STAFF_ROLES as readonly string[]).includes(role) || !/^\S+@\S+\.\S+$/u.test(email) || displayName.length < 2 || displayName.length > 100) {
    throw new Error("Add a valid name, email and role.");
  }
  const eventSlugs = Array.isArray(body.eventSlugs) ? [...new Set(body.eventSlugs.map(String).filter((value) => /^[a-z0-9-]{1,80}$/u.test(value)))] : [];
  return { role, email, displayName, eventSlugs: isEventScopedRole(role) ? eventSlugs : [] };
}

export async function POST(request: Request) {
  const { env, session } = await owner(request);
  if (!session) return Response.json({ error: "Owner access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input = accountInput(body);
    const password = await createPasswordRecord({
      password: String(body.temporaryPassword ?? ""),
      passwordProof: String(body.passwordProof ?? ""),
      passwordSalt: String(body.passwordSalt ?? ""),
      passwordIterations: Number(body.passwordIterations ?? 0),
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO staff_accounts (
        id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
        must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', 0, ?, ?, ?, ?)`)
        .bind(id, input.email, input.displayName, input.role, password.hash, password.salt, password.iterations, now, now, session.accountId, now),
      ...input.eventSlugs.map((slug) => env.DB.prepare("INSERT INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, ?, ?)")
        .bind(id, slug, session.accountId, now)),
    ]);
    await recordAudit(env.DB, { session, action: "staff.account_created", targetType: "staff_account", targetId: id, outcome: "success", detail: input.role, requestId: requestMetadata(request).requestId });
    return Response.json({ id, created: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The account could not be created." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const { env, session } = await owner(request);
  if (!session) return Response.json({ error: "Owner access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    const current = await env.DB.prepare("SELECT id, role, status FROM staff_accounts WHERE id = ? LIMIT 1").bind(id).first<{ id: string; role: StaffRole; status: string }>();
    if (!current) return Response.json({ error: "Account not found." }, { status: 404 });
    const input = accountInput(body);
    const status = body.status === "disabled" ? "disabled" : "active";
    if (id === session.accountId && (status === "disabled" || input.role !== "owner")) throw new Error("You cannot disable or demote your active owner account.");
    if (current.role === "owner" && (status === "disabled" || input.role !== "owner")) {
      const owners = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE role = 'owner' AND status = 'active'").first<{ count: number }>();
      if ((owners?.count ?? 0) <= 1) throw new Error("Create another active owner before removing the last owner.");
    }
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare("UPDATE staff_accounts SET normalized_email = ?, display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?")
        .bind(input.email, input.displayName, input.role, status, now, id),
      env.DB.prepare("DELETE FROM staff_event_assignments WHERE account_id = ?").bind(id),
      ...input.eventSlugs.map((slug) => env.DB.prepare("INSERT INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, ?, ?)")
        .bind(id, slug, session.accountId, now)),
    ];
    if (status === "disabled") statements.push(env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(now, id));
    if (typeof body.temporaryPassword === "string" && body.temporaryPassword.length > 0) {
      const password = await createPasswordRecord({
        password: body.temporaryPassword,
        passwordProof: String(body.passwordProof ?? ""),
        passwordSalt: String(body.passwordSalt ?? ""),
        passwordIterations: Number(body.passwordIterations ?? 0),
      } satisfies StaffPasswordPayload);
      statements.push(env.DB.prepare("UPDATE staff_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 1, password_changed_at = ?, updated_at = ? WHERE id = ?")
        .bind(password.hash, password.salt, password.iterations, now, now, id));
      statements.push(env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(now, id));
    }
    await env.DB.batch(statements);
    await recordAudit(env.DB, { session, action: "staff.account_updated", targetType: "staff_account", targetId: id, outcome: "success", detail: `${input.role}:${status}`, requestId: requestMetadata(request).requestId });
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The account could not be updated." }, { status: 400 });
  }
}
