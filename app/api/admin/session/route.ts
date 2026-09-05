import {
  allowedWorkspaceReturn,
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
import { enforceCompositeRateLimit, enforceRateLimit, type RateLimiter } from "../../../../lib/security-controls";
import { beginPasskeyAuthentication, consumeRecoveryCode, finishPasskeyAuthentication, readAuthenticationChallengeAccount } from "../../../../lib/staff-passkeys";
import { PASSWORD_ITERATIONS, type StaffPasswordPayload } from "../../../../lib/staff-password-policy";
import { staffLoginDecoySalt } from "../../../../lib/staff-login-preparation";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

export async function enforcePasswordLoginLimits(limiter: RateLimiter, ip: string | null, email: string): Promise<boolean> {
  return enforceCompositeRateLimit(limiter, [
    `login-ip:${await hashToken(ip || "unknown")}`,
    `login-account:${await hashToken(email || "unknown")}`,
  ]);
}

export async function enforceMfaLoginLimits(
  limiter: RateLimiter,
  input: { ip: string | null; exchangeToken: string; accountId: string | null },
): Promise<boolean> {
  const keys = [
    `login-mfa-ip:${await hashToken(input.ip || "unknown")}`,
    `login-mfa-exchange:${await hashToken(input.exchangeToken || "unknown")}`,
  ];
  if (input.accountId) keys.push(`login-mfa-account:${await hashToken(input.accountId)}`);
  return enforceCompositeRateLimit(limiter, keys);
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const url = new URL(request.url);
  const requestedEmail = url.searchParams.get("email");
  if (requestedEmail !== null) {
    const email = requestedEmail.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400, headers: { "cache-control": "no-store" } });
    const metadata = requestMetadata(request);
    if (!(await enforceRateLimit(env.LOGIN_RATE_LIMITER, `login-prepare:${await hashToken(metadata.ip || "unknown")}`))) {
      return Response.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, { status: 429 });
    }
    if (!env.STAFF_LOGIN_DECOY_SECRET || env.STAFF_LOGIN_DECOY_SECRET.length < 32) return Response.json({ error: "Sign-in is temporarily unavailable. Please try again later." }, { status: 503, headers: { "cache-control": "no-store" } });
    // Do the same keyed work for both existing and absent accounts.
    const decoySalt = await staffLoginDecoySalt(email, env.STAFF_LOGIN_DECOY_SECRET);
    const account = await env.DB.prepare(`
      SELECT password_salt AS passwordSalt, password_iterations AS passwordIterations
      FROM staff_accounts WHERE normalized_email = ? AND status = 'active' LIMIT 1
    `).bind(email).first<{ passwordSalt: string; passwordIterations: number }>();
    if (account) return Response.json(account, { headers: { "cache-control": "no-store" } });
    return Response.json({ passwordSalt: decoySalt, passwordIterations: PASSWORD_ITERATIONS }, { headers: { "cache-control": "no-store" } });
  }

  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const account = await env.DB.prepare(`
    SELECT password_salt AS passwordSalt, password_iterations AS passwordIterations
    FROM staff_accounts WHERE id = ? AND status = 'active' LIMIT 1
  `).bind(session.accountId).first<{ passwordSalt: string; passwordIterations: number }>();
  if (!account) return Response.json({ error: "This staff account is unavailable." }, { status: 404 });
  return Response.json(account, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const metadata = requestMetadata(request);
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This sign-in request was not accepted." }, { status: 403 });
  const body = (await request.json()) as { email?: string; passwordProof?: string; returnTo?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!(await enforcePasswordLoginLimits(env.LOGIN_RATE_LIMITER, metadata.ip, email))) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: email || metadata.ip, path: "/api/admin/session", requestId: metadata.requestId });
    return Response.json({ error: "Too many sign-in attempts. Wait a minute and try again." }, { status: 429 });
  }

  const authentication = await authenticateStaff(env.DB, email, String(body.passwordProof ?? ""));
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

  const requested = safeReturnTo(body.returnTo);
  const returnTo = authentication.account.mustChangePassword ? "/admin/account" : allowedWorkspaceReturn(authentication.account.role, requested || defaultWorkspace(authentication.account.role));
  const passkeys = await env.DB.prepare("SELECT COUNT(*) AS count FROM staff_passkeys WHERE account_id = ?").bind(authentication.account.id).first<{ count: number }>();
  if (authentication.account.mfaRequired || (passkeys?.count ?? 0) > 0) {
    const challenge = await beginPasskeyAuthentication(env.DB, authentication.account.id, new URL(request.url).origin, returnTo);
    return Response.json({ mfaRequired: true, ...challenge }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const token = await createStaffSession(env.DB, authentication.account, metadata);
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

export async function PUT(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This sign-in request was not accepted." }, { status: 403 });
  const metadata = requestMetadata(request);
  const body = await request.json() as { mode?: "passkey" | "recovery"; exchangeToken?: string; response?: AuthenticationResponseJSON; recoveryCode?: string };
  const exchangeToken = String(body.exchangeToken ?? "");
  const accountId = await readAuthenticationChallengeAccount(env.DB, exchangeToken);
  if (!(await enforceMfaLoginLimits(env.LOGIN_RATE_LIMITER, { ip: metadata.ip, exchangeToken, accountId }))) {
    await recordSecurityEvent(env.DB, {
      kind: "rate_limited",
      subject: accountId ?? metadata.ip,
      path: "/api/admin/session",
      requestId: metadata.requestId,
      detail: "mfa_rate_limited",
    });
    return Response.json({ error: "Too many secure sign-in attempts. Wait a minute and try again." }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  try {
    const verified = body.mode === "recovery"
      ? await consumeRecoveryCode(env.DB, exchangeToken, String(body.recoveryCode ?? ""))
      : await finishPasskeyAuthentication(env.DB, new URL(request.url).origin, { exchangeToken, response: body.response! });
    const account = await env.DB.prepare(`SELECT id, display_name AS displayName, normalized_email AS email, role, must_change_password AS mustChangePassword FROM staff_accounts WHERE id = ? AND status = 'active' LIMIT 1`)
      .bind(verified.accountId).first<{ id: string; displayName: string; email: string; role: import("../../../../lib/admin-session").StaffRole; mustChangePassword: number }>();
    if (!account) return Response.json({ error: "This staff account is unavailable." }, { status: 403 });
    const returnTo = account.mustChangePassword ? "/admin/account" : allowedWorkspaceReturn(account.role, safeReturnTo(verified.returnTo));
    const token = await createStaffSession(env.DB, account, { ...metadata, mfaVerified: true, deviceLabel: metadata.userAgent?.slice(0, 120) });
    await recordAudit(env.DB, {
      session: { sessionId: "new", accountId: account.id, actor: account.displayName, email: account.email, role: account.role, expiresAt: 0, mustChangePassword: Boolean(account.mustChangePassword) },
      action: body.mode === "recovery" ? "staff.recovery_code_login" : "staff.passkey_login",
      targetType: "staff_account", targetId: account.id, outcome: "success", requestId: metadata.requestId,
    });
    return Response.json({ returnTo }, { headers: { "cache-control": "no-store", "set-cookie": adminCookieHeader(token) } });
  } catch (error) {
    await recordSecurityEvent(env.DB, { kind: "login_failed", subject: metadata.ip, path: "/api/admin/session", requestId: metadata.requestId, detail: "mfa_failed" });
    return Response.json({ error: error instanceof Error ? error.message : "Secure sign-in failed." }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const body = await request.json() as Partial<StaffPasswordPayload> & { currentPasswordProof?: string };
  const account = await env.DB.prepare(`
    SELECT password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations
    FROM staff_accounts WHERE id = ? AND status = 'active' LIMIT 1
  `).bind(session.accountId).first<{ passwordHash: string; passwordSalt: string; passwordIterations: number }>();
  if (!account || !(await verifyStaffPassword(String(body.currentPasswordProof ?? ""), account))) {
    return Response.json({ error: "The current password is incorrect." }, { status: 400 });
  }
  try {
    const password = await createPasswordRecord({
      password: String(body.password ?? ""),
      passwordProof: String(body.passwordProof ?? ""),
      passwordSalt: String(body.passwordSalt ?? ""),
      passwordIterations: Number(body.passwordIterations ?? 0),
    });
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
