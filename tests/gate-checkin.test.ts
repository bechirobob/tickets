import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST as preparePasses } from "../app/api/customer/tickets/route";
import { POST as checkIn } from "../app/api/admin/check-in/route";
import { adminCookieHeader, createAdminSession } from "../lib/admin-session";
import { attendeeCookieHeader, hashToken } from "../lib/attendee-auth";

async function seedIssuedTicket(suffix: string) {
  const now = new Date().toISOString();
  const attendeeToken = `attendee-session-token-${suffix}-with-enough-entropy`;
  const attendeeId = `attendee-${suffix}`;
  const orderId = `order-${suffix}`;
  const ticketId = `ticket-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO orders (
        id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor,
        total_amount_minor, currency, customer_email, customer_phone, customer_name,
        payment_channel, status, created_at, paid_at
      ) VALUES (?, ?, 'after-dark-osu', 'general', 1, 12000, 900, 12900, 'GHS', ?,
                '233000000000', 'Gate Guest', 'mobile_money:mtn', 'paid', ?, ?)
    `).bind(orderId, `BCT-GATE-${suffix}`, `gate-${suffix}@example.com`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, phone, display_name, status, created_at, updated_at)
      VALUES (?, ?, '233000000000', 'Gate Guest', 'active', ?, ?)
    `).bind(attendeeId, `gate-${suffix}@example.com`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`session-${suffix}`, attendeeId, await hashToken(attendeeToken), new Date(Date.now() + 60_000).toISOString(), now, now),
    env.DB.prepare(`
      INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at)
      VALUES (?, ?, 'after-dark-osu', 'general', ?, 'issued', ?)
    `).bind(ticketId, orderId, `unusable-placeholder-${suffix}`, now),
    env.DB.prepare(`
      INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at)
      VALUES (?, ?, ?, 'active', ?)
    `).bind(ticketId, attendeeId, `order:${orderId}`, now),
  ]);
  return { attendeeToken, ticketId };
}

describe("secure gate passes", () => {
  it("prepares an opaque QR pass and admits it exactly once", async () => {
    const { attendeeToken, ticketId } = await seedIssuedTicket("once");
    const passesResponse = await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST",
      headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0] },
    }));
    expect(passesResponse.status).toBe(200);
    const wallet = await passesResponse.json() as { orders: Array<{ tickets: Array<{ gateCode: string; qrPayload: string }> }> };
    const pass = wallet.orders[0].tickets[0];
    expect(pass.gateCode).toMatch(/^BCT-(?:[2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/u);
    expect(pass.qrPayload).not.toContain("Gate Guest");
    expect(pass.qrPayload).not.toContain("example.com");

    const adminSession = await createAdminSession("test-admin-access");
    expect(adminSession).toBeTruthy();
    const request = () => new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookieHeader(adminSession!).split(";")[0] },
      body: JSON.stringify({ code: pass.qrPayload, eventSlug: "after-dark-osu", gate: "Gate A" }),
    });
    const responses = await Promise.all([checkIn(request()), checkIn(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<{ result: string; ticket?: { attendeeName?: string; checkedInGate?: string } }>));
    expect(payloads.find((payload) => payload.result === "valid")).toMatchObject({ result: "valid", ticket: { attendeeName: "Gate Guest", checkedInGate: "Gate A" } });
    expect(payloads.find((payload) => payload.result === "duplicate")).toMatchObject({ result: "duplicate" });
    const stored = await env.DB.prepare("SELECT status, checked_in_by AS actor, checked_in_gate AS gate FROM tickets WHERE id = ?")
      .bind(ticketId).first<{ status: string; actor: string; gate: string }>();
    expect(stored).toMatchObject({ status: "checked_in", actor: "BeCore Admin", gate: "Gate A" });
  });

  it("keeps the gate API private and rejects a pass at the wrong event", async () => {
    const unauthorized = await checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "BCT-2345-6789-ABCD-EFGH", eventSlug: "after-dark-osu" }),
    }));
    expect(unauthorized.status).toBe(401);

    const { attendeeToken, ticketId } = await seedIssuedTicket("wrong");
    const wallet = await (await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", {
      method: "POST",
      headers: { cookie: attendeeCookieHeader(attendeeToken).split(";")[0] },
    }))).json() as { orders: Array<{ tickets: Array<{ gateCode: string }> }> };
    const adminSession = await createAdminSession("test-admin-access");
    const response = await checkIn(new Request("https://tickets.becoreops.com/api/admin/check-in", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookieHeader(adminSession!).split(";")[0] },
      body: JSON.stringify({ code: wallet.orders[0].tickets[0].gateCode, eventSlug: "noir-room-labone" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ result: "wrong_event" });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE id = ?").bind(ticketId).first()).toMatchObject({ status: "issued" });
  });
});
