import { mutationHasValidOrigin } from "../../../../lib/admin-session";
import { hashToken } from "../../../../lib/attendee-auth";
import { readPlatformAnnouncementVerification } from "../../../../lib/platform-announcements";
import { limitRequestBody } from "../../../../lib/request-body";
import { enforceRateLimit } from "../../../../lib/security-controls";

export async function POST(request: Request) {
  const bounded = await limitRequestBody(request, 1024);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  const headers = { "cache-control": "no-store, private", "referrer-policy": "no-referrer" };
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { grantType?: unknown; token?: unknown } | null;
  if ((body?.grantType !== "recovery" && body?.grantType !== "registration") || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{40,128}$/u.test(body.token)) {
    return Response.json({ confirmsAnnouncements: false }, { headers });
  }
  const { env } = await import("cloudflare:workers");
  if (!await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `platform-verification:${await hashToken(request.headers.get("cf-connecting-ip") ?? "anonymous")}`)) {
    return Response.json({ error: "Please wait a moment before checking this link again." }, { status: 429, headers });
  }
  return Response.json({ confirmsAnnouncements: await readPlatformAnnouncementVerification(env.DB, { grantType: body.grantType, token: body.token }) }, { headers });
}
