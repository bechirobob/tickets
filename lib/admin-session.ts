import {
  base64UrlToBytes,
  bytesToBase64Url,
  PASSWORD_ITERATIONS,
  PASSWORD_PROOF_BYTES,
  PASSWORD_SALT_BYTES,
  validateStaffPassword,
  type StaffPasswordPayload,
} from "./staff-password-policy";
import { isWorkspacePathAllowed, type StaffRole } from "./staff-roles";

export type { StaffRole } from "./staff-roles";

const COOKIE_NAME = "bct_staff";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
// The extra digest prevents a leaked database value from being replayed as the
// client-derived password proof while keeping Worker verification inexpensive.
const PASSWORD_HASH_PREFIX = "client-pbkdf2-sha256-v1.";
export { PASSWORD_ITERATIONS };

export type StaffPermission =
  | "accounts.manage"
  | "curation.manage"
  | "events.manage"
  | "orders.manage"
  | "support.manage"
  | "fees.manage"
  | "gate.scan"
  | "gate.undo"
  | "rooms.moderate"
  | "organizer.workspace"
  | "operations.view";

export type AdminSession = {
  sessionId: string;
  accountId: string;
  actor: string;
  email: string;
  role: StaffRole;
  expiresAt: number;
  mustChangePassword: boolean;
};

type StaffAccountRecord = {
  id: string;
  normalizedEmail: string;
  displayName: string;
  role: StaffRole;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  mustChangePassword: number;
  status: "active" | "disabled";
  failedLoginCount: number;
  lockedUntil: string | null;
  mfaRequired: number;
};

const permissions: Record<StaffRole, readonly StaffPermission[]> = {
  owner: ["accounts.manage", "curation.manage", "events.manage", "orders.manage", "support.manage", "fees.manage", "gate.scan", "gate.undo", "rooms.moderate", "organizer.workspace", "operations.view"],
  curator: ["curation.manage", "events.manage", "operations.view"],
  finance: ["orders.manage", "fees.manage", "operations.view"],
  support: ["support.manage"],
  organizer: ["organizer.workspace"],
  gate: ["gate.scan"],
  moderator: ["rooms.moderate"],
};

export function normalizeStaffEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function createPasswordRecord(payload: StaffPasswordPayload): Promise<{ hash: string; salt: string; iterations: number }> {
  validateStaffPassword(payload.password);
  if (payload.passwordIterations !== PASSWORD_ITERATIONS) throw new Error("The password work factor is invalid.");
  const salt = base64UrlToBytes(payload.passwordSalt);
  const proof = base64UrlToBytes(payload.passwordProof);
  if (salt.length !== PASSWORD_SALT_BYTES || proof.length !== PASSWORD_PROOF_BYTES) throw new Error("The password record is invalid.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", proof));
  return { hash: `${PASSWORD_HASH_PREFIX}${bytesToBase64Url(digest)}`, salt: payload.passwordSalt, iterations: payload.passwordIterations };
}

