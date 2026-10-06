import { mutationHasValidOrigin } from "../../../../lib/admin-session";
import { hashToken, readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { readPlatformAnnouncementPreference, updatePlatformAnnouncementPreference } from "../../../../lib/platform-announcements";
import { limitRequestBody } from "../../../../lib/request-body";
import { enforceRateLimit } from "../../../../lib/security-controls";

const headers = { "cache-control": "no-store, private" };

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Open My Nights to manage your email preferences." }, { status: 401, headers });
  // Unverified booking identities must not reveal the typed email's settings.
  if (!identity.emailVerified) return Response.json({ platformAnnouncementsOptIn: false, status: "verification_required", revision: 0, emailVerified: false }, { headers });
  return Response.json({ ...await readPlatformAnnouncementPreference(env.DB, identity.normalizedEmail), emailVerified: true }, { headers });
}

export async function PUT(request: Request) {
  const bounded = await limitRequestBody(request, 1024);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403, headers });
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Open My Nights to manage your email preferences." }, { status: 401, headers });
  if (!identity.emailVerified) return Response.json({ error: "Verify your email through My Nights before changing email preferences." }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { platformAnnouncementsOptIn?: unknown; revision?: unknown } | null;
  if (typeof body?.platformAnnouncementsOptIn !== "boolean" || typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) {
    return Response.json({ error: "Choose your email preference and refresh if it has changed." }, { status: 400, headers });
  }
  if (!await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `platform-preferences:${await hashToken(identity.attendeeId)}`)) {
    return Response.json({ error: "Please wait a moment before changing this preference again." }, { status: 429, headers });
  }
  const result = await updatePlatformAnnouncementPreference(env.DB, {
    email: identity.normalizedEmail, attendeeId: identity.attendeeId, optedIn: body.platformAnnouncementsOptIn, revision: body.revision,
  });
  return Response.json({ ...result.preference, emailVerified: true, saved: result.saved,
    ...(result.saved ? {} : { error: "Your preference changed. Review it before saving again." }),
  }, { status: result.saved ? 200 : 409, headers });
}
