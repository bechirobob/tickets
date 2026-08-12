export const productMetrics = [
  "event_view",
  "checkout_view",
  "checkout_started",
  "payment_attempted",
  "payment_confirmed",
  "payment_failed",
  "recovery_requested",
  "share_started",
  "pwa_prompt_shown",
  "pwa_install_accepted",
  "pwa_ios_guide_opened",
  "pwa_installed",
] as const;

export type ProductMetric = typeof productMetrics[number];

export function isProductMetric(value: unknown): value is ProductMetric {
  return typeof value === "string" && (productMetrics as readonly string[]).includes(value);
}

export function validAnalyticsSlug(value: unknown) {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/u.test(value) ? value : "";
}

export async function recordProductMetric(db: D1Database, metric: ProductMetric, eventSlug = "", occurredAt = new Date()) {
  const day = occurredAt.toISOString().slice(0, 10);
  const now = occurredAt.toISOString();
  await db.prepare(`
    INSERT INTO product_metrics_daily (day, event_slug, metric, count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(day, event_slug, metric) DO UPDATE SET
      count = count + 1,
      updated_at = excluded.updated_at
  `).bind(day, validAnalyticsSlug(eventSlug), metric, now).run();
}
