import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { hashGateToken, normalizeGateToken } from "../../../../lib/gate-pass";

type TicketAtGate = {
  ticketId: string;
  eventSlug: string;
  ticketType: string;
  status: string;
  checkedInAt: string | null;
  checkedInGate: string | null;
  attendeeName: string | null;
};

async function requireGateAdmin(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "gate.scan") ? session : null };
}

async function findTicket(db: D1Database, tokenHash: string) {
  return db.prepare(`
    SELECT t.id AS ticketId, t.event_slug AS eventSlug, t.ticket_type AS ticketType,
           t.status, t.checked_in_at AS checkedInAt, t.checked_in_gate AS checkedInGate,
           COALESCE(p.display_name, o.customer_name, 'Guest') AS attendeeName
    FROM tickets t
    JOIN orders o ON o.id = t.order_id
    LEFT JOIN ticket_assignments a ON a.ticket_id = t.id AND a.status = 'active'
    LEFT JOIN attendee_profiles p ON p.id = a.attendee_id
    WHERE t.qr_token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<TicketAtGate>();
}

export async function GET(request: Request) {
  const { env, session } = await requireGateAdmin(request);
  if (!session) {
    return Response.json({ error: "Gate staff access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const url = new URL(request.url);
  const eventSlug = url.searchParams.get("eventSlug")?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return Response.json({ error: "Choose an event." }, { status: 400 });
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const query = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query) {
    const like = `%${query.replaceAll("%", "").replaceAll("_", "")}%`;
    const matches = await env.DB.prepare(`
      SELECT t.id AS ticketId, t.ticket_type AS ticketType, t.status,
             t.checked_in_at AS checkedInAt, t.checked_in_gate AS checkedInGate,
             o.reference, o.customer_name AS customerName, o.customer_email AS customerEmail,
             o.customer_phone AS customerPhone,
             COALESCE(profile.display_name, o.customer_name, 'Guest') AS attendeeName
      FROM tickets t JOIN orders o ON o.id = t.order_id
      LEFT JOIN ticket_assignments assignment ON assignment.ticket_id = t.id AND assignment.status = 'active'
      LEFT JOIN attendee_profiles profile ON profile.id = assignment.attendee_id
      WHERE t.event_slug = ? AND (o.reference LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ? OR profile.display_name LIKE ?)
      ORDER BY o.paid_at DESC, t.admission_number LIMIT 20
    `).bind(eventSlug, like, like, like, like, like).all();
    return Response.json({ matches: matches.results, canUndo: hasPermission(session, "gate.undo") }, { headers: { "cache-control": "no-store" } });
  }
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS issued,
           SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checkedIn
    FROM tickets WHERE event_slug = ? AND status IN ('issued', 'checked_in')
  `).bind(eventSlug).first<{ issued: number; checkedIn: number | null }>();
  const tiers = await env.DB.prepare(`
    SELECT ticket_type AS ticketType, COUNT(*) AS issued,
           SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checkedIn
    FROM tickets WHERE event_slug = ? AND status IN ('issued', 'checked_in')
    GROUP BY ticket_type ORDER BY ticket_type
  `).bind(eventSlug).all<{ ticketType: string; issued: number; checkedIn: number | null }>();
  if (url.searchParams.get("manifest") === "1") {
    const manifest = await env.DB.prepare(`
      SELECT t.id AS ticketId, t.qr_token_hash AS tokenHash, t.ticket_type AS ticketType, t.status,
             COALESCE(profile.display_name, o.customer_name, 'Guest') AS attendeeName
      FROM tickets t JOIN orders o ON o.id = t.order_id
      LEFT JOIN ticket_assignments assignment ON assignment.ticket_id = t.id AND assignment.status = 'active'
      LEFT JOIN attendee_profiles profile ON profile.id = assignment.attendee_id
      WHERE t.event_slug = ? AND t.status IN ('issued', 'checked_in') LIMIT 10000
    `).bind(eventSlug).all();
    return Response.json({ issued: stats?.issued ?? 0, checkedIn: stats?.checkedIn ?? 0, tiers: tiers.results, canUndo: hasPermission(session, "gate.undo"), manifest: manifest.results, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({ issued: stats?.issued ?? 0, checkedIn: stats?.checkedIn ?? 0, tiers: tiers.results, canUndo: hasPermission(session, "gate.undo") }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env, session } = await requireGateAdmin(request);
  if (!session) {
    return Response.json({ error: "Gate staff access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This scan request was not accepted." }, { status: 403 });
  const body = await request.json() as { code?: string; eventSlug?: string; gate?: string; deviceId?: string; clientScanId?: string };
  const token = normalizeGateToken(body.code ?? "");
  const eventSlug = body.eventSlug?.trim() ?? "";
  const gate = (body.gate?.trim() || "Main gate").slice(0, 50);
  const deviceId = body.deviceId?.trim().slice(0, 100) || null;
  const clientScanId = body.clientScanId?.trim().slice(0, 100) || null;
  if (!token || !/^[a-z0-9-]{1,80}$/u.test(eventSlug)) {
    return Response.json({ error: "That QR or ticket code is not valid." }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  if (clientScanId) {
    const replay = await env.DB.prepare(`
      SELECT ticket.id AS ticketId, ticket.event_slug AS eventSlug, ticket.ticket_type AS ticketType,
             ticket.status, ticket.checked_in_at AS checkedInAt, ticket.checked_in_gate AS checkedInGate
      FROM gate_checkin_events event JOIN tickets ticket ON ticket.id = event.ticket_id
      WHERE event.client_scan_id = ? AND event.action = 'check_in' LIMIT 1
    `).bind(clientScanId).first();
    if (replay) return Response.json({ result: "valid", ticket: replay, replayed: true, message: "Offline entry synchronized." }, { headers: { "cache-control": "no-store" } });
  }
  const tokenHash = await hashGateToken(token);
  const ticket = await findTicket(env.DB, tokenHash);
  if (!ticket) return Response.json({ result: "invalid", error: "Ticket not recognised. No entry was recorded." }, { status: 404, headers: { "cache-control": "no-store" } });
  if (ticket.eventSlug !== eventSlug) {
    return Response.json({ result: "wrong_event", ticket: { ...ticket, attendeeName: undefined }, error: "This ticket belongs to a different event. No entry was recorded." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  if (ticket.status === "checked_in") {
    return Response.json({ result: "duplicate", ticket, error: "This ticket has already been admitted." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  if (ticket.status !== "issued") {
    return Response.json({ result: "invalid", error: "This ticket is no longer valid for entry." }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const checkedInAt = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE tickets SET status = 'checked_in', checked_in_at = ?, checked_in_by = ?, checked_in_gate = ?
    WHERE id = ? AND status = 'issued' AND qr_token_hash = ?
  `).bind(checkedInAt, `${session.actor} <${session.email}>`, gate, ticket.ticketId, tokenHash).run();
  if (result.meta.changes !== 1) {
    const current = await findTicket(env.DB, tokenHash);
    return Response.json({ result: "duplicate", ticket: current, error: "This ticket was admitted by another gate." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  await recordAudit(env.DB, { session, action: "gate.ticket_checked_in", targetType: "ticket", targetId: ticket.ticketId, outcome: "success", detail: `${eventSlug}:${gate}`, requestId: requestMetadata(request).requestId });
  await env.DB.prepare(`
    INSERT INTO gate_checkin_events (id, ticket_id, event_slug, action, gate, actor_account_id, actor_email, device_id, client_scan_id, created_at)
    VALUES (?, ?, ?, 'check_in', ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), ticket.ticketId, eventSlug, gate, session.accountId, session.email, deviceId, clientScanId, checkedInAt).run();
  return Response.json({ result: "valid", ticket: { ...ticket, status: "checked_in", checkedInAt, checkedInGate: gate } }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "gate.undo")) return Response.json({ error: "Supervisor access required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This undo request was not accepted." }, { status: 403 });
  const body = await request.json() as { ticketId?: string; eventSlug?: string; gate?: string; reason?: string };
  const ticketId = body.ticketId?.trim() ?? "";
  const eventSlug = body.eventSlug?.trim() ?? "";
  if (!(await hasEventAssignment(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
  const result = await env.DB.prepare(`UPDATE tickets SET status = 'issued', checked_in_at = NULL, checked_in_by = NULL, checked_in_gate = NULL WHERE id = ? AND event_slug = ? AND status = 'checked_in'`)
    .bind(ticketId, eventSlug).run();
  if (result.meta.changes !== 1) return Response.json({ error: "This ticket is not currently checked in." }, { status: 409 });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO gate_checkin_events (id, ticket_id, event_slug, action, gate, actor_account_id, actor_email, created_at) VALUES (?, ?, ?, 'undo', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), ticketId, eventSlug, (body.gate?.trim() || "Supervisor").slice(0, 50), session.accountId, session.email, now).run();
  await recordAudit(env.DB, { session, action: "gate.ticket_checkin_undone", targetType: "ticket", targetId: ticketId, outcome: "success", detail: `${eventSlug}:${(body.reason?.trim() || "supervisor correction").slice(0, 300)}`, requestId: requestMetadata(request).requestId });
  return Response.json({ undone: true }, { headers: { "cache-control": "no-store" } });
}
