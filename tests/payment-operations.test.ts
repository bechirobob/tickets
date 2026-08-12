import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRefundWebhook, expireReservations, fulfillVerifiedPayment, initiatePaystackRefund, recordDisputeWebhook } from "../lib/payment-operations";
import { hashToken } from "../lib/attendee-auth";

async function seedPendingOrder(suffix: string, quantity = 2, capacity = 10) {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const eventSlug = `payment-ops-${suffix}`;
  const tierId = `tier-${suffix}`;
  const orderId = `order-${suffix}`;
  const reference = `BCT-OPS-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO curated_event_records (
        id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe,
        price_from_minor, capacity, event_state, image_url, curation_note, status,
        published_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'Payment Test', 'Test Venue', 'Accra', ?, ?, 'Late night',
        10000, ?, 'on_sale', 'https://example.com/test.jpg',
        'A valid customer-facing note for payment operation tests.', 'published', ?, ?, ?)
    `).bind(`event-${suffix}`, `submission-${suffix}`, eventSlug, new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() + 90_000_000).toISOString(), capacity, now, now, now),
    env.DB.prepare(`
      INSERT INTO event_ticket_tiers (
        id, event_slug, code, name, description, price_minor, admissions_per_unit,
        capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at
      ) VALUES (?, ?, 'general', 'General', 'One admission', 10000, 1, ?, 10, 'available', 0, ?, ?)
    `).bind(tierId, eventSlug, capacity, now, now),
    env.DB.prepare(`
      INSERT INTO orders (
        id, reference, event_slug, ticket_type, ticket_tier_id, unit_quantity, quantity,
        face_amount_minor, booking_fee_minor, total_amount_minor, currency,
        customer_email, customer_phone, customer_name, payment_channel, status,
        reservation_expires_at, created_at
      ) VALUES (?, ?, ?, 'general', ?, ?, ?, ?, 0, ?, 'GHS', ?, '233000000000',
        'Payment Guest', 'mobile_money:mtn', 'payment_pending', ?, ?)
    `).bind(orderId, reference, eventSlug, tierId, quantity, quantity, quantity * 10_000, quantity * 10_000, `${suffix}@example.com`, future, now),
    env.DB.prepare(`
      INSERT INTO inventory_reservations (
        order_id, event_slug, ticket_tier_id, unit_quantity, admission_count,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?)
    `).bind(orderId, eventSlug, tierId, quantity, quantity, future, now, now),
    env.DB.prepare(`INSERT INTO order_access_grants (order_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`)
      .bind(orderId, await hashToken(`claim-${suffix}`), future, now),
  ]);
  return { orderId, reference, eventSlug, amount: quantity * 10_000 };
}

describe("payment fulfilment operations", () => {
  it("fulfils callback and webhook races without issuing duplicate admissions", async () => {
    const seeded = await seedPendingOrder("idempotent");
    const verification = { id: 98765, reference: seeded.reference, status: "success", amount: seeded.amount, currency: "GHS", paidAt: new Date().toISOString(), channel: "mobile_money", gatewayResponse: "Approved" };
    const results = await Promise.all([
      fulfillVerifiedPayment(env.DB, verification),
      fulfillVerifiedPayment(env.DB, verification),
    ]);
    expect(results.every((result) => result.result === "paid")).toBe(true);
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "paid" });
    expect(await env.DB.prepare("SELECT status FROM inventory_reservations WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "consumed" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets WHERE order_id = ?").bind(seeded.orderId).first<{ count: number }>())?.count).toBe(2);
    expect(await env.DB.prepare("SELECT count FROM product_metrics_daily WHERE event_slug = ? AND metric = 'payment_confirmed'").bind(seeded.eventSlug).first()).toMatchObject({ count: 1 });
  });

  it("never fulfils a provider amount mismatch", async () => {
    const seeded = await seedPendingOrder("mismatch", 1);
    const result = await fulfillVerifiedPayment(env.DB, { id: 1, reference: seeded.reference, status: "success", amount: seeded.amount - 1, currency: "GHS", paidAt: new Date().toISOString(), channel: "mobile_money", gatewayResponse: "Approved" });
    expect(result.result).toBe("mismatch");
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "payment_pending" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets WHERE order_id = ?").bind(seeded.orderId).first<{ count: number }>())?.count).toBe(0);
    expect(await env.DB.prepare("SELECT count FROM product_metrics_daily WHERE event_slug = ? AND metric = 'payment_failed'").bind(seeded.eventSlug).first()).toMatchObject({ count: 1 });
  });

  it("expires abandoned orders and releases their admission holds", async () => {
    const seeded = await seedPendingOrder("expiry", 1);
    await env.DB.prepare("UPDATE orders SET reservation_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(seeded.orderId).run();
    await env.DB.prepare("UPDATE inventory_reservations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE order_id = ?").bind(seeded.orderId).run();
    await expireReservations(env.DB);
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "expired" });
    expect(await env.DB.prepare("SELECT status FROM inventory_reservations WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "expired" });
  });

  it("voids access while a refund is pending and finalises it from the webhook", async () => {
    const seeded = await seedPendingOrder("refund", 1);
    await fulfillVerifiedPayment(env.DB, { id: 2, reference: seeded.reference, status: "success", amount: seeded.amount, currency: "GHS", paidAt: new Date().toISOString(), channel: "mobile_money", gatewayResponse: "Approved" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data: { id: 55, status: "pending" } })));
    const refund = await initiatePaystackRefund(env.DB, { orderId: seeded.orderId, actor: "Finance Test", reason: "Customer requested a full event refund.", secret: "sk_test" });
    expect(refund.status).toBe("pending");
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "refund_pending" });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "voided" });
    await applyRefundWebhook(env.DB, { eventType: "refund.processed", reference: seeded.reference, amountMinor: seeded.amount });
    expect(await env.DB.prepare("SELECT status, refunded_amount_minor AS refunded FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "refunded", refunded: seeded.amount });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "refunded" });
  });

  it("suspends ticket access during a dispute and restores it after a merchant win", async () => {
    const seeded = await seedPendingOrder("dispute", 1);
    await fulfillVerifiedPayment(env.DB, { id: 3, reference: seeded.reference, status: "success", amount: seeded.amount, currency: "GHS", paidAt: new Date().toISOString(), channel: "mobile_money", gatewayResponse: "Approved" });
    await recordDisputeWebhook(env.DB, { eventType: "charge.dispute.create", reference: seeded.reference, payload: { data: { id: 101, status: "awaiting-merchant-feedback", amount: seeded.amount } } });
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "disputed" });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "voided" });
    await recordDisputeWebhook(env.DB, { eventType: "charge.dispute.resolve", reference: seeded.reference, payload: { data: { id: 101, status: "resolved", resolution: "declined" } } });
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "paid" });
    expect(await env.DB.prepare("SELECT status FROM tickets WHERE order_id = ?").bind(seeded.orderId).first()).toMatchObject({ status: "issued" });
  });
});

afterEach(() => vi.unstubAllGlobals());
