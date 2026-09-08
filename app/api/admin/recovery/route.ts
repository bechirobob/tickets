import { expiredAdminCookieHeader, hashToken, mutationHasValidOrigin, requestMetadata } from "../../../../lib/admin-session";
import { enforceRateLimit } from "../../../../lib/security-controls";
import { claimPasswordRecovery, inspectPasswordRecovery, isRecoveryToken, RECOVERY_ERROR } from "../../../../lib/staff-password-recovery";
import type { StaffPasswordPayload } from "../../../../lib/staff-password-policy";

const privateHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

// Tokens arrive only in a POST body, never a request URL or access log.
export async function POST(request: Request) {
  const respond = (body: object, status: number) => Response.json(body, { status, headers: privateHeaders });
  if (!mutationHasValidOrigin(request)) return respond({ error: "This request was not accepted." }, 403);
  const { env } = await import("cloudflare:workers");
  const metadata = requestMetadata(request);
  if (!(await enforceRateLimit(env.LOGIN_RATE_LIMITER, `staff-recovery-ip:${await hashToken(metadata.ip ?? "unknown")}`))) {
    return respond({ error: "Too many attempts. Wait a minute and try again." }, 429);
  }
  const text = await request.text();
  if (text.length > 4096) return respond({ error: "This request is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return respond({ error: "This request was not accepted." }, 400); }
  if (!isRecoveryToken(body.token)) return respond({ error: RECOVERY_ERROR }, 400);
  if (!(await enforceRateLimit(env.LOGIN_RATE_LIMITER, `staff-recovery-token:${await hashToken(body.token)}`))) {
    return respond({ error: "Too many attempts. Wait a minute and try again." }, 429);
  }
  if (body.action === "inspect") {
    const grant = await inspectPasswordRecovery(env.DB, body.token);
    return grant ? respond({ valid: true, expiresAt: grant.expiresAt, requiresEmail: Boolean(grant.targetEmailHash) }, 200) : respond({ error: RECOVERY_ERROR }, 400);
  }
  if (body.action !== "claim") return respond({ error: "This request was not accepted." }, 400);
  const payload: StaffPasswordPayload = {
    password: typeof body.password === "string" ? body.password : "",
    passwordProof: typeof body.passwordProof === "string" ? body.passwordProof : "",
    passwordSalt: typeof body.passwordSalt === "string" ? body.passwordSalt : "",
    passwordIterations: typeof body.passwordIterations === "number" ? body.passwordIterations : 0,
  };
  try {
    await claimPasswordRecovery(env.DB, body.token, payload, typeof body.email === "string" ? body.email : "");
    return Response.json({ changed: true }, { headers: { ...privateHeaders, "set-cookie": expiredAdminCookieHeader() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = [RECOVERY_ERROR, "The password work factor is invalid.", "The password record is invalid."].includes(message)
      || message.startsWith("Use ") || message.startsWith("Password ");
    return respond({ error: safe ? message : "The password could not be changed. Please try again." }, 400);
  }
}
