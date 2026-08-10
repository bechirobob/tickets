import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";

async function authorize(request: Request, slug: string) {
  const { env } = await import("cloudflare:workers");
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  return { env, access };
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json() as { attendeeId?: string };
  const blockedAttendeeId = body.attendeeId?.trim() ?? "";
  const { env, access } = await authorize(request, slug);
  if (!access) return Response.json({ error: "Ticket access required." }, { status: 401 });
  if (!blockedAttendeeId || blockedAttendeeId === access.attendeeId) {
    return Response.json({ error: "That attendee cannot be blocked." }, { status: 400 });
  }
  const target = await env.DB.prepare(`
    SELECT 1 AS found
    FROM ticket_assignments a JOIN tickets t ON t.id = a.ticket_id
    WHERE a.attendee_id = ? AND a.status = 'active' AND t.event_slug = ?
      AND t.status IN ('issued', 'checked_in')
    LIMIT 1
  `).bind(blockedAttendeeId, slug).first<{ found: number }>();
  if (!target) return Response.json({ error: "That attendee is not in this Room." }, { status: 404 });
  await env.DB.prepare(`
    INSERT INTO room_blocks (id, event_slug, blocker_attendee_id, blocked_attendee_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_slug, blocker_attendee_id, blocked_attendee_id) DO NOTHING
  `).bind(crypto.randomUUID(), slug, access.attendeeId, blockedAttendeeId, new Date().toISOString()).run();
  return Response.json({ blocked: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json() as { attendeeId?: string };
  const blockedAttendeeId = body.attendeeId?.trim() ?? "";
  const { env, access } = await authorize(request, slug);
  if (!access) return Response.json({ error: "Ticket access required." }, { status: 401 });
  await env.DB.prepare(`
    DELETE FROM room_blocks
    WHERE event_slug = ? AND blocker_attendee_id = ? AND blocked_attendee_id = ?
  `).bind(slug, access.attendeeId, blockedAttendeeId).run();
  return Response.json({ blocked: false });
}
