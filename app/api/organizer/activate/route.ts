import { expiredAdminCookieHeader, hashToken, mutationHasValidOrigin, requestMetadata } from "../../../../lib/admin-session";
import { claimOrganizerInvitation, inspectOrganizerInvitation } from "../../../../lib/organizer-invitations";
import { isRecoveryToken, RECOVERY_ERROR } from "../../../../lib/staff-password-recovery-client";
import { enforceRateLimit } from "../../../../lib/security-controls";

const headers = { "cache-control":"no-store", "referrer-policy":"no-referrer" };
export async function POST(request: Request) {
  const respond = (body: object,status: number) => Response.json(body,{ status,headers });
  if (!mutationHasValidOrigin(request)) return respond({ error:"This request was not accepted." },403);
  const { env } = await import("cloudflare:workers");
  if (!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`organizer-setup-ip:${await hashToken(requestMetadata(request).ip ?? "unknown")}`)) return respond({ error:"Too many attempts. Give it a minute." },429);
  const raw = await request.text();
  if (raw.length > 4096) return respond({ error:"This request is too large." },413);
  let body: Record<string,unknown>;
  try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return respond({ error:"This request was not accepted." },400); }
  if (!isRecoveryToken(body.token)) return respond({ error:RECOVERY_ERROR },400);
  if (!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`organizer-setup-token:${await hashToken(body.token)}`)) return respond({ error:"Too many attempts. Give it a minute." },429);
  if (body.action === "inspect") {
    const grant = await inspectOrganizerInvitation(env.DB,body.token);
    return grant ? respond({ valid:true,...grant },200) : respond({ error:RECOVERY_ERROR },400);
  }
  if (body.action !== "claim") return respond({ error:"This request was not accepted." },400);
  try {
    await claimOrganizerInvitation(env.DB,body.token,{
      password: typeof body.password === "string" ? body.password : "",
      passwordProof: typeof body.passwordProof === "string" ? body.passwordProof : "",
      passwordSalt: typeof body.passwordSalt === "string" ? body.passwordSalt : "",
      passwordIterations: typeof body.passwordIterations === "number" ? body.passwordIterations : 0,
    });
    return Response.json({ changed:true },{ headers:{ ...headers,"set-cookie":expiredAdminCookieHeader() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return respond({ error:message === RECOVERY_ERROR || /^(Use |The password)/u.test(message) ? message : "Your password couldn’t be saved. Try again." },400);
  }
}
