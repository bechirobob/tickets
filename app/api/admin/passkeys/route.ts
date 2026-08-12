import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { beginPasskeyRegistration, finishPasskeyRegistration } from "../../../../lib/staff-passkeys";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  const [passkeys, sessions, recovery] = await Promise.all([
    env.DB.prepare("SELECT id, label, device_type AS deviceType, backed_up AS backedUp, created_at AS createdAt, last_used_at AS lastUsedAt FROM staff_passkeys WHERE account_id = ? ORDER BY created_at DESC")
      .bind(session.accountId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, device_label AS deviceLabel, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, mfa_verified_at AS mfaVerifiedAt FROM staff_sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC")
      .bind(session.accountId, new Date().toISOString()).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM staff_recovery_codes WHERE account_id = ? AND used_at IS NULL").bind(session.accountId).first<{ count: number }>(),
  ]);
  return Response.json({ passkeys: passkeys.results, sessions: sessions.results, currentSessionId: session.sessionId, recoveryCodesRemaining: recovery?.count ?? 0 }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { action?: "begin" | "finish"; exchangeToken?: string; response?: RegistrationResponseJSON; label?: string };
  try {
    if (body.action === "begin") return Response.json(await beginPasskeyRegistration(env.DB, session, new URL(request.url).origin));
    if (body.action === "finish" && body.response) {
      const result = await finishPasskeyRegistration(env.DB, session, new URL(request.url).origin, { exchangeToken: String(body.exchangeToken ?? ""), response: body.response, label: body.label });
      await recordAudit(env.DB, { session, action: "staff.passkey_registered", targetType: "staff_account", targetId: session.accountId, outcome: "success", requestId: requestMetadata(request).requestId });
      return Response.json(result, { status: 201 });
    }
    return Response.json({ error: "Choose a valid passkey action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The passkey could not be saved." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session) return Response.json({ error: "Sign in is required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { sessionId?: string };
  const sessionId = String(body.sessionId ?? "");
  if (!sessionId || sessionId === session.sessionId) return Response.json({ error: "Use Sign out to close this device." }, { status: 400 });
  await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), sessionId, session.accountId).run();
  await recordAudit(env.DB, { session, action: "staff.session_revoked", targetType: "staff_session", targetId: sessionId, outcome: "success", requestId: requestMetadata(request).requestId });
  return Response.json({ revoked: true });
}

