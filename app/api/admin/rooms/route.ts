import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { resolveRoomPolicy } from "../../../../lib/room-policy";

async function admin(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "rooms.moderate") ? session : null };
}

export async function GET(request: Request) {
  const { env, session } = await admin(request);
  if (!session) return Response.json({ error: "Administrator access required." }, { status: 401 });
  const reports = await env.DB.prepare(`
    SELECT id, event_slug AS eventSlug, reporter_attendee_id AS reporterAttendeeId,
           message_id AS messageId, reason, details, status, created_at AS createdAt
    FROM room_reports ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100
  `).all<{ id: string; eventSlug: string; reporterAttendeeId: string; messageId: string; reason: string; details: string | null; status: string; createdAt: string }>();
  const scopedReports = session.role === "owner" ? reports.results : (await Promise.all(reports.results.map(async (report) => await hasEventAssignment(env.DB, session, report.eventSlug) ? report : null))).filter((report): report is typeof reports.results[number] => Boolean(report));
  const enriched = await Promise.all(scopedReports.map(async (report) => ({
    ...report,
    message: await env.THE_ROOM.getByName(report.eventSlug).getMessage(report.messageId),
  })));
  const eventRows = session.role === "owner"
    ? await env.DB.prepare("SELECT slug, title FROM curated_event_records ORDER BY starts_at DESC").all<{ slug: string; title: string }>()
    : await env.DB.prepare("SELECT event.slug, event.title FROM curated_event_records event JOIN staff_event_assignments assignment ON assignment.event_slug = event.slug WHERE assignment.account_id = ? ORDER BY event.starts_at DESC").bind(session.accountId).all<{ slug: string; title: string }>();
  return Response.json({ reports: enriched, events: eventRows.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env, session } = await admin(request);
  if (!session) return Response.json({ error: "Administrator access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { eventSlug?: string; content?: string; pinned?: boolean };
  const eventSlug = body.eventSlug?.trim() ?? "";
  const content = body.content?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug) || !content || content.length > 500) {
    return Response.json({ error: "Enter an event and an announcement of 500 characters or fewer." }, { status: 400 });
  }
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const policy = await resolveRoomPolicy(env.DB, eventSlug);
  if (!policy) return Response.json({ error: "Event not found." }, { status: 404 });
  const message = await env.THE_ROOM.getByName(eventSlug).publishAnnouncement(session.actor, content, Boolean(body.pinned), policy);
  await env.DB.prepare(`
    INSERT INTO room_moderation_actions (id, event_slug, actor, action, message_id, note, created_at)
    VALUES (?, ?, ?, 'announcement', ?, ?, ?)
  `).bind(crypto.randomUUID(), eventSlug, session.actor, message.id, content, new Date().toISOString()).run();
  await recordAudit(env.DB, { session, action: "room.announcement", targetType: "event", targetId: eventSlug, outcome: "success", requestId: requestMetadata(request).requestId });
  return Response.json({ message });
}

export async function DELETE(request: Request) {
  const { env, session } = await admin(request);
  if (!session) return Response.json({ error: "Administrator access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { eventSlug?: string; messageId?: string; note?: string };
  const eventSlug = body.eventSlug?.trim() ?? "";
  const messageId = body.messageId?.trim() ?? "";
  if (!eventSlug || !messageId) return Response.json({ error: "Event and message are required." }, { status: 400 });
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const removed = await env.THE_ROOM.getByName(eventSlug).removeMessage(messageId);
  if (!removed) return Response.json({ error: "Message not found." }, { status: 404 });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO room_moderation_actions (id, event_slug, actor, action, message_id, note, created_at)
      VALUES (?, ?, ?, 'remove_message', ?, ?, ?)
    `).bind(crypto.randomUUID(), eventSlug, session.actor, messageId, body.note?.trim().slice(0, 500) || null, now),
    env.DB.prepare(`
      UPDATE room_reports SET status = 'actioned', resolved_at = ?, resolved_by = ?
      WHERE event_slug = ? AND message_id = ? AND status = 'open'
    `).bind(now, session.actor, eventSlug, messageId),
  ]);
  await recordAudit(env.DB, { session, action: "room.message_removed", targetType: "room_message", targetId: messageId, outcome: "success", detail: eventSlug, requestId: requestMetadata(request).requestId });
  return Response.json({ removed: true });
}
