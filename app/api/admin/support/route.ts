import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { sendSupportUpdateEmail } from "../../../../lib/email-delivery";
import { notifyAttendee } from "../../../../lib/notifications";

async function access(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "support.manage") ? session : null };
}

export async function GET(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: "Customer operations access is required." }, { status: 403 });
  const rows = await env.DB.prepare(`
    SELECT support.id, support.attendee_id AS attendeeId, support.event_slug AS eventSlug,
      event.title AS eventTitle, support.order_id AS orderId, orders.reference,
      profile.display_name AS displayName, profile.normalized_email AS email,
      support.kind, support.subject, support.status, support.created_at AS createdAt, support.updated_at AS updatedAt,
      message.id AS messageId, message.author_type AS authorType, message.body, message.created_at AS messageCreatedAt
    FROM support_cases support JOIN attendee_profiles profile ON profile.id = support.attendee_id
    JOIN curated_event_records event ON event.slug = support.event_slug
    LEFT JOIN orders ON orders.id = support.order_id
    LEFT JOIN support_messages message ON message.case_id = support.id
    ORDER BY CASE support.status WHEN 'waiting_support' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
      support.updated_at DESC, message.created_at
    LIMIT 600
  `).all<Record<string, unknown>>();
  const cases = new Map<string, Record<string, unknown> & { messages: Array<Record<string, unknown>> }>();
  for (const row of rows.results) {
    const id = String(row.id);
    const item = cases.get(id) ?? { id, attendeeId: row.attendeeId, eventSlug: row.eventSlug, eventTitle: row.eventTitle, orderId: row.orderId, reference: row.reference, displayName: row.displayName, email: row.email, kind: row.kind, subject: row.subject, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, messages: [] };
    if (row.messageId) item.messages.push({ id: row.messageId, authorType: row.authorType, body: row.body, createdAt: row.messageCreatedAt });
    cases.set(id, item);
  }
  return Response.json({ cases: [...cases.values()] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: "Customer operations access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This support action was not accepted." }, { status: 403 });
  const body = await request.json() as { caseId?: string; action?: string; message?: string; status?: string };
  const support = await env.DB.prepare(`
    SELECT support.id, support.attendee_id AS attendeeId, support.event_slug AS eventSlug,
      support.subject, profile.normalized_email AS email
    FROM support_cases support JOIN attendee_profiles profile ON profile.id = support.attendee_id
    WHERE support.id = ? LIMIT 1
  `).bind(body.caseId ?? "").first<{ id: string; attendeeId: string; eventSlug: string; subject: string; email: string }>();
  if (!support) return Response.json({ error: "Support case not found." }, { status: 404 });
  const now = new Date().toISOString();
  if (body.action === "reply") {
    const message = body.message?.trim().slice(0, 1200) ?? "";
    if (message.length < 2) return Response.json({ error: "Write a useful reply." }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES (?, ?, 'staff', ?, ?, ?)`)
        .bind(crypto.randomUUID(), support.id, session.accountId, message, now),
      env.DB.prepare("UPDATE support_cases SET status = 'waiting_customer', updated_at = ? WHERE id = ?").bind(now, support.id),
    ]);
    await Promise.all([
      notifyAttendee(env, support.attendeeId, { eventSlug: support.eventSlug, kind: "support_update", title: "Ticket support replied", body: message.slice(0, 140), url: `/my-nights/${encodeURIComponent(support.eventSlug)}?view=purchase`, sourceId: `support-${support.id}-${now}` }),
      sendSupportUpdateEmail({ db: env.DB, caseId: support.id, recipient: support.email, subject: support.subject, body: message, url: `${new URL(request.url).origin}/my-nights/${encodeURIComponent(support.eventSlug)}?view=purchase` }),
    ]);
    await recordAudit(env.DB, { session, action: "support.replied", targetType: "support_case", targetId: support.id, outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ saved: true });
  }
  if (body.action === "status") {
    const status = body.status ?? "";
    if (!["open", "waiting_customer", "waiting_support", "resolved", "closed"].includes(status)) return Response.json({ error: "Choose a valid support status." }, { status: 400 });
    await env.DB.prepare("UPDATE support_cases SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, support.id).run();
    await recordAudit(env.DB, { session, action: "support.status_updated", targetType: "support_case", targetId: support.id, outcome: "success", detail: status, requestId: requestMetadata(request).requestId });
    return Response.json({ saved: true });
  }
  return Response.json({ error: "Choose a valid support action." }, { status: 400 });
}
