import { hasPermission, hashToken, mutationHasValidOrigin, readAdminSession, requestMetadata } from "../../../../lib/admin-session";
import { ensureOrganizerAccess, organizerAccessStatus, type InvitationTarget } from "../../../../lib/organizer-invitations";
import { retryFailedDeliveries } from "../../../../lib/email-delivery";
import { enforceRateLimit } from "../../../../lib/security-controls";

async function authorize(request: Request, target: InvitationTarget) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"),env.DB);
  const allowed = session && (target.accountId ? hasPermission(session,"accounts.manage") : hasPermission(session,"curation.manage"));
  return { env, session: allowed ? session : null };
}

function validTarget(value: InvitationTarget) {
  return Boolean(value.submissionId) !== Boolean(value.accountId)
    && [value.submissionId,value.accountId].every(id => id === undefined || (typeof id === "string" && id.length > 0 && id.length <= 128));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = { submissionId: params.get("submissionId") ?? undefined, accountId: params.get("accountId") ?? undefined };
  if (!validTarget(target)) return Response.json({ error: "Choose an organiser." },{ status:400 });
  const { env,session } = await authorize(request,target);
  if (!session) return Response.json({ error: "Operations access is required." },{ status:403 });
  return Response.json(await organizerAccessStatus(env.DB,target),{ headers:{ "cache-control":"no-store" } });
}

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error:"This request was not accepted." },{ status:403 });
  const raw = await request.text();
  if (raw.length > 1024) return Response.json({ error:"This request is too large." },{ status:413 });
  let target: InvitationTarget;
  try { target = JSON.parse(raw); if (!target || !validTarget(target)) throw new Error(); }
  catch { return Response.json({ error:"Choose an organiser." },{ status:400 }); }
  const { env,session } = await authorize(request,target);
  if (!session) return Response.json({ error:"Operations access is required." },{ status:403 });
  const metadata = requestMetadata(request);
  if (!await enforceRateLimit(env.LOGIN_RATE_LIMITER,`organizer-invite:${await hashToken(session.accountId + (metadata.ip ?? ""))}`)) {
    return Response.json({ error:"Too many attempts. Wait a minute and try again." },{ status:429 });
  }
  try {
    await ensureOrganizerAccess(env.DB,target,session.accountId,true);
    await retryFailedDeliveries(env,5,"invitations");
    return Response.json(await organizerAccessStatus(env.DB,target),{ headers:{ "cache-control":"no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = /^(Wait a minute|Approve this submission|The submission needs|This email belongs)/u.test(message);
    return Response.json({ error:safe ? message : "The invitation could not be sent. Try again." },{ status:400 });
  }
}
