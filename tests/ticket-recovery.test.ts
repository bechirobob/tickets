import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as requestRecovery } from "../app/api/customer/recovery/route";
import { GET as claimRecovery } from "../app/api/customer/recovery/claim/route";
import { POST as preparePasses } from "../app/api/customer/tickets/route";

afterEach(() => vi.unstubAllGlobals());

describe("ticket email delivery and recovery", () => {
  it("emails a one-time wallet link and rotates a fresh QR on the recovered device", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `recover-${suffix}@example.com`;
    const orderId = `recover-order-${suffix}`;
    const secondOrderId = `recover-order-second-${suffix}`;
    const ticketId = `recover-ticket-${suffix}`;
    const secondTicketId = `recover-ticket-second-${suffix}`;
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 1_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, ticket_type, quantity, face_amount_minor,
          booking_fee_minor, total_amount_minor, currency, customer_email,
          customer_phone, customer_name, payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'recovery-event', 'general', 1, 10000, 500, 10500, 'GHS', ?,
          '233000000000', 'Recovery Guest', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(orderId, `BCT-RECOVER-${suffix}`, email, now, now),
      env.DB.prepare(`
        INSERT INTO orders (
          id, reference, event_slug, ticket_type, quantity, face_amount_minor,
          booking_fee_minor, total_amount_minor, currency, customer_email,
          customer_phone, customer_name, payment_channel, status, created_at, paid_at
        ) VALUES (?, ?, 'second-recovery-event', 'general', 1, 9000, 500, 9500, 'GHS', ?,
          '233999999999', 'Second Checkout Name', 'mobile_money:mtn', 'paid', ?, ?)
      `).bind(secondOrderId, `BCT-RECOVER-SECOND-${suffix}`, email, later, later),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'recovery-event', 'general', 1, ?, 'issued', ?)
      `).bind(ticketId, orderId, `placeholder-${suffix}`, now),
      env.DB.prepare(`
        INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
        VALUES (?, ?, 'second-recovery-event', 'general', 1, ?, 'issued', ?)
      `).bind(secondTicketId, secondOrderId, `placeholder-second-${suffix}`, later),
    ]);

    let emailBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      emailBody = String(init?.body ?? "");
      return Response.json({ id: `email-${suffix}` });
    }));
    const recoveryResponse = await requestRecovery(new Request("https://tickets.becoreops.com/api/customer/recovery", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.20", origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ email }),
    }));
    expect(recoveryResponse.status).toBe(202);
    const sent = JSON.parse(emailBody) as { html: string; text: string };
    expect(sent.html).not.toContain("BCT:");
    expect(sent.html).not.toContain("qr_token");
    const match = sent.text.match(/https:\/\/tickets\.becoreops\.com\/api\/customer\/recovery\/claim\?token=([^\s]+)/u);
    expect(match?.[1]).toBeTruthy();

    const claimResponse = await claimRecovery(new Request(`https://tickets.becoreops.com/api/customer/recovery/claim?token=${match![1]}`));
    expect(claimResponse.status).toBe(303);
    expect(claimResponse.headers.get("location")).toBe("https://tickets.becoreops.com/my-nights?recovered=1");
    const cookie = claimResponse.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toMatch(/^bct_attendee=/u);

    const walletResponse = await preparePasses(new Request("https://tickets.becoreops.com/api/customer/tickets", { method: "POST", headers: { cookie: cookie! } }));
    expect(walletResponse.status).toBe(200);
    const wallet = await walletResponse.json() as { attendee: { displayName: string; emailVerified: boolean }; orders: Array<{ tickets: Array<{ qrPayload: string; gateCode: string }> }> };
    expect(wallet.attendee).toMatchObject({ displayName: "Second Checkout Name", emailVerified: true });
    expect(wallet.orders).toHaveLength(2);
    expect(wallet.orders[0].tickets[0].qrPayload).toMatch(/^BCT:/u);
    expect(wallet.orders[0].tickets[0].gateCode).toMatch(/^BCT-/u);

    const replay = await claimRecovery(new Request(`https://tickets.becoreops.com/api/customer/recovery/claim?token=${match![1]}`));
    expect(replay.headers.get("location")).toBe("https://tickets.becoreops.com/tickets?recovery=invalid");
  });

  it("does not disclose whether an unknown email has tickets", async () => {
    const response = await requestRecovery(new Request("https://tickets.becoreops.com/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json", origin: "https://tickets.becoreops.com" }, body: JSON.stringify({ email: "unknown@example.com" }) }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ message: "If that email has active paid tickets, a secure access link is on the way." });
  });
});
