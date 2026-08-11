import { readAttendeeNightAccess } from "../../../../../lib/attendee-auth";
import { mutationHasValidOrigin } from "../../../../../lib/admin-session";

async function context(request: Request, slug: string) {
  const { env } = await import("cloudflare:workers");
  const attendee = await readAttendeeNightAccess(env.DB, request.headers.get("cookie"), slug);
  return { env, attendee };
}

export async function GET(request: Request, route: { params: Promise<{ slug: string }> }) {
  const { slug } = await route.params;
  const { env, attendee } = await context(request, slug);
  if (!attendee) return Response.json({ error: "This Night is not attached to your verified tickets." }, { status: 401 });
  const [event, orders, cases, decision] = await Promise.all([
    env.DB.prepare(`SELECT event_state AS eventState, rescheduled_from AS rescheduledFrom, starts_at AS startsAt FROM curated_event_records WHERE slug = ? LIMIT 1`).bind(slug).first(),
    env.DB.prepare(`
      SELECT DISTINCT orders.id, orders.reference, orders.status, orders.refund_status AS refundStatus,
        orders.customer_email = ? AS canRequestRefund,
        (SELECT COUNT(*) FROM tickets checked WHERE checked.order_id = orders.id AND checked.status = 'checked_in') AS checkedInCount
      FROM orders JOIN tickets ticket ON ticket.order_id = orders.id
      JOIN ticket_assignments assignment ON assignment.ticket_id = ticket.id
      WHERE assignment.attendee_id = ? AND assignment.status = 'active' AND ticket.event_slug = ?
      ORDER BY orders.created_at DESC
    `).bind(attendee.normalizedEmail, attendee.attendeeId, slug).all(),
    env.DB.prepare(`
      SELECT support.id, support.order_id AS orderId, support.kind, support.subject, support.status,
        support.created_at AS createdAt, support.updated_at AS updatedAt,
        message.id AS messageId, message.author_type AS authorType, message.body, message.created_at AS messageCreatedAt
      FROM support_cases support LEFT JOIN support_messages message ON message.case_id = support.id
      WHERE support.attendee_id = ? AND support.event_slug = ?
      ORDER BY support.updated_at DESC, message.created_at
    `).bind(attendee.attendeeId, slug).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT decision, decided_at AS decidedAt FROM attendee_event_decisions WHERE attendee_id = ? AND event_slug = ? LIMIT 1").bind(attendee.attendeeId, slug).first(),
  ]);
  const caseMap = new Map<string, Record<string, unknown> & { messages: Array<Record<string, unknown>> }>();
  for (const row of cases.results) {
    const id = String(row.id);
    const item = caseMap.get(id) ?? { id, orderId: row.orderId, kind: row.kind, subject: row.subject, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, messages: [] };
    if (row.messageId) item.messages.push({ id: row.messageId, authorType: row.authorType, body: row.body, createdAt: row.messageCreatedAt });
    caseMap.set(id, item);
  }
  return Response.json({ event, orders: orders.results, cases: [...caseMap.values()], decision }, { headers: { "cache-control": "no-store, private" } });
}

