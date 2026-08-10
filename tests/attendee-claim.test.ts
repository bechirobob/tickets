import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST as claimAttendeeSession } from "../app/api/customer/session/route";
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
});
