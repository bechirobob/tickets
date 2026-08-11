import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../lib/admin-session";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ member: false }, { status: 401, headers: { "cache-control": "no-store" } });
  const url = new URL(request.url);
  const eventSlug = url.searchParams.get("event")?.trim() ?? "";
  const hostSlug = url.searchParams.get("host")?.trim() ?? "";
  const [eventPreference, hostFollow] = await Promise.all([
    eventSlug ? env.DB.prepare("SELECT keep_posted AS keepPosted FROM attendee_event_preferences WHERE attendee_id = ? AND event_slug = ? LIMIT 1").bind(identity.attendeeId, eventSlug).first<{ keepPosted: number }>() : null,
    hostSlug ? env.DB.prepare("SELECT 1 AS following FROM attendee_host_follows follow JOIN hosts host ON host.id = follow.host_id WHERE follow.attendee_id = ? AND host.slug = ? LIMIT 1").bind(identity.attendeeId, hostSlug).first<{ following: number }>() : null,
  ]);
  return Response.json({ member: true, keepPosted: Boolean(eventPreference?.keepPosted), followingHost: Boolean(hostFollow?.following) }, { headers: { "cache-control": "no-store, private" } });
}

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Your first verified ticket unlocks this feature." }, { status: 401 });
  const body = await request.json() as { eventSlug?: string; keepPosted?: boolean; hostSlug?: string; followingHost?: boolean };
  const now = new Date().toISOString();

  if (body.eventSlug && typeof body.keepPosted === "boolean") {
    const eventSlug = body.eventSlug.trim();
    if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return Response.json({ error: "Event not found." }, { status: 404 });
    const eventRecord = await env.DB.prepare("SELECT 1 AS found FROM curated_event_records WHERE slug = ? AND status IN ('published', 'scheduled') LIMIT 1").bind(eventSlug).first<{ found: number }>();
    if (!eventRecord) return Response.json({ error: "Event not found." }, { status: 404 });
    await env.DB.prepare(`
      INSERT INTO attendee_event_preferences (attendee_id, event_slug, attendee_visible, keep_posted, updated_at)
      VALUES (?, ?, false, ?, ?)
      ON CONFLICT(attendee_id, event_slug) DO UPDATE SET keep_posted = excluded.keep_posted, updated_at = excluded.updated_at
    `).bind(identity.attendeeId, eventSlug, body.keepPosted, now).run();
    return Response.json({ keepPosted: body.keepPosted });
  }

  if (body.hostSlug && typeof body.followingHost === "boolean") {
    const hostSlug = body.hostSlug.trim();
    if (!/^[a-z0-9-]{1,80}$/u.test(hostSlug)) return Response.json({ error: "Host not found." }, { status: 404 });
    const host = await env.DB.prepare("SELECT id FROM hosts WHERE slug = ? LIMIT 1").bind(hostSlug).first<{ id: string }>();
    if (!host) return Response.json({ error: "Host not found." }, { status: 404 });
    if (body.followingHost) {
      await env.DB.prepare("INSERT INTO attendee_host_follows (attendee_id, host_id, created_at) VALUES (?, ?, ?) ON CONFLICT(attendee_id, host_id) DO NOTHING").bind(identity.attendeeId, host.id, now).run();
    } else {
      await env.DB.prepare("DELETE FROM attendee_host_follows WHERE attendee_id = ? AND host_id = ?").bind(identity.attendeeId, host.id).run();
    }
    return Response.json({ followingHost: body.followingHost });
  }

  return Response.json({ error: "Choose an event or Host preference to update." }, { status: 400 });
}
