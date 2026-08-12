import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as readVip, POST as requestVip } from "../app/api/rooms/[slug]/vip/route";
import { attendeeCookieHeader, hashToken, readAttendeeRoomAccess } from "../lib/attendee-auth";

async function attendee(suffix: string, tier: "general" | "vip") {
  const now = new Date().toISOString();
  const attendeeId = `vip-attendee-${suffix}`;
  const orderId = `vip-order-${suffix}`;
  const ticketId = `vip-ticket-${suffix}`;
  const token = `vip-session-${suffix}-with-enough-entropy`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO orders (id, reference, event_slug, ticket_type, ticket_tier_id, quantity, face_amount_minor,
        booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name,
        payment_channel, status, created_at, paid_at)
      VALUES (?, ?, 'after-dark-osu', ?, ?, 1, 22000, 900, 22900, 'GHS', ?, '233000000000', ?,
        'mobile_money:mtn', 'paid', ?, ?)
    `).bind(orderId, `BCT-VIP-${suffix}`, tier, `preview:tier:after-dark-osu:${tier}`, `${suffix}@example.com`, `Guest ${suffix}`, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).bind(attendeeId, `${suffix}@example.com`, `Guest ${suffix}`, now, now, now),
    env.DB.prepare(`
      INSERT INTO attendee_sessions (id, attendee_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`vip-session-row-${suffix}`, attendeeId, await hashToken(token), new Date(Date.now() + 3_600_000).toISOString(), now, now),
    env.DB.prepare(`
      INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at)
      VALUES (?, ?, 'after-dark-osu', ?, 1, ?, 'issued', ?)
    `).bind(ticketId, orderId, tier, `vip-placeholder-${suffix}`, now),
    env.DB.prepare("INSERT INTO ticket_assignments (ticket_id, attendee_id, assigned_by, status, assigned_at) VALUES (?, ?, ?, 'active', ?)")
      .bind(ticketId, attendeeId, `order:${orderId}`, now),
  ]);
  return { attendeeId, ticketId, cookie: attendeeCookieHeader(token).split(";")[0] };
}

describe("VIP Room identity and concierge", () => {
  it("keeps GA unlabelled and derives VIP only from an active configured tier", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const ga = await attendee(`ga-${suffix}`, "general");
    const vip = await attendee(`member-${suffix}`, "vip");
    await expect(readAttendeeRoomAccess(env.DB, ga.cookie, "after-dark-osu")).resolves.toMatchObject({ roomBadge: null });
    await expect(readAttendeeRoomAccess(env.DB, vip.cookie, "after-dark-osu")).resolves.toMatchObject({ roomBadge: "VIP", ticketId: vip.ticketId });
    const gaPanel = await readVip(new Request("https://tickets.becoreops.com/api/rooms/after-dark-osu/vip", { headers: { cookie: ga.cookie } }), { params: Promise.resolve({ slug: "after-dark-osu" }) });
    await expect(gaPanel.json()).resolves.toEqual({ vip: false });
  });

  it("opens only Host-enabled perks and limits VIP song suggestions to one active request", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const vip = await attendee(`queue-${suffix}`, "vip");
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO event_vip_settings (event_slug, bottle_service_enabled, bottle_menu, song_suggestions_enabled,
        assistance_enabled, updated_by, updated_at)
      VALUES ('after-dark-osu', 1, 'House bottle — GH₵900', 1, 1, 'test-host', ?)
      ON CONFLICT(event_slug) DO UPDATE SET bottle_service_enabled = 1, bottle_menu = excluded.bottle_menu,
        song_suggestions_enabled = 1, assistance_enabled = 1, updated_by = 'test-host', updated_at = excluded.updated_at
    `).bind(now).run();
    const post = () => requestVip(new Request("https://tickets.becoreops.com/api/rooms/after-dark-osu/vip", {
      method: "POST", headers: { cookie: vip.cookie, origin: "https://tickets.becoreops.com", "content-type": "application/json" },
      body: JSON.stringify({ kind: "song_suggestion", detail: "Unavailable — Davido" }),
    }), { params: Promise.resolve({ slug: "after-dark-osu" }) });
    expect((await post()).status).toBe(201);
    const duplicate = await post();
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: expect.stringContaining("already have a song") });
    const panel = await readVip(new Request("https://tickets.becoreops.com/api/rooms/after-dark-osu/vip", { headers: { cookie: vip.cookie } }), { params: Promise.resolve({ slug: "after-dark-osu" }) });
    await expect(panel.json()).resolves.toMatchObject({ vip: true, settings: { bottleServiceEnabled: true, songSuggestionsEnabled: true }, requests: [{ status: "requested" }] });
  });
});
