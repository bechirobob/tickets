import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST as claimAttendeeSession } from "../app/api/customer/session/route";
import { POST as preparePasses } from "../app/api/customer/tickets/route";
import { hashToken } from "../lib/attendee-auth";

describe("attendee ticket claims", () => {
  it("creates exactly one session when the same one-time claim races", async () => {
    const orderId = "order-race";
    const reference = "BCT-RACE-1";
    const claim = "a-secure-ticket-claim-token-with-more-than-forty-characters";
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor,
          total_amount_minor, currency, customer_email, customer_phone, customer_name,
          payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'after-dark-osu', 1, 12000, 0, 12000, 'GHS',
                  'guest@example.com', '233000000000', 'Guest', 'mobile_money:mtn',
                  'paid', ?, ?)
      `).bind(orderId, reference, now, now),
      env.DB.prepare(`
        INSERT INTO order_access_grants (order_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(orderId, await hashToken(claim), future, now),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at)
        VALUES ('ticket-race', ?, 'after-dark-osu', 'general', 'qr-race', 'issued', ?)
      `).bind(orderId, now),
    ]);

    const makeRequest = () => new Request("https://tickets.becoreops.com/api/customer/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, claim }),
    });
    const responses = await Promise.all([
      claimAttendeeSession(makeRequest()),
      claimAttendeeSession(makeRequest()),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const sessionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM attendee_sessions",
    ).first<{ count: number }>();
    expect(sessionCount?.count).toBe(1);
  });

  it("keeps a newly paid order isolated until the checkout email is verified", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `shared-${suffix}@example.com`;
    const existingOrderId = `existing-order-${suffix}`;
    const newOrderId = `new-order-${suffix}`;
    const existingTicketId = `existing-ticket-${suffix}`;
    const newTicketId = `new-ticket-${suffix}`;
    const existingAttendeeId = `existing-attendee-${suffix}`;
    const reference = `BCT-ISOLATE-${suffix}`;
    const claim = `secure-isolation-claim-${suffix}-with-more-than-forty-characters`;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor,
          total_amount_minor, currency, customer_email, customer_phone, customer_name,
          payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'after-dark-osu', 1, 12000, 0, 12000, 'GHS', ?,
          '233111111111', 'Original Buyer', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(existingOrderId, `BCT-EXISTING-${suffix}`, email, now, now),
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, quantity, face_amount_minor, booking_fee_minor,
          total_amount_minor, currency, customer_email, customer_phone, customer_name,
          payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'noir-room-labone', 1, 13000, 0, 13000, 'GHS', ?,
          '233222222222', 'Different Name', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(newOrderId, reference, email, now, now),
      env.DB.prepare(`
        INSERT INTO attendee_profiles (
          id, normalized_email, phone, display_name, email_verified_at, status, created_at, updated_at
        ) VALUES (?, ?, '233111111111', 'Original Buyer', ?, 'active', ?, ?)
      `).bind(existingAttendeeId, email, now, now, now),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'after-dark-osu', 'general', ?, 'issued', ?)
      `).bind(existingTicketId, existingOrderId, `qr-existing-${suffix}`, now),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'noir-room-labone', 'general', ?, 'issued', ?)
      `).bind(newTicketId, newOrderId, `qr-new-${suffix}`, now),
      env.DB.prepare(`
        INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
        VALUES (?, ?, 'verified-email', 'active', ?)
      `).bind(existingTicketId, existingAttendeeId, now),
      env.DB.prepare(`
        INSERT INTO order_access_grants (order_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(newOrderId, await hashToken(claim), future, now),
    ]);

    const claimed = await claimAttendeeSession(new Request("https://tickets.becoreops.com/api/customer/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, claim }),
    }));
    expect(claimed.status).toBe(200);
    const cookie = claimed.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^bct_attendee=/u);

    const walletResponse = await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST",
      headers: { cookie: cookie! },
    }));
    const wallet = await walletResponse.json() as {
      attendee: { displayName: string; emailVerified: boolean };
      orders: Array<{ orderId: string; bookedFor: string | null }>;
    };
    expect(wallet.attendee).toMatchObject({ displayName: "Different Name", emailVerified: false });
    expect(wallet.orders).toEqual([expect.objectContaining({ orderId: newOrderId, bookedFor: "Different Name" })]);

    const existingProfile = await env.DB.prepare(`
      SELECT display_name AS displayName, phone FROM attendee_profiles WHERE id = ?
    `).bind(existingAttendeeId).first<{ displayName: string; phone: string }>();
    expect(existingProfile).toEqual({ displayName: "Original Buyer", phone: "233111111111" });
  });
});
