import { createSecureToken, hashToken } from "./attendee-auth";
import { sendAbandonedCheckoutEmail, sendWaitlistOfferEmail } from "./email-delivery";
import { deliverConfirmedOrder, fulfillVerifiedPayment, verifyPaystackTransaction } from "./payment-operations";

const OFFER_MINUTES = 30;

export async function releaseWaitlistOffers(env: Cloudflare.Env, origin: string): Promise<{ offered: number; expired: number }> {
  const now = new Date();
  const nowIso = now.toISOString();
  const expired = await env.DB.prepare(`
    UPDATE event_waitlist_entries SET status = 'expired', updated_at = ?
    WHERE status = 'offered' AND offer_expires_at <= ?
  `).bind(nowIso, nowIso).run();
  const tiers = await env.DB.prepare(`
    SELECT tier.id AS tierId, tier.event_slug AS eventSlug, tier.name AS tierName,
           event.title AS eventTitle, tier.capacity_admissions AS capacity,
           COALESCE(SUM(CASE WHEN reservation.status = 'consumed' OR
             (reservation.status = 'held' AND reservation.expires_at > ?) THEN reservation.admission_count ELSE 0 END), 0) AS allocated
    FROM event_ticket_tiers tier
    JOIN curated_event_records event ON event.slug = tier.event_slug
    LEFT JOIN inventory_reservations reservation ON reservation.ticket_tier_id = tier.id
    WHERE event.event_state IN ('on_sale', 'rescheduled') AND event.starts_at > ?
      AND tier.status <> 'hidden'
    GROUP BY tier.id
    HAVING capacity > allocated
    ORDER BY event.starts_at, tier.sort_order
    LIMIT 50
  `).bind(nowIso, nowIso).all<{ tierId: string; eventSlug: string; tierName: string; eventTitle: string; capacity: number; allocated: number }>();
  let offered = 0;
  for (const tier of tiers.results) {
    const available = Math.max(0, Number(tier.capacity) - Number(tier.allocated));
    if (!available) continue;
    const entries = await env.DB.prepare(`
      SELECT id, normalized_email AS email FROM event_waitlist_entries
      WHERE event_slug = ? AND ticket_tier_id = ? AND status = 'waiting'
      ORDER BY created_at LIMIT ?
    `).bind(tier.eventSlug, tier.tierId, Math.min(available, 10)).all<{ id: string; email: string }>();
    for (const entry of entries.results) {
      const token = createSecureToken();
      const expiresAt = new Date(now.getTime() + OFFER_MINUTES * 60 * 1000).toISOString();
      const updated = await env.DB.prepare(`
        UPDATE event_waitlist_entries SET status = 'offered', offer_token_hash = ?, offered_at = ?,
          offer_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting'
      `).bind(await hashToken(token), nowIso, expiresAt, nowIso, entry.id).run();
      if (updated.meta.changes !== 1) continue;
      const claimUrl = `${origin}/checkout/${encodeURIComponent(tier.eventSlug)}?offer=${encodeURIComponent(token)}`;
      const delivery = await sendWaitlistOfferEmail({ db: env.DB, entryId: entry.id, recipient: entry.email, eventTitle: tier.eventTitle, tierName: tier.tierName, expiresAt, claimUrl });
      if (!delivery.sent) {
        await env.DB.prepare("UPDATE event_waitlist_entries SET status = 'waiting', offer_token_hash = NULL, offered_at = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), entry.id).run();
        continue;
      }
      offered += 1;
    }
  }
  return { offered, expired: expired.meta.changes };
}

export async function recoverAbandonedPayments(env: Cloudflare.Env, origin: string): Promise<{ recovered: number; fulfilled: number }> {
  if (!env.PAYSTACK_SECRET_KEY) return { recovered: 0, fulfilled: 0 };
  const orders = await env.DB.prepare(`
    SELECT orders.id, orders.reference, orders.customer_email AS customerEmail,
           orders.event_slug AS eventSlug, event.title AS eventTitle
    FROM orders JOIN curated_event_records event ON event.slug = orders.event_slug
    LEFT JOIN payment_recovery_events recovery ON recovery.order_id = orders.id
    WHERE orders.status = 'expired' AND recovery.order_id IS NULL
      AND orders.created_at > ? ORDER BY orders.created_at LIMIT 20
  `).bind(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).all<{ id: string; reference: string; customerEmail: string; eventSlug: string; eventTitle: string }>();
  let recovered = 0;
  let fulfilled = 0;
  for (const order of orders.results) {
    try {
      const verification = await verifyPaystackTransaction(order.reference, env.PAYSTACK_SECRET_KEY);
      if (["ongoing", "pending", "processing", "queued"].includes(verification.status)) continue;
      const result = await fulfillVerifiedPayment(env.DB, verification);
      if (result.result === "paid") {
        await deliverConfirmedOrder(env.DB, result.order, origin);
        fulfilled += 1;
      }
      if (verification.status === "abandoned") {
        const delivery = await sendAbandonedCheckoutEmail({ db: env.DB, orderId: order.id, recipient: order.customerEmail, eventTitle: order.eventTitle, eventUrl: `${origin}/event/${encodeURIComponent(order.eventSlug)}` });
        await env.DB.prepare(`INSERT INTO payment_recovery_events (order_id, provider_status, delivery_status, attempted_at, detail) VALUES (?, ?, ?, ?, ?)`)
          .bind(order.id, verification.status, delivery.sent ? "sent" : "failed", new Date().toISOString(), delivery.sent ? null : "Recovery email was not delivered.").run();
        if (delivery.sent) recovered += 1;
      } else {
        await env.DB.prepare(`INSERT INTO payment_recovery_events (order_id, provider_status, delivery_status, attempted_at, detail) VALUES (?, ?, 'suppressed', ?, ?)`)
          .bind(order.id, verification.status, new Date().toISOString(), "Only provider-confirmed abandoned transactions receive recovery messages.").run();
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "payment recovery verification failed", orderId: order.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { recovered, fulfilled };
}
