import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POST as joinWaitlist } from "../app/api/waitlist/route";
import { GET as getSupport, POST as updateSupport } from "../app/api/customer/support/[slug]/route";
import { hashToken } from "../lib/attendee-auth";
import { expireReservations } from "../lib/payment-operations";
import { resolveRoomPolicy } from "../lib/room-policy";

const origin = "https://tickets.becoreops.com";

async function seed(suffix: string, eventState = "sold_out") {
  const eventSlug = `compact-${suffix}`;
  const tierId = `tier-${suffix}`;
  const attendeeId = `attendee-${suffix}`;
  const orderId = `order-${suffix}`;
  const ticketId = `ticket-${suffix}`;
  const token = `session-${suffix}-secure-token`;
  const email = `${suffix}@example.com`;
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO curated_event_records (id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe, price_from_minor, capacity, event_state, image_url, curation_note, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, 'Compact Night', 'Venue', 'Accra', ?, ?, 'Late night', 10000, 1, ?, 'https://example.com/night.jpg', 'A complete test event for compact operations.', 'published', ?, ?, ?)`)
      .bind(`event-${suffix}`, `submission-${suffix}`, eventSlug, startsAt, new Date(Date.parse(startsAt) + 4 * 60 * 60 * 1000).toISOString(), eventState, now, now, now),
    env.DB.prepare(`INSERT INTO event_ticket_tiers (id, event_slug, code, name, description, price_minor, admissions_per_unit, capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at)
      VALUES (?, ?, 'general', 'General', 'One admission', 10000, 1, 1, 2, 'sold_out', 0, ?, ?)`).bind(tierId, eventSlug, now, now),
    env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at) VALUES (?, ?, 'Compact Guest', ?, 'active', ?, ?)").bind(attendeeId, email, now, now, now),
    env.DB.prepare("INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`session-${suffix}`, attendeeId, await hashToken(token), new Date(Date.now() + 60_000).toISOString(), now, now),
    env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, created_at, paid_at)
      VALUES (?, ?, ?, 'general', 1, 10000, 0, 10000, 'GHS', ?, '233000000000', 'mobile_money:mtn', 'paid', ?, ?)`).bind(orderId, `BCT-${suffix}`, eventSlug, email, now, now),
    env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', ?, 'issued', ?)").bind(ticketId, orderId, eventSlug, `qr-${suffix}`, now),
    env.DB.prepare("INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)").bind(ticketId, attendeeId, orderId, now),
  ]);
  return { eventSlug, tierId, attendeeId, orderId, ticketId, token, email };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`${origin}${path}`, init);
}

describe("compact roadmap operations", () => {
  it("accepts one compact waitlist entry for a sold-out tier", async () => {
    const seeded = await seed(`wait-${crypto.randomUUID()}`);
    const response = await joinWaitlist(request("/api/waitlist", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ eventSlug: seeded.eventSlug, ticketTierId: seeded.tierId, email: "guest@example.com", phone: "0240000000" }) }));
    expect(response.status).toBe(201);
    expect(await env.DB.prepare("SELECT status FROM event_waitlist_entries WHERE event_slug = ?").bind(seeded.eventSlug).first()).toMatchObject({ status: "waiting" });
  });

  it("keeps cancellation support attached to the purchased Night", async () => {
    const seeded = await seed(`support-${crypto.randomUUID()}`, "cancelled");
    await env.DB.prepare("UPDATE tickets SET status = 'voided' WHERE id = ?").bind(seeded.ticketId).run();
    const cookie = `bct_attendee=${seeded.token}`;
    const context = { params: Promise.resolve({ slug: seeded.eventSlug }) };
    const refund = await updateSupport(request(`/api/customer/support/${seeded.eventSlug}`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "request_refund", orderId: seeded.orderId }) }), context);
    expect(refund.status).toBe(201);
    const response = await getSupport(request(`/api/customer/support/${seeded.eventSlug}`, { headers: { cookie } }), context);
    expect(response.status).toBe(200);
    const data = await response.json() as { cases: Array<{ kind: string; status: string }> };
    expect(data.cases).toContainEqual(expect.objectContaining({ kind: "refund", status: "waiting_support" }));
  });

  it("applies slow mode and an emergency Room pause from durable settings", async () => {
    const seeded = await seed(`room-${crypto.randomUUID()}`, "on_sale");
    await env.DB.prepare("INSERT INTO room_settings (event_slug, emergency_read_only, slow_mode_seconds, updated_at, updated_by) VALUES (?, true, 15, ?, 'test')")
      .bind(seeded.eventSlug, new Date().toISOString()).run();
    expect(await resolveRoomPolicy(env.DB, seeded.eventSlug)).toMatchObject({ readOnly: true, emergencyReadOnly: true, slowModeSeconds: 15 });
  });

  it("does not invent a Paystack abandoned status when a local hold expires", async () => {
    const seeded = await seed(`expiry-${crypto.randomUUID()}`, "on_sale");
    await env.DB.prepare("UPDATE orders SET status = 'payment_pending', reservation_expires_at = '2020-01-01T00:00:00.000Z', paystack_status = 'initialized' WHERE id = ?").bind(seeded.orderId).run();
    await expireReservations(env.DB);
    expect(await env.DB.prepare("SELECT status, paystack_status AS paystackStatus FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "expired", paystackStatus: "initialized" });
  });
});
