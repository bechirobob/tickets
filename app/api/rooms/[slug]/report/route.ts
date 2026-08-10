import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";

const REASONS = new Set(["harassment", "spam", "impersonation", "unsafe", "other"]);

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json() as { messageId?: string; reason?: string; details?: string };
  const messageId = body.messageId?.trim() ?? "";
  const reason = body.reason?.trim() ?? "";
  const details = body.details?.trim().slice(0, 500) || null;
  if (!/^[0-9a-f-]{36}$/iu.test(messageId) || !REASONS.has(reason)) {
    return Response.json({ error: "Choose a valid report reason." }, { status: 400 });
  }
  const { env } = await import("cloudflare:workers");
  const access = await readAttendeeRoomAccess(env.DB, request.headers.get("cookie"), slug);
  if (!access) return Response.json({ error: "Ticket access required." }, { status: 401 });
  const room = env.THE_ROOM.getByName(slug);
  if (!(await room.hasMessage(messageId))) {
    return Response.json({ error: "That message is no longer available." }, { status: 404 });
  }
  await env.DB.prepare(`
    INSERT INTO room_reports (id, event_slug, reporter_attendee_id, message_id, reason, details, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).bind(crypto.randomUUID(), slug, access.attendeeId, messageId, reason, details, new Date().toISOString()).run();
  return Response.json({ reported: true }, { headers: { "cache-control": "no-store" } });
}