export async function POST(request: Request, route: { params: Promise<{ slug: string }> }) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This support request was not accepted." }, { status: 403 });
  const { slug } = await route.params;
  const { env, attendee } = await context(request, slug);
  if (!attendee) return Response.json({ error: "This Night is not attached to your verified tickets." }, { status: 401 });
  const body = await request.json() as { action?: string; orderId?: string; caseId?: string; kind?: string; subject?: string; message?: string };
  const now = new Date().toISOString();
  if (body.action === "accept_reschedule") {
    const event = await env.DB.prepare("SELECT event_state AS eventState FROM curated_event_records WHERE slug = ? LIMIT 1").bind(slug).first<{ eventState: string }>();
    if (event?.eventState !== "rescheduled") return Response.json({ error: "This Night does not need a new-date decision." }, { status: 409 });
    await env.DB.prepare(`INSERT INTO attendee_event_decisions (attendee_id, event_slug, decision, decided_at) VALUES (?, ?, 'accepted_reschedule', ?)
      ON CONFLICT(attendee_id, event_slug) DO UPDATE SET decision = 'accepted_reschedule', decided_at = excluded.decided_at`).bind(attendee.attendeeId, slug, now).run();
    return Response.json({ saved: true });
  }
  if (body.action === "request_refund") {
    const order = await env.DB.prepare(`
      SELECT orders.id FROM orders JOIN tickets ticket ON ticket.order_id = orders.id
      JOIN ticket_assignments assignment ON assignment.ticket_id = ticket.id
      JOIN curated_event_records event ON event.slug = ticket.event_slug
      WHERE orders.id = ? AND orders.customer_email = ? AND assignment.attendee_id = ? AND assignment.status = 'active'
        AND event.slug = ? AND event.event_state IN ('cancelled', 'postponed', 'rescheduled')
        AND orders.status = 'paid' AND NOT EXISTS (SELECT 1 FROM tickets used WHERE used.order_id = orders.id AND used.status = 'checked_in') LIMIT 1
    `).bind(body.orderId ?? "", attendee.normalizedEmail, attendee.attendeeId, slug).first<{ id: string }>();
    if (!order) return Response.json({ error: "This order is not currently eligible for a refund request." }, { status: 409 });
    const existing = await env.DB.prepare("SELECT id FROM support_cases WHERE attendee_id = ? AND order_id = ? AND kind = 'refund' AND status NOT IN ('resolved', 'closed') LIMIT 1")
      .bind(attendee.attendeeId, order.id).first<{ id: string }>();
    if (existing) return Response.json({ saved: true, caseId: existing.id, duplicate: true });
    const caseId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO attendee_event_decisions (attendee_id, event_slug, decision, decided_at) VALUES (?, ?, 'refund_requested', ?)
        ON CONFLICT(attendee_id, event_slug) DO UPDATE SET decision = 'refund_requested', decided_at = excluded.decided_at`).bind(attendee.attendeeId, slug, now),
      env.DB.prepare(`INSERT INTO support_cases (id, attendee_id, event_slug, order_id, kind, subject, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'refund', 'Refund request', 'waiting_support', ?, ?)`).bind(caseId, attendee.attendeeId, slug, order.id, now, now),
      env.DB.prepare(`INSERT INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES (?, ?, 'system', ?, ?, ?)`)
        .bind(crypto.randomUUID(), caseId, attendee.attendeeId, "Refund requested from the purchased Night. Finance will review eligibility before any money moves.", now),
    ]);
    return Response.json({ saved: true, caseId }, { status: 201 });
  }
  if (body.action === "open_case") {
    const kind = ["general", "refund", "reschedule", "ticket", "entry"].includes(body.kind ?? "") ? body.kind! : "general";
    const subject = body.subject?.trim().slice(0, 120) ?? "";
    const message = body.message?.trim().slice(0, 1200) ?? "";
    if (!subject || message.length < 4) return Response.json({ error: "Add a short subject and message." }, { status: 400 });
    const requestedOrderId = body.orderId?.trim() ?? "";
    if (requestedOrderId) {
      const owned = await env.DB.prepare(`SELECT 1 AS owned FROM orders JOIN tickets ticket ON ticket.order_id = orders.id
        JOIN ticket_assignments assignment ON assignment.ticket_id = ticket.id
        WHERE orders.id = ? AND ticket.event_slug = ? AND assignment.attendee_id = ? AND assignment.status = 'active' LIMIT 1`)
        .bind(requestedOrderId, slug, attendee.attendeeId).first();
      if (!owned) return Response.json({ error: "That order is not attached to this Night." }, { status: 403 });
    }
    const caseId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_cases (id, attendee_id, event_slug, order_id, kind, subject, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting_support', ?, ?)`).bind(caseId, attendee.attendeeId, slug, requestedOrderId || null, kind, subject, now, now),
      env.DB.prepare(`INSERT INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES (?, ?, 'attendee', ?, ?, ?)`)
        .bind(crypto.randomUUID(), caseId, attendee.attendeeId, message, now),
    ]);
    return Response.json({ saved: true, caseId }, { status: 201 });
  }
  if (body.action === "reply") {
    const message = body.message?.trim().slice(0, 1200) ?? "";
    const support = await env.DB.prepare("SELECT id FROM support_cases WHERE id = ? AND attendee_id = ? AND event_slug = ? AND status NOT IN ('closed') LIMIT 1")
      .bind(body.caseId ?? "", attendee.attendeeId, slug).first<{ id: string }>();
    if (!support || message.length < 2) return Response.json({ error: "That conversation cannot take this reply." }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_messages (id, case_id, author_type, author_id, body, created_at) VALUES (?, ?, 'attendee', ?, ?, ?)`)
        .bind(crypto.randomUUID(), support.id, attendee.attendeeId, message, now),
      env.DB.prepare("UPDATE support_cases SET status = 'waiting_support', updated_at = ? WHERE id = ?").bind(now, support.id),
    ]);
    return Response.json({ saved: true });
  }
  return Response.json({ error: "Choose a valid support action." }, { status: 400 });
}
