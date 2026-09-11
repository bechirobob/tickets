import { appleWalletAuthenticationToken, appleWalletRequestAuthorized, appleWalletUpdatesConfigured, readAppleWalletPass, signAppleWalletPass } from "@/lib/apple-wallet-updates";
import { gateQrPayload } from "@/lib/gate-pass";

function validIdentifier(value: string, max = 180) {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9._:-]+$/u.test(value);
}

type UpdatedWalletTicket = {
  id: string;
  eventSlug: string;
  ticketType: string;
  holder: string | null;
  startsAt: string;
  endsAt: string;
  venue: string;
  area: string;
  title: string;
  gateToken: string;
  ticketStatus: string;
  assignmentStatus: string | null;
  eventState: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ passTypeIdentifier: string; serialNumber: string }> },
) {
  const { env } = await import("cloudflare:workers");
  if (!appleWalletUpdatesConfigured(env)) return new Response(null, { status: 404 });
  const { passTypeIdentifier, serialNumber } = await context.params;
  if (!validIdentifier(passTypeIdentifier) || !validIdentifier(serialNumber)) return new Response(null, { status: 400 });
  if (passTypeIdentifier !== env.APPLE_WALLET_PASS_TYPE_IDENTIFIER) return new Response(null, { status: 404 });
  const pass = await readAppleWalletPass(env, passTypeIdentifier, serialNumber);
  if (!pass) return new Response(null, { status: 404 });
  if (!(await appleWalletRequestAuthorized(env, serialNumber, request.headers.get("authorization")))) return new Response(null, { status: 401 });

  const ticket = await env.DB.prepare(`
    SELECT ticket.id,ticket.event_slug AS eventSlug,ticket.ticket_type AS ticketType,
      attendee.display_name AS holder,event.title,event.starts_at AS startsAt,event.ends_at AS endsAt,
      event.venue,event.area,credential.token AS gateToken,ticket.status AS ticketStatus,
      assignment.status AS assignmentStatus,event.event_state AS eventState
    FROM tickets ticket
    JOIN curated_event_records event ON event.slug=ticket.event_slug
    JOIN ticket_gate_credentials credential ON credential.ticket_id=ticket.id
    LEFT JOIN ticket_assignments assignment ON assignment.ticket_id=ticket.id AND assignment.attendee_id=?
    LEFT JOIN attendee_accounts attendee ON attendee.id=?
    WHERE ticket.id=? LIMIT 1
  `).bind(pass.attendeeId, pass.attendeeId, pass.ticketId).first<UpdatedWalletTicket>();
  if (!ticket) return new Response(null, { status: 404 });

  const active = ticket.assignmentStatus === "active"
    && ticket.ticketStatus === "issued"
    && ["on_sale", "rescheduled"].includes(ticket.eventState);
  const authenticationToken = await appleWalletAuthenticationToken(env, serialNumber);
  const response = await signAppleWalletPass(
    env,
    {
      id: ticket.id,
      eventSlug: ticket.eventSlug,
      ticketType: ticket.ticketType,
      holder: ticket.holder ?? "Ticket holder",
      title: ticket.title,
      startsAt: ticket.startsAt,
      endsAt: ticket.endsAt,
      venue: ticket.venue,
      area: ticket.area,
      qrPayload: active ? gateQrPayload(ticket.gateToken) : `becore-tickets:void:${serialNumber}`,
      status: active ? "issued" : "voided",
      eventState: ticket.eventState,
    },
    new URL(request.url).origin,
    pass.attendeeId,
    authenticationToken,
    serialNumber,
  );
  if (!response) return new Response(null, { status: 503 });
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "cache-control": "no-store",
    },
  });
}
