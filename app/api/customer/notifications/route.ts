import { readAttendeeIdentity } from "../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../lib/admin-session";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  const rows = await env.DB.prepare(`
    SELECT id, event_slug AS eventSlug, kind, title, body, url,
           created_at AS createdAt, read_at AS readAt
    FROM attendee_notifications WHERE attendee_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).bind(identity.attendeeId).all();
  const unread = rows.results.filter((item) => !item.readAt).length;
  return Response.json({ notifications: rows.results, unread }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) return Response.json({ error: "Verified attendee access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification request was not accepted." }, { status: 403 });
  const body = await request.json() as { id?: string; all?: boolean };
  const now = new Date().toISOString();
  if (body.all) await env.DB.prepare("UPDATE attendee_notifications SET read_at = COALESCE(read_at, ?) WHERE attendee_id = ?").bind(now, identity.attendeeId).run();
  else if (body.id) await env.DB.prepare("UPDATE attendee_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND attendee_id = ?").bind(now, body.id, identity.attendeeId).run();
  else return Response.json({ error: "Choose a notification to mark as read." }, { status: 400 });
  return Response.json({ updated: true }, { headers: { "cache-control": "no-store" } });
}
