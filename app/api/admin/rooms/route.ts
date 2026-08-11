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
  const flashReports = await env.DB.prepare(`
    SELECT report.id, report.flash_id AS flashId, report.event_slug AS eventSlug,
           report.reason, report.details, report.status, report.created_at AS createdAt,
           flash.status AS flashStatus, flash.attendee_id AS attendeeId,
           profile.display_name AS displayName
    FROM room_flash_reports report
    JOIN room_flashes flash ON flash.id = report.flash_id
    JOIN attendee_profiles profile ON profile.id = flash.attendee_id
    ORDER BY CASE report.status WHEN 'open' THEN 0 ELSE 1 END, report.created_at DESC
    LIMIT 100
  `).all<{ id: string; flashId: string; eventSlug: string; reason: string; details: string | null; status: string; createdAt: string; flashStatus: string; attendeeId: string; displayName: string }>();
  const scopedFlashReports = session.role === "owner" ? flashReports.results : (await Promise.all(flashReports.results.map(async (report) => await hasEventAssignment(env.DB, session, report.eventSlug) ? report : null))).filter((report): report is typeof flashReports.results[number] => Boolean(report));
  const eventRows = session.role === "owner"
    ? await env.DB.prepare("SELECT slug, title FROM curated_event_records ORDER BY starts_at DESC").all<{ slug: string; title: string }>()
    : await env.DB.prepare("SELECT event.slug, event.title FROM curated_event_records event JOIN staff_event_assignments assignment ON assignment.event_slug = event.slug WHERE assignment.account_id = ? ORDER BY event.starts_at DESC").bind(session.accountId).all<{ slug: string; title: string }>();
  const eventSlugs = eventRows.results.map((event) => event.slug);
  const [settings, memories, suspensions] = eventSlugs.length ? await Promise.all([
    env.DB.prepare(`SELECT event_slug AS eventSlug, emergency_read_only AS emergencyReadOnly,
      slow_mode_seconds AS slowModeSeconds, archived_at AS archivedAt, updated_at AS updatedAt
      FROM room_settings WHERE event_slug IN (${eventSlugs.map(() => "?").join(",")})`).bind(...eventSlugs).all(),
    env.DB.prepare(`SELECT id, event_slug AS eventSlug, title, body, image_url AS imageUrl,
      published_at AS publishedAt, published_by AS publishedBy
      FROM event_memories WHERE event_slug IN (${eventSlugs.map(() => "?").join(",")}) ORDER BY published_at DESC LIMIT 100`).bind(...eventSlugs).all(),
    env.DB.prepare(`SELECT suspension.event_slug AS eventSlug, suspension.attendee_id AS attendeeId,
      profile.display_name AS displayName, suspension.reason, suspension.suspended_at AS suspendedAt
      FROM room_suspensions suspension JOIN attendee_profiles profile ON profile.id = suspension.attendee_id
      WHERE suspension.event_slug IN (${eventSlugs.map(() => "?").join(",")}) AND suspension.restored_at IS NULL
      ORDER BY suspension.suspended_at DESC LIMIT 100`).bind(...eventSlugs).all(),
  ]) : [{ results: [] }, { results: [] }, { results: [] }];
  return Response.json({ reports: enriched, flashReports: scopedFlashReports, events: eventRows.results, settings: settings.results, memories: memories.results, suspensions: suspensions.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env, session } = await admin(request);
  if (!session) return Response.json({ error: "Administrator access required." }, { status: 401 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as { action?: string; eventSlug?: string; content?: string; pinned?: boolean; slowModeSeconds?: number; emergencyReadOnly?: boolean; archived?: boolean; title?: string; attendeeId?: string; reason?: string };
  const eventSlug = body.eventSlug?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return Response.json({ error: "Choose a valid event." }, { status: 400 });
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const policy = await resolveRoomPolicy(env.DB, eventSlug);
  if (!policy) return Response.json({ error: "Event not found." }, { status: 404 });
  const action = body.action ?? "announcement";
  const now = new Date().toISOString();
  if (action === "settings") {
    const slowModeSeconds = Number(body.slowModeSeconds ?? 0);
    if (![0, 5, 15, 30].includes(slowModeSeconds)) return Response.json({ error: "Choose a valid slow-mode interval." }, { status: 400 });
    await env.DB.prepare(`
      INSERT INTO room_settings (event_slug, emergency_read_only, slow_mode_seconds, archived_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_slug) DO UPDATE SET emergency_read_only = excluded.emergency_read_only,
        slow_mode_seconds = excluded.slow_mode_seconds, archived_at = excluded.archived_at,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).bind(eventSlug, Boolean(body.emergencyReadOnly), slowModeSeconds, body.archived ? now : null, now, session.actor).run();
    const nextPolicy = await resolveRoomPolicy(env.DB, eventSlug);
    if (nextPolicy) await env.THE_ROOM.getByName(eventSlug).updatePolicy(nextPolicy);
    await recordAudit(env.DB, { session, action: "room.settings_updated", targetType: "event", targetId: eventSlug, outcome: "success", detail: JSON.stringify({ slowModeSeconds, emergencyReadOnly: Boolean(body.emergencyReadOnly), archived: Boolean(body.archived) }), requestId: requestMetadata(request).requestId });
    return Response.json({ settings: nextPolicy });
  }
  if (action === "clear_pin") {
    const cleared = await env.THE_ROOM.getByName(eventSlug).clearPins();
    await env.DB.prepare(`INSERT INTO room_moderation_actions (id, event_slug, actor, action, note, created_at) VALUES (?, ?, ?, 'unpin', ?, ?)`)
      .bind(crypto.randomUUID(), eventSlug, session.actor, `${cleared} pin(s) cleared`, now).run();
    return Response.json({ cleared });
  }
  if (action === "memory") {
    const title = body.title?.trim().slice(0, 120) ?? "";
    const content = body.content?.trim().slice(0, 800) ?? "";
    if (!title || !content) return Response.json({ error: "Add a memory title and note." }, { status: 400 });
    const event = await env.DB.prepare("SELECT image_url AS imageUrl FROM curated_event_records WHERE slug = ? LIMIT 1").bind(eventSlug).first<{ imageUrl: string }>();
    await env.DB.prepare(`INSERT INTO event_memories (id, event_slug, title, body, image_url, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), eventSlug, title, content, event?.imageUrl ?? null, now, session.actor).run();
    await recordAudit(env.DB, { session, action: "room.memory_published", targetType: "event", targetId: eventSlug, outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ published: true });
  }
  if (action === "suspend" || action === "restore") {
    const attendeeId = body.attendeeId?.trim() ?? "";
    if (!attendeeId) return Response.json({ error: "Choose an attendee." }, { status: 400 });
    if (action === "suspend") {
      const reason = body.reason?.trim().slice(0, 500) || "Room moderation action";
      await env.DB.prepare(`INSERT INTO room_suspensions (event_slug, attendee_id, reason, suspended_at, suspended_by)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_slug, attendee_id) DO UPDATE SET reason = excluded.reason,
        suspended_at = excluded.suspended_at, suspended_by = excluded.suspended_by, restored_at = NULL, restored_by = NULL`)
        .bind(eventSlug, attendeeId, reason, now, session.actor).run();
      await env.THE_ROOM.getByName(eventSlug).suspendAttendee(attendeeId);
    } else {
      await env.DB.prepare("UPDATE room_suspensions SET restored_at = ?, restored_by = ? WHERE event_slug = ? AND attendee_id = ? AND restored_at IS NULL")
        .bind(now, session.actor, eventSlug, attendeeId).run();
    }
    await env.DB.prepare(`INSERT INTO room_moderation_actions (id, event_slug, actor, action, target_attendee_id, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), eventSlug, session.actor, action === "suspend" ? "suspend_attendee" : "restore_attendee", attendeeId, body.reason?.trim().slice(0, 500) || null, now).run();
    return Response.json({ updated: true });
  }
  const content = body.content?.trim() ?? "";
  if (!content || content.length > 500) return Response.json({ error: "Enter an announcement of 500 characters or fewer." }, { status: 400 });
  const message = await env.THE_ROOM.getByName(eventSlug).publishAnnouncement(session.actor, content, Boolean(body.pinned), policy);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO room_moderation_actions (id, event_slug, actor, action, message_id, note, created_at)
      VALUES (?, ?, ?, 'announcement', ?, ?, ?)
    `).bind(crypto.randomUUID(), eventSlug, session.actor, message.id, content, now),
    env.DB.prepare(`
      INSERT INTO event_updates (id, event_slug, title, body, pinned, published_at, published_by)
      VALUES (?, ?, 'Night Update', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), eventSlug, content, Boolean(body.pinned), now, session.actor),
  ]);
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
