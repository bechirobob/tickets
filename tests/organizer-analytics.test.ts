import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { GET as readAnalytics } from "../app/api/organizer/analytics/route";
import { adminCookieHeader, createPasswordRecord, createStaffSession } from "../lib/admin-session";
import { PASSWORD_ITERATIONS } from "../lib/staff-password-policy";

const passwordRecord = {
  password: "CorrectHorse9Battery",
  passwordProof: "XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI",
  passwordSalt: "AAECAwQFBgcICQoLDA0ODw",
  passwordIterations: PASSWORD_ITERATIONS,
};

async function organizer(suffix: string) {
  const id = `analytics-organizer-${suffix}`;
  const email = `${id}@example.com`;
  const now = new Date().toISOString();
  const record = await createPasswordRecord(passwordRecord);
  await env.DB.prepare(`INSERT INTO staff_accounts (
    id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
    must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
  ) VALUES (?, ?, 'Analytics Organiser', 'organizer', ?, ?, ?, 0, 'active', 0, ?, ?, 'test', ?)`)
    .bind(id, email, record.hash, record.salt, record.iterations, now, now, now).run();
  const token = await createStaffSession(env.DB, { id });
  return { id, email, cookie: adminCookieHeader(token).split(";")[0] };
}

async function seedNight(slug: string, title: string) {
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 18_000_000).toISOString();
  await env.DB.prepare(`INSERT INTO curated_event_records (
    id, submission_id, slug, title, venue, venue_map_url, area, starts_at, ends_at, vibe,
    price_from_minor, capacity, sales_open_at, sales_close_at, age_restriction, lineup,
    event_state, image_url, curation_note, status, published_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'Analytics Venue', 'https://maps.google.com/analytics', 'Accra', ?, ?,
    'Alté', 10000, 300, ?, ?, '18+', 'Analytics line-up', 'on_sale',
    'https://example.com/analytics.jpg', 'A production-shaped analytics test event.', 'published', ?, ?, ?)`)
    .bind(`event-${slug}`, `submission-${slug}`, slug, title, startsAt, endsAt, now, startsAt, now, now, now).run();
}

describe("organiser analytics", () => {
  it("returns complete first-party analytics only for assigned Nights and exports aggregate CSV", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const account = await organizer(suffix);
    const outsider = await organizer(`outsider-${suffix}`);
    const slug = `analytics-${suffix}`;
    const otherSlug = `private-${suffix}`;
    const tierId = `tier-${suffix}`;
    const now = new Date().toISOString();
    await seedNight(slug, "Analytics Night");
    await seedNight(otherSlug, "Private Night");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, 'test', ?)").bind(account.id, slug, now),
      env.DB.prepare(`INSERT INTO event_ticket_tiers (id, event_slug, code, name, description, price_minor, admissions_per_unit, capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at)
        VALUES (?, ?, 'general', 'General Admission', 'General entry', 12000, 1, 200, 10, 'available', 0, ?, ?)`).bind(tierId, slug, now, now),
      env.DB.prepare("INSERT INTO event_promoter_codes (id, event_slug, code, label, status, created_at, created_by) VALUES (?, ?, 'NANA', 'Nana street team', 'active', ?, 'test')").bind(`promoter-${suffix}`, slug, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, status, ticket_tier_id, unit_quantity, promoter_code, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 2, 24000, 2000, 26000, 'GHS', 'repeat@example.com', '233000000001', 'Repeat Guest', 'mobile_money:mtn', 'paid', ?, 2, 'NANA', 0, ?, ?)`)
        .bind(`order-a-${suffix}`, `BCT-A-${suffix}`, slug, tierId, now, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, status, ticket_tier_id, unit_quantity, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 1, 12000, 1000, 13000, 'GHS', 'repeat@example.com', '233000000001', 'Repeat Guest', 'card', 'refunded', ?, 1, 3000, ?, ?)`)
        .bind(`order-b-${suffix}`, `BCT-B-${suffix}`, slug, tierId, now, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 9, 90000, 0, 90000, 'GHS', 'private@example.com', '233000000002', 'card', 'paid', 0, ?, ?)`)
        .bind(`order-private-${suffix}`, `BCT-P-${suffix}`, otherSlug, now, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at, checked_in_at) VALUES (?, ?, ?, 'general', 1, ?, 'checked_in', ?, ?)")
        .bind(`ticket-a1-${suffix}`, `order-a-${suffix}`, slug, `qr-a1-${suffix}`, now, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', 2, ?, 'issued', ?)")
        .bind(`ticket-a2-${suffix}`, `order-a-${suffix}`, slug, `qr-a2-${suffix}`, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at, checked_in_at) VALUES (?, ?, ?, 'general', 1, ?, 'checked_in', ?, ?)")
        .bind(`ticket-b1-${suffix}`, `order-b-${suffix}`, slug, `qr-b1-${suffix}`, now, now),
      env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at) VALUES (?, 'vip@example.com', 'VIP Guest', ?, 'active', ?, ?)")
        .bind(`attendee-${suffix}`, now, now, now),
      env.DB.prepare("INSERT INTO vip_concierge_requests (id, event_slug, attendee_id, ticket_id, kind, detail, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'bottle_service', 'Table bottle', 'confirmed', ?, ?)")
        .bind(`vip-${suffix}`, slug, `attendee-${suffix}`, `ticket-a1-${suffix}`, now, now),
    ]);
    for (const [metric, count] of [["event_view", 20], ["checkout_view", 12], ["checkout_started", 8], ["payment_attempted", 4], ["payment_confirmed", 2], ["payment_failed", 1], ["share_started", 3]] as const) {
      await env.DB.prepare("INSERT INTO product_metrics_daily (day, event_slug, metric, count, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(now.slice(0, 10), slug, metric, count, now).run();
    }

    const response = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=30`, { headers: { cookie: account.cookie } }));
    expect(response.status).toBe(200);
    const data = await response.json() as {
      overview: Record<string, number>;
      ticketTiers: Array<Record<string, unknown>>;
      promoters: Array<Record<string, unknown>>;
      vipUsage: Array<Record<string, unknown>>;
    };
    expect(data.overview).toMatchObject({ eventViews: 20, checkoutStarts: 8, paymentAttempts: 4, paymentsConfirmed: 2, paidOrders: 2, revenueMinor: 39000, refundsMinor: 3000, admissions: 3, checkedIn: 2, uniqueBuyers: 1, repeatBuyers: 1 });
    expect(data.ticketTiers).toEqual([expect.objectContaining({ name: "General Admission", orders: 2, admissions: 3, revenueMinor: 39000 })]);
    expect(data.promoters).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NANA", orders: 1 }), expect.objectContaining({ code: "direct", orders: 1 })]));
    expect(data.vipUsage).toEqual([expect.objectContaining({ kind: "bottle_service", status: "confirmed", count: 1 })]);
    expect(JSON.stringify(data)).not.toContain("Private Night");
    expect(JSON.stringify(data)).not.toContain("private@example.com");

    const denied = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}`, { headers: { cookie: outsider.cookie } }));
    expect(denied.status).toBe(403);

    const csv = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=30&format=csv`, { headers: { cookie: account.cookie } }));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const exportText = await csv.text();
    expect(exportText).toContain("Analytics Night");
    expect(exportText).toContain("Nana street team");
    expect(exportText).not.toContain("repeat@example.com");
  });
});
