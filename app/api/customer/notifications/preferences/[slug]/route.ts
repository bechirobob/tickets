import { readAttendeeRoomAccess } from "../../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../../lib/admin-session";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const { env } = await import("cloudflare:workers");
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401 });
  const row = await env.DB.prepare(`
    SELECT room_messages AS roomMessages, host_updates AS hostUpdates, muted_until AS mutedUntil
    FROM notification_preferences WHERE attendee_id = ? AND event_slug = ? LIMIT 1
  `).bind(access.attendeeId, slug).first<{ roomMessages: number; hostUpdates: number; mutedUntil: string | null }>();
  return Response.json({ roomMessages: row ? Boolean(row.roomMessages) : true, hostUpdates: row ? Boolean(row.hostUpdates) : true, mutedUntil: row?.mutedUntil ?? null }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request, context: Context) {
  const { slug } = await context.params;
  const { env } = await import("cloudflare:workers");
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return Response.json({ error: "A valid ticket is required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This notification request was not accepted." }, { status: 403 });
  const body = await request.json() as { roomMessages?: boolean; mute?: "off" | "1h" | "tonight" };
  const current = await env.DB.prepare(`SELECT room_messages AS roomMessages FROM notification_preferences WHERE attendee_id = ? AND event_slug = ?`)
    .bind(access.attendeeId, slug).first<{ roomMessages: number }>();
  const roomMessages = typeof body.roomMessages === "boolean" ? body.roomMessages : current ? Boolean(current.roomMessages) : true;
  let mutedUntil: string | null = null;
  if (body.mute === "1h") mutedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (body.mute === "tonight") mutedUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO notification_preferences (attendee_id, event_slug, room_messages, host_updates, muted_until, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(attendee_id, event_slug) DO UPDATE SET room_messages = excluded.room_messages,
      muted_until = excluded.muted_until, updated_at = excluded.updated_at
  `).bind(access.attendeeId, slug, roomMessages ? 1 : 0, mutedUntil, now).run();
  return Response.json({ roomMessages, mutedUntil }, { headers: { "cache-control": "no-store" } });
}
