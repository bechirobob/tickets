import {
  attendeeCookieHeader,
  attendeeSessionExpiry,
  createSecureToken,
  expiredAttendeeCookieHeader,
  hashToken,
  listAttendeeEvents,
  readAttendeeIdentity,
  readCookie,
} from "../../../../lib/attendee-auth";
import { deliverConfirmedOrder, verifyAndFulfill } from "../../../../lib/payment-operations";

type ClaimRecord = {
  orderId: string;
  eventSlug: string;
  customerEmail: string;
  customerPhone: string;
  customerName: string | null;
  orderStatus: string;
  expiresAt: string;
  claimedAt: string | null;
};

async function runtimeDb(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  return env.DB;
}

export async function POST(request: Request) {
  const body = await request.json() as { reference?: string; claim?: string };
  const reference = body.reference?.trim() ?? "";
  const claim = body.claim?.trim() ?? "";
  if (!reference || claim.length < 40 || claim.length > 128) {
    return Response.json({ error: "This ticket access link is invalid." }, { status: 400 });
  }

  const db = await runtimeDb();
  const claimHash = await hashToken(claim);
  const now = new Date().toISOString();
  const findClaimRecord = () => db.prepare(`
    SELECT o.id AS orderId, o.event_slug AS eventSlug, o.customer_email AS customerEmail,
           o.customer_phone AS customerPhone, o.customer_name AS customerName, o.status AS orderStatus,
           g.expires_at AS expiresAt, g.claimed_at AS claimedAt
    FROM order_access_grants g
    JOIN orders o ON o.id = g.order_id
    WHERE o.reference = ? AND g.token_hash = ?
    LIMIT 1
  `).bind(reference, claimHash).first<ClaimRecord>();
  let record = await findClaimRecord();

  if (!record || record.expiresAt <= now || record.claimedAt) {
    return Response.json({ error: "This ticket access link is invalid or has already been used." }, { status: 401 });
  }
  if (record.orderStatus === "payment_pending") {
    const { env } = await import("cloudflare:workers");
    if (env.PAYSTACK_SECRET_KEY) {
      try {
        const verified = await verifyAndFulfill(db, reference, env.PAYSTACK_SECRET_KEY);
        if (verified.result === "paid") {
          await deliverConfirmedOrder(db, verified.order, new URL(request.url).origin);
          record = await findClaimRecord();
        }
      } catch (error) {
        console.error(JSON.stringify({ message: "payment return verification failed", reference, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    if (!record || record.orderStatus === "payment_pending") {
      return Response.json({ pending: true }, { status: 202, headers: { "cache-control": "no-store" } });
    }
  }
  if (record.orderStatus !== "paid") {
    return Response.json({ error: "This order does not have an active paid ticket." }, { status: 409 });
  }

  const issued = await db.prepare(`
    SELECT id FROM tickets
    WHERE order_id = ? AND status IN ('issued', 'checked_in', 'voided')
    ORDER BY issued_at, id
  `).bind(record.orderId).all<{ id: string }>();
  if (!issued.results.length) {
    return Response.json({ pending: true }, { status: 202, headers: { "cache-control": "no-store" } });
  }

  const normalizedEmail = record.customerEmail.trim().toLowerCase();
  const attendeeId = `att_${(await hashToken(normalizedEmail)).slice(0, 32)}`;
  const fallbackName = normalizedEmail.split("@")[0]?.replace(/[._-]+/gu, " ").slice(0, 40) || "Guest";
  const displayName = (record.customerName?.trim() || fallbackName).slice(0, 50);
  const sessionToken = createSecureToken();
  const sessionId = crypto.randomUUID();
  const sessionHash = await hashToken(sessionToken);
  const ownsClaim = `
    EXISTS (
      SELECT 1 FROM order_access_grants
      WHERE order_id = ? AND claimed_session_id = ?
    )
  `;
  const statements = [
    db.prepare(`
      UPDATE order_access_grants
      SET claimed_at = ?, claimed_session_id = ?
      WHERE order_id = ? AND claimed_at IS NULL
    `).bind(now, sessionId, record.orderId),
    db.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'active', ?, ?
      WHERE ${ownsClaim}
      ON CONFLICT(normalized_email) DO UPDATE SET
        phone = excluded.phone,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).bind(attendeeId, normalizedEmail, record.customerPhone, displayName, now, now, record.orderId, sessionId),
    ...issued.results.map((ticket) => db.prepare(`
      INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
      SELECT ?, ?, ?, 'active', ?
      WHERE ${ownsClaim}
      ON CONFLICT(ticket_id) DO NOTHING
    `).bind(ticket.id, attendeeId, `order:${record.orderId}`, now, record.orderId, sessionId)),
    db.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ${ownsClaim}
    `).bind(sessionId, attendeeId, sessionHash, attendeeSessionExpiry(), now, now, record.orderId, sessionId),
  ];
  const [claimResult] = await db.batch(statements);
  if (claimResult.meta.changes !== 1) {
    return Response.json(
      { error: "This ticket access link has already been used." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(
    { signedIn: true, eventSlug: record.eventSlug },
    { headers: { "cache-control": "no-store", "set-cookie": attendeeCookieHeader(sessionToken) } },
  );
}

export async function GET(request: Request) {
  const db = await runtimeDb();
  const identity = await readAttendeeIdentity(db, request.headers.get("cookie"));
  if (!identity) {
    return Response.json({ signedIn: false }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const events = await listAttendeeEvents(db, identity.attendeeId);
  return Response.json({ signedIn: true, attendee: identity, events }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const token = readCookie(request.headers.get("cookie"));
  if (token) {
    const db = await runtimeDb();
    await db.prepare("UPDATE attendee_sessions SET revoked_at = ? WHERE token_hash = ?")
      .bind(new Date().toISOString(), await hashToken(token)).run();
  }
  return Response.json(
    { signedOut: true },
    { headers: { "cache-control": "no-store", "set-cookie": expiredAttendeeCookieHeader() } },
  );
}
