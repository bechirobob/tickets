import {
  adminCookieHeader,
  createPasswordRecord,
  createStaffSession,
  hashToken,
  mutationHasValidOrigin,
  normalizeStaffEmail,
  recordAudit,
  recordSecurityEvent,
  requestMetadata,
} from "../../../../lib/admin-session";
import { enforceRateLimit, verifyTurnstile } from "../../../../lib/security-controls";

async function equalSecret(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([hashToken(left), hashToken(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  return difference === 0;
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This setup request was not accepted." }, { status: 403 });
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_accounts").first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return Response.json({ error: "Owner setup is already complete." }, { status: 409 });
  const body = await request.json() as { accessKey?: string; displayName?: string; email?: string; password?: string; turnstileToken?: string };
  const metadata = requestMetadata(request);
  const normalizedEmail = normalizeStaffEmail(String(body.email ?? ""));
  if (!(await enforceRateLimit(env.LOGIN_RATE_LIMITER, `bootstrap:${await hashToken(metadata.ip ?? normalizedEmail)}`))) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: metadata.ip ?? normalizedEmail, path: "/api/admin/bootstrap", requestId: metadata.requestId });
    return Response.json({ error: "Too many setup attempts. Wait a minute and try again." }, { status: 429 });
  }
  if (!(await verifyTurnstile(request, String(body.turnstileToken ?? ""), "owner_bootstrap", env))) {
    return Response.json({ error: "Complete the browser security check and try again." }, { status: 400 });
  }
  if (!env.ADMIN_ACCESS_KEY || !(await equalSecret(String(body.accessKey ?? ""), env.ADMIN_ACCESS_KEY))) {
    await recordSecurityEvent(env.DB, { kind: "login_failed", subject: metadata.ip ?? normalizedEmail, path: "/api/admin/bootstrap", requestId: metadata.requestId, detail: "bootstrap_key_invalid" });
    return Response.json({ error: "The current BeCore access key is incorrect." }, { status: 401 });
  }
  const displayName = String(body.displayName ?? "").trim();
  if (displayName.length < 2 || displayName.length > 100 || !/^\S+@\S+\.\S+$/u.test(normalizedEmail)) {
    return Response.json({ error: "Add a valid owner name and email." }, { status: 400 });
  }
  try {
    const password = await createPasswordRecord(String(body.password ?? ""));
    const accountId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO staff_accounts (
        id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
        must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
      ) SELECT ?, ?, ?, 'owner', ?, ?, ?, 0, 'active', 0, ?, ?, 'system:one-time-bootstrap', ?
      WHERE NOT EXISTS (SELECT 1 FROM staff_accounts)
    `).bind(accountId, normalizedEmail, displayName, password.hash, password.salt, password.iterations, now, now, now).run();
    const created = await env.DB.prepare("SELECT id FROM staff_accounts WHERE id = ? LIMIT 1").bind(accountId).first<{ id: string }>();
    if (!created) return Response.json({ error: "Owner setup was completed by another request. Sign in instead." }, { status: 409 });
    const token = await createStaffSession(env.DB, { id: accountId }, metadata);
    await recordAudit(env.DB, {
      session: { sessionId: "new", accountId, actor: displayName, email: normalizedEmail, role: "owner", expiresAt: 0, mustChangePassword: false },
      action: "staff.owner_bootstrapped", targetType: "staff_account", targetId: accountId, outcome: "success", requestId: metadata.requestId,
    });
    return Response.json({ returnTo: "/admin/accounts", removeLegacySecret: true }, { headers: { "cache-control": "no-store", "set-cookie": adminCookieHeader(token) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Owner setup failed." }, { status: 400 });
  }
}
