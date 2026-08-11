import {
  adminCookieHeader,
  authenticateStaff,
  createPasswordRecord,
  createStaffSession,
  defaultWorkspace,
  expiredAdminCookieHeader,
  hashToken,
  mutationHasValidOrigin,
  readAdminSession,
  recordAudit,
  recordSecurityEvent,
  requestMetadata,
  safeReturnTo,
  verifyStaffPassword,
} from "../../../../lib/admin-session";
import { enforceRateLimit, verifyTurnstile } from "../../../../lib/security-controls";

function allowedReturnTo(role: string, requested: string): string {
  if (role === "owner") return requested;
  if (role === "organizer") return requested.startsWith("/organizer/workspace") ? requested : "/organizer/workspace";
  if (role === "gate") return requested === "/scan" ? requested : "/scan";
  if (role === "moderator") return requested.startsWith("/admin/rooms") ? requested : "/admin/rooms";
  if (role === "finance") return requested.startsWith("/admin/orders") || requested.startsWith("/admin/fees") ? requested : "/admin/orders";
  if (role === "curator") return requested === "/admin" || requested.startsWith("/admin/events") ? requested : "/admin";
  return "/admin";
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const metadata = requestMetadata(request);
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This sign-in request was not accepted." }, { status: 403 });
  const body = (await request.json()) as { email?: string; password?: string; turnstileToken?: string; returnTo?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const [ipRateAllowed, accountRateAllowed] = await Promise.all([
    enforceRateLimit(env.LOGIN_RATE_LIMITER, `login-ip:${await hashToken(metadata.ip || "unknown")}`),
    enforceRateLimit(env.LOGIN_RATE_LIMITER, `login-account:${await hashToken(email || "unknown")}`),
  ]);
  if (!ipRateAllowed || !accountRateAllowed) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: email || metadata.ip, path: "/api/admin/session", requestId: metadata.requestId });
    return Response.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, { status: 429 });
  }
  if (!(await verifyTurnstile(request, String(body.turnstileToken ?? ""), "staff_login", env))) {
    return Response.json({ error: "Complete the browser security check and try again." }, { status: 400 });
  }

  const authentication = await authenticateStaff(env.DB, email, String(body.password ?? ""));
  if (!authentication.account) {
    await recordSecurityEvent(env.DB, {
      kind: authentication.reason === "locked" ? "login_locked" : "login_failed",
      subject: email || metadata.ip,
      path: "/api/admin/session",
      requestId: metadata.requestId,
      detail: authentication.reason,
    });
    return Response.json(
      { error: authentication.reason === "locked" ? "This account is temporarily locked. Try again in 15 minutes." : "The email or password is incorrect." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const token = await createStaffSession(env.DB, authentication.account, metadata);
  const requested = safeReturnTo(body.returnTo);
  const returnTo = authentication.account.mustChangePassword ? "/admin/account" : allowedReturnTo(authentication.account.role, requested || defaultWorkspace(authentication.account.role));
  await recordAudit(env.DB, {
    session: { sessionId: "new", accountId: authentication.account.id, actor: authentication.account.displayName, email: authentication.account.normalizedEmail, role: authentication.account.role, expiresAt: 0, mustChangePassword: Boolean(authentication.account.mustChangePassword) },
    action: "staff.login",
    targetType: "staff_account",
    targetId: authentication.account.id,
    outcome: "success",
    requestId: metadata.requestId,
  });
  return Response.json({ returnTo }, { headers: { "cache-control": "no-store", "set-cookie": adminCookieHeader(token) } });
}

export async function PATCH(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const body = await request.json() as { currentPassword?: string; newPassword?: string };
  const account = await env.DB.prepare(`
    SELECT password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations
    FROM staff_accounts WHERE id = ? AND status = 'active' LIMIT 1
  `).bind(session.accountId).first<{ passwordHash: string; passwordSalt: string; passwordIterations: number }>();
  if (!account || !(await verifyStaffPassword(String(body.currentPassword ?? ""), account))) {
    return Response.json({ error: "The current password is incorrect." }, { status: 400 });
  }
  try {
    const password = await createPasswordRecord(String(body.newPassword ?? ""));
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE staff_accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(password.hash, password.salt, password.iterations, now, now, session.accountId),
      env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE account_id = ? AND id <> ? AND revoked_at IS NULL")
        .bind(now, session.accountId, session.sessionId),
    ]);
    await recordAudit(env.DB, { session, action: "staff.password_changed", targetType: "staff_account", targetId: session.accountId, outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ changed: true, returnTo: defaultWorkspace(session.role) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The password could not be changed." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (session) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ?").bind(now, session.sessionId).run();
    await recordAudit(env.DB, { session, action: "staff.logout", targetType: "staff_session", targetId: session.sessionId, outcome: "success", requestId: requestMetadata(request).requestId });
  }
  return Response.json({ signedOut: true }, { headers: { "cache-control": "no-store", "set-cookie": expiredAdminCookieHeader() } });
}