export async function verifyStaffPassword(passwordProof: string, record: Pick<StaffAccountRecord, "passwordHash" | "passwordSalt" | "passwordIterations">): Promise<boolean> {
  if (record.passwordIterations !== PASSWORD_ITERATIONS || !record.passwordHash.startsWith(PASSWORD_HASH_PREFIX)) return false;
  try {
    const proof = base64UrlToBytes(passwordProof);
    const expected = base64UrlToBytes(record.passwordHash.slice(PASSWORD_HASH_PREFIX.length));
    if (proof.length !== PASSWORD_PROOF_BYTES || expected.length !== 32) return false;
    const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", proof));
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function secureToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

async function runtimeDatabase(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export function hasPermission(session: Pick<AdminSession, "role">, permission: StaffPermission): boolean {
  return permissions[session.role].includes(permission);
}

export function requirePermission(session: AdminSession | null, permission: StaffPermission): AdminSession | null {
  return session && hasPermission(session, permission) ? session : null;
}

export async function hasEventAssignment(db: D1Database, session: AdminSession, eventSlug: string): Promise<boolean> {
  if (session.role === "owner") return true;
  const assignment = await db.prepare("SELECT 1 AS allowed FROM staff_event_assignments WHERE account_id = ? AND event_slug = ? LIMIT 1")
    .bind(session.accountId, eventSlug).first<{ allowed: number }>();
  return Boolean(assignment?.allowed);
}

export async function createStaffSession(
  db: D1Database,
  account: Pick<StaffAccountRecord, "id">,
  metadata: { ip?: string | null; userAgent?: string | null; deviceLabel?: string | null; mfaVerified?: boolean } = {},
): Promise<string> {
  const token = secureToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.prepare(`
    INSERT INTO staff_sessions (id, account_id, token_hash, expires_at, created_at, last_seen_at, ip_hash, user_agent_hash, device_label, mfa_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), account.id, await hashToken(token), expiresAt, now.toISOString(), now.toISOString(),
    metadata.ip ? await hashToken(metadata.ip) : null,
    metadata.userAgent ? await hashToken(metadata.userAgent) : null,
    metadata.deviceLabel?.slice(0, 120) ?? null,
    metadata.mfaVerified ? now.toISOString() : null,
  ).run();
  return token;
}

export async function readAdminSession(cookieHeader: string | null, database?: D1Database): Promise<AdminSession | null> {
  const token = cookieValue(cookieHeader);
  if (!token) return null;
  const db = database ?? await runtimeDatabase();
  const now = new Date();
  const record = await db.prepare(`
    SELECT session.id AS sessionId, account.id AS accountId, account.display_name AS actor,
           account.normalized_email AS email, account.role, account.must_change_password AS mustChangePassword,
           session.expires_at AS expiresAt, session.last_seen_at AS lastSeenAt
    FROM staff_sessions session
    JOIN staff_accounts account ON account.id = session.account_id
    WHERE session.token_hash = ? AND session.revoked_at IS NULL AND session.expires_at > ? AND account.status = 'active'
    LIMIT 1
  `).bind(await hashToken(token), now.toISOString()).first<{
    sessionId: string; accountId: string; actor: string; email: string; role: StaffRole;
    mustChangePassword: number; expiresAt: string; lastSeenAt: string;
  }>();
  if (!record) return null;
  if (now.getTime() - new Date(record.lastSeenAt).getTime() > 15 * 60 * 1000) {
    await db.prepare("UPDATE staff_sessions SET last_seen_at = ? WHERE id = ?").bind(now.toISOString(), record.sessionId).run();
  }
  return {
    sessionId: record.sessionId,
    accountId: record.accountId,
    actor: record.actor,
    email: record.email,
    role: record.role,
    expiresAt: Math.floor(new Date(record.expiresAt).getTime() / 1000),
    mustChangePassword: Boolean(record.mustChangePassword),
  };
}

export async function authenticateStaff(db: D1Database, email: string, passwordProof: string): Promise<{ account: StaffAccountRecord | null; reason: "invalid" | "locked" | "disabled" | null }> {
  const normalizedEmail = normalizeStaffEmail(email);
  const account = await db.prepare(`
    SELECT id, normalized_email AS normalizedEmail, display_name AS displayName, role,
           password_hash AS passwordHash, password_salt AS passwordSalt,
           password_iterations AS passwordIterations, must_change_password AS mustChangePassword,
           status, failed_login_count AS failedLoginCount, locked_until AS lockedUntil,
           mfa_required AS mfaRequired
    FROM staff_accounts WHERE normalized_email = ? LIMIT 1
  `).bind(normalizedEmail).first<StaffAccountRecord>();
  if (!account) return { account: null, reason: "invalid" };
  if (account.status !== "active") return { account: null, reason: "disabled" };
  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now()) return { account: null, reason: "locked" };

  const valid = await verifyStaffPassword(passwordProof, account);
  const now = new Date().toISOString();
  if (!valid) {
    const failures = account.failedLoginCount + 1;
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await db.prepare("UPDATE staff_accounts SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .bind(failures >= 5 ? 0 : failures, lockedUntil, now, account.id).run();
    return { account: null, reason: lockedUntil ? "locked" : "invalid" };
  }
  await db.prepare("UPDATE staff_accounts SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, account.id).run();
  return { account, reason: null };
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/admin";
  if (value.startsWith("/admin") || value === "/scan" || value.startsWith("/organizer/workspace") || value.startsWith("/organizer/analytics")) return value;
  return "/admin";
}

export function defaultWorkspace(role: StaffRole): string {
  if (role === "organizer") return "/organizer/workspace";
  if (role === "gate") return "/scan";
  if (role === "moderator") return "/admin/rooms";
  if (role === "support") return "/admin/support";
  if (role === "finance") return "/admin/orders";
  return "/admin";
}

export function allowedWorkspaceReturn(role: StaffRole, requested: string): string {
  return isWorkspacePathAllowed(role, requested) ? requested : defaultWorkspace(role);
}

export function adminCookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function expiredAdminCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function requestMetadata(request: Request): { requestId: string; ip: string | null; userAgent: string | null } {
  return {
    requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
    ip: request.headers.get("cf-connecting-ip"),
    userAgent: request.headers.get("user-agent"),
  };
}

export function mutationHasValidOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function recordAudit(
  db: D1Database,
  input: { session?: AdminSession | null; action: string; targetType: string; targetId?: string | null; outcome: "success" | "denied" | "failed"; detail?: string | null; requestId?: string | null },
): Promise<void> {
  await db.prepare(`
    INSERT INTO operational_audit_events (
      id, actor_account_id, actor_email, actor_role, action, target_type, target_id, outcome, detail, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), input.session?.accountId ?? null, input.session?.email ?? null, input.session?.role ?? null,
    input.action, input.targetType, input.targetId ?? null, input.outcome, input.detail?.slice(0, 1000) ?? null,
    input.requestId ?? null, new Date().toISOString(),
  ).run();
}

export async function recordSecurityEvent(
  db: D1Database,
  input: { kind: "login_failed" | "login_locked" | "rate_limited" | "access_denied" | "runtime_error"; subject?: string | null; path: string; requestId?: string | null; detail?: string | null },
): Promise<void> {
  await db.prepare(`
    INSERT INTO security_events (id, kind, subject_hash, path, request_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), input.kind, input.subject ? await hashToken(input.subject) : null,
    input.path, input.requestId ?? null, input.detail?.slice(0, 1000) ?? null, new Date().toISOString(),
  ).run();
}
