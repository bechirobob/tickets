import { readAttendeeIdentity } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";
import { notifyAttendeeDevice } from "../../../../../lib/notifications";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification test was not accepted." }, { status: 403 });
  const body = await request.json() as { endpoint?: string; eventSlug?: string };
  const endpoint = body.endpoint?.trim() ?? "";
  const eventSlug = body.eventSlug?.trim() ?? "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2000 || !/^[a-z0-9-]{1,80}$/u.test(eventSlug)) {
    return Response.json({ error: "This device is not ready for a test yet." }, { status: 400 });
  }
  const recent = await env.DB.prepare(`
    SELECT 1 AS sent FROM attendee_notifications
    WHERE attendee_id = ? AND kind = 'test' AND created_at > ? LIMIT 1
  `).bind(identity.attendeeId, new Date(Date.now() - 30_000).toISOString()).first();
  if (recent) return Response.json({ error: "Give the last test a few seconds to land." }, { status: 429 });
  const sent = await notifyAttendeeDevice(env, identity.attendeeId, endpoint, {
    eventSlug,
    kind: "test",
    title: "There you are ✨",
    body: "Lock-screen Buzz is live. The Room can find you after the tab closes.",
    url: `/room/${encodeURIComponent(eventSlug)}?from=test-notification`,
    sourceId: `test-${crypto.randomUUID()}`,
    tag: `test-${eventSlug}`,
  });
  if (!sent) return Response.json({ error: "This device subscription has expired. Turn notifications off and on again." }, { status: 409 });
  return Response.json({ sent: true });
}
