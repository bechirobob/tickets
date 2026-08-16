import { readAttendeeRoomAccess } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin, recordSecurityEvent, requestMetadata } from "../../../../../lib/admin-session";
import { enforceRateLimit } from "../../../../../lib/security-controls";

const REASONS = new Set(["harassment", "spam", "impersonation", "unsafe", "other"]);

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This report was not accepted." }, { status: 403 });
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
  if (!(await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `room-report:${slug}:${access.attendeeId}`))) {
    await recordSecurityEvent(env.DB, {
      kind: "rate_limited", subject: access.attendeeId, path: new URL(request.url).pathname,
      requestId: requestMetadata(request).requestId, detail: "room_report_rate_limited",
    });
    return Response.json({ error: "Give the Room a moment before sending another report." }, { status: 429 });
  }
  const room = env.THE_ROOM.getByName(slug);
  if (!(await room.hasMessage(messageId))) {
    return Response.json({ error: "That message is no longer available." }, { status: 404 });
  }
  const inserted = await env.DB.prepare(`
    INSERT INTO room_reports (id, event_slug, reporter_attendee_id, message_id, reason, details, status, created_at)
    SELECT ?, ?, ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM room_reports
      WHERE event_slug = ? AND reporter_attendee_id = ? AND message_id = ? AND status = 'open'
    )
  `).bind(
    crypto.randomUUID(), slug, access.attendeeId, messageId, reason, details, new Date().toISOString(),
    slug, access.attendeeId, messageId,
  ).run();
  return Response.json({ reported: true, duplicate: inserted.meta.changes === 0 }, { headers: { "cache-control": "no-store" } });
}
