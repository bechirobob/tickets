import { readAdminSession } from "../../../../lib/admin-session";
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
  const session = await readAdminSession(request.headers.get("cookie"));
  return session;
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
  if (!(await requireGateAdmin(request))) {
    return Response.json({ error: "Gate staff access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const eventSlug = new URL(request.url).searchParams.get("eventSlug")?.trim() ?? "";
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug)) return Response.json({ error: "Choose an event." }, { status: 400 });
  const { env } = await import("cloudflare:workers");
  const stats = await env.DB.prepare(`
    SELECT COUNT(*) AS issued,
           SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checkedIn
    FROM tickets WHERE event_slug = ? AND status IN ('issued', 'checked_in')
  `).bind(eventSlug).first<{ issued: number; checkedIn: number | null }>();
  return Response.json({ issued: stats?.issued ?? 0, checkedIn: stats?.checkedIn ?? 0 }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireGateAdmin(request);
  if (!session) {
    return Response.json({ error: "Gate staff access required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const body = await request.json() as { code?: string; eventSlug?: string; gate?: string };
  const token = normalizeGateToken(body.code ?? "");
  const eventSlug = body.eventSlug?.trim() ?? "";
  const gate = (body.gate?.trim() || "Main gate").slice(0, 50);
  if (!token || !/^[a-z0-9-]{1,80}$/u.test(eventSlug)) {
    return Response.json({ error: "That QR or ticket code is not valid." }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const { env } = await import("cloudflare:workers");
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
  `).bind(checkedInAt, session.actor, gate, ticket.ticketId, tokenHash).run();
  if (result.meta.changes !== 1) {
    const current = await findTicket(env.DB, tokenHash);
    return Response.json({ result: "duplicate", ticket: current, error: "This ticket was admitted by another gate." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ result: "valid", ticket: { ...ticket, status: "checked_in", checkedInAt, checkedInGate: gate } }, { headers: { "cache-control": "no-store" } });
}
