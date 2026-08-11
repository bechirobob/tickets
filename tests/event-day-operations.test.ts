import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as prepareTickets } from "../app/api/customer/tickets/route";
import { POST as createTransfer } from "../app/api/customer/transfers/route";
import { GET as claimTransfer } from "../app/api/customer/transfers/claim/route";
import { GET as listNotifications } from "../app/api/customer/notifications/route";
import { PATCH as updatePreference } from "../app/api/customer/notifications/preferences/[slug]/route";
import { attendeeCookieHeader, hashToken } from "../lib/attendee-auth";
import { notifyRoomMessage } from "../lib/notifications";

afterEach(() => vi.unstubAllGlobals());

async function seedAttendee(suffix: string, email = `guest-${suffix}@example.com`) {
  const now = new Date().toISOString();
  const attendeeId = `event-day-attendee-${suffix}`;
  const token = `event-day-session-${suffix}-with-enough-entropy`;
  const orderId = `event-day-order-${suffix}`;
  const ticketId = `event-day-ticket-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor,
        total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, status, created_at, paid_at)
      VALUES (?, ?, 'after-dark-osu', 'general', 1, 12000, 900, 12900, 'GHS', ?, '233000000000', ?, 'mobile_money:mtn', 'paid', ?, ?)
    `).bind(orderId, `BCT-DAY-${suffix}`, email, `Guest ${suffix}`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).bind(attendeeId, email, `Guest ${suffix}`, now, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`event-day-session-row-${suffix}`, attendeeId, await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), now, now),
    env.DB.prepare(`
      INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
      VALUES (?, ?, 'after-dark-osu', 'general', 1, ?, 'issued', ?)
    `).bind(ticketId, orderId, `placeholder-${suffix}`, now),
    env.DB.prepare(`INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)`)
      .bind(ticketId, attendeeId, `order:${orderId}`, now),
  ]);
  return { attendeeId, token, cookie: attendeeCookieHeader(token).split(";")[0], ticketId, email };
}

describe("event-day operations", () => {
  it("keeps an offline ticket stable until an accepted transfer rotates ownership and QR", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const sender = await seedAttendee(suffix);
    const walletRequest = () => new Request("https://tickets.becoreops.com/api/customer/tickets", { method: "POST", headers: { cookie: sender.cookie } });
    const first = await (await prepareTickets(walletRequest())).json() as { orders: Array<{ canViewPurchase: boolean; reference: string; tickets: Array<{ qrPayload: string }> }> };
    const second = await (await prepareTickets(walletRequest())).json() as typeof first;
    expect(second.orders[0].tickets[0].qrPayload).toBe(first.orders[0].tickets[0].qrPayload);

    let emailBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      emailBody = String(init?.body ?? "");
      return Response.json({ id: `transfer-email-${suffix}` });
    }));
    const transferResponse = await createTransfer(new Request("https://tickets.becoreops.com/api/customer/transfers", {
      method: "POST", headers: { "content-type": "application/json", cookie: sender.cookie, origin: "https://tickets.becoreops.com" },
      body: JSON.stringify({ ticketId: sender.ticketId, recipientEmail: `recipient-${suffix}@example.com` }),
    }));
    expect(transferResponse.status).toBe(201);
    const sent = JSON.parse(emailBody) as { text: string };
    const token = sent.text.match(/claim\?token=([^\s]+)/u)?.[1];
    expect(token).toBeTruthy();

    const claim = await claimTransfer(new Request(`https://tickets.becoreops.com/api/customer/transfers/claim?token=${token}`));
    expect(claim.status).toBe(303);
    const recipientCookie = claim.headers.get("set-cookie")?.split(";")[0];
    expect(recipientCookie).toMatch(/^bct_attendee=/u);
    const recipientWallet = await (await prepareTickets(new Request("https://tickets.becoreops.com/api/customer/tickets", { method: "POST", headers: { cookie: recipientCookie! } }))).json() as typeof first;
    expect(recipientWallet.orders[0].canViewPurchase).toBe(false);
    expect(recipientWallet.orders[0].reference).toBe("Transferred ticket");
    expect(recipientWallet.orders[0].tickets[0].qrPayload).not.toBe(first.orders[0].tickets[0].qrPayload);
    const senderWallet = await (await prepareTickets(walletRequest())).json() as typeof first;
    expect(senderWallet.orders).toHaveLength(0);
  });

  it("writes Room activity to the durable inbox and respects a per-Room mute", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const sender = await seedAttendee(`sender-${suffix}`);
    const recipient = await seedAttendee(`recipient-${suffix}`);
    await notifyRoomMessage(env, { eventSlug: "after-dark-osu", messageId: `message-${suffix}`, senderAttendeeId: sender.attendeeId, senderName: "Kofi", content: "We are by the left entrance." });
    const inbox = await listNotifications(new Request("https://tickets.becoreops.com/api/customer/notifications", { headers: { cookie: recipient.cookie } }));
    expect(inbox.status).toBe(200);
    await expect(inbox.json()).resolves.toMatchObject({ unread: 1, notifications: [{ kind: "room_message", title: "Kofi is in The Room" }] });

    const muted = await updatePreference(new Request("https://tickets.becoreops.com/api/customer/notifications/preferences/after-dark-osu", {
      method: "PATCH", headers: { "content-type": "application/json", cookie: recipient.cookie, origin: "https://tickets.becoreops.com" }, body: JSON.stringify({ mute: "tonight" }),
    }), { params: Promise.resolve({ slug: "after-dark-osu" }) });
    expect(muted.status).toBe(200);
    await notifyRoomMessage(env, { eventSlug: "after-dark-osu", messageId: `message-muted-${suffix}`, senderAttendeeId: sender.attendeeId, senderName: "Kofi", content: "This one should stay quiet." });
    const afterMute = await (await listNotifications(new Request("https://tickets.becoreops.com/api/customer/notifications", { headers: { cookie: recipient.cookie } }))).json() as { notifications: unknown[] };
    expect(afterMute.notifications).toHaveLength(1);
  });
});
