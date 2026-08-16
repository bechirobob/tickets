import { readAttendeeIdentity } from "../../../../../lib/attendee-auth";
import { gateQrPayload } from "../../../../../lib/gate-pass";
import { googleWalletUrl } from "../../../../../lib/wallet-passes";

type WalletTicket = {
  id: string;
  ticketType: string;
  holder: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  area: string;
  gateToken: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ ticketId: string }> },
) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(
    env.DB,
    request.headers.get("cookie"),
  );
  if (!identity)
    return Response.json(
      { error: "Verified attendee access required." },
      { status: 401 },
    );
  const { ticketId } = await context.params;
  const ticket = await env.DB.prepare(
    `SELECT ticket.id, ticket.ticket_type AS ticketType, attendee.display_name AS holder, event.title, event.starts_at AS startsAt, event.ends_at AS endsAt, event.venue, event.area, credential.token AS gateToken FROM ticket_assignments assignment JOIN tickets ticket ON ticket.id = assignment.ticket_id JOIN attendee_accounts attendee ON attendee.id = assignment.attendee_id JOIN curated_event_records event ON event.slug = ticket.event_slug JOIN ticket_gate_credentials credential ON credential.ticket_id = ticket.id WHERE ticket.id = ? AND assignment.attendee_id = ? AND assignment.status = 'active' AND ticket.status = 'issued' AND event.event_state IN ('on_sale','rescheduled') LIMIT 1`,
  )
    .bind(ticketId, identity.attendeeId)
    .first<WalletTicket>();
  if (!ticket)
    return Response.json(
      { error: "This pass is not available." },
      { status: 404 },
    );
  const platform = new URL(request.url).searchParams.get("platform");
  if (
    platform === "google" &&
    env.GOOGLE_WALLET_ISSUER_ID &&
    env.GOOGLE_WALLET_CLASS_ID &&
    env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL &&
    env.GOOGLE_WALLET_PRIVATE_KEY
  ) {
    const location = await googleWalletUrl(
      {
        issuerId: env.GOOGLE_WALLET_ISSUER_ID,
        classId: env.GOOGLE_WALLET_CLASS_ID,
        email: env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
        privateKey: env.GOOGLE_WALLET_PRIVATE_KEY,
        origin: new URL(request.url).origin,
      },
      { ...ticket, qrPayload: gateQrPayload(ticket.gateToken) },
    );
    return Response.redirect(location, 302);
  }
  if (
    platform === "apple" &&
    env.APPLE_WALLET_SIGNER_URL &&
    env.APPLE_WALLET_SIGNER_TOKEN
  ) {
    const response = await fetch(env.APPLE_WALLET_SIGNER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.APPLE_WALLET_SIGNER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...ticket,
        qrPayload: gateQrPayload(ticket.gateToken),
      }),
    });
    if (!response.ok)
      return Response.json(
        { error: "Apple Wallet could not prepare this pass." },
        { status: 502 },
      );
    return new Response(response.body, {
      headers: {
        "content-type": "application/vnd.apple.pkpass",
        "content-disposition": `attachment; filename="${ticket.id}.pkpass"`,
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(
    { error: "That Wallet provider is not configured yet." },
    { status: 503 },
  );
}
